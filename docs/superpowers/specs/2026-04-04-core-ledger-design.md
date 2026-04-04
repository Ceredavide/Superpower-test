# Core Ledger Design

## Goal

Extend the existing expense-group application so expenses drive a full group ledger. Members can create expenses with split rules, view derived balances, settle debts with simplified transactions, and remove members while the ledger redistributes historical expense effects across the remaining active roster.

## Scope

This spec covers:

- Rich expense splitting with equal, percentage, exact-amount, and excluded-member participation
- Derived member balances from expenses and settlements
- Settle-up suggestions and settlement history
- Expense categories on all existing and future expenses
- Member removal behavior and ledger redistribution

This spec does not cover:

- Recurring expenses
- Spending breakdown analytics UI beyond category storage needed for future work
- Email or notification behavior
- Cached or materialized balances

## Product Decisions

- Balances are derived from source records on read, not stored as a source of truth.
- A settlement directly mutates derived balances without creating an expense-like row.
- Paid settlements remain visible in settlement history with payer, payee, amount, and timestamp.
- When a member leaves a group, all historical expense effects involving that member are redistributed proportionally across the remaining active members.
- If a departed member previously paid part of an expense, that paid contribution is redistributed proportionally across the remaining active members automatically.

## Data Model

### Expense

Extend each expense with:

- `category`: enum of `food`, `transport`, `housing`, `entertainment`, `other`
- `splitMode`: enum of `equal`, `percentage`, `exact`

Existing expenses default to `other`.

### ExpensePayer

Continue to store one or more payer rows per expense:

- `userId`
- `amountPaid`

Payers must be active group members at the time the expense is created or edited.

### ExpenseShare

Add a normalized share table for the final owed allocation per member:

- `expenseId`
- `userId`
- `amountOwed`

This is the canonical normalized result of the chosen split mode. The server computes and stores concrete owed amounts for all participating members so later ledger reads do not depend on reinterpreting raw percentage inputs.

### Settlement

Add a settlement history record:

- `id`
- `groupId`
- `fromUserId`
- `toUserId`
- `amount`
- `paidAt`
- `createdByUserId`
- timestamps as needed for storage consistency

This is not an expense and does not participate in category totals.

### GroupMembership

Extend membership with active/inactive state rather than removing the row outright:

- `status`: `active` or `inactive`
- optional `leftAt`

Inactive members remain part of history but are excluded from the current active roster.

## Ledger Semantics

### Expense Total

The total expense amount remains the sum of payer rows.

### Split Modes

Each expense supports one split mode:

- `equal`
  - divide the expense total evenly across included active members
- `percentage`
  - submit a custom percentage per included member
  - percentages must sum to exactly `100`
- `exact`
  - submit a concrete owed amount per included member
  - exact amounts must sum to the expense total

Excluded members are simply absent from the participant set for that expense and owe nothing for it.

### Normalized Shares

The server validates the submitted split input, then writes normalized `ExpenseShare` rows. All later balance calculations use:

- money paid by each member through payer rows
- money owed by each member through normalized share rows
- money transferred by each member through settlements

### Balance Formula

For each active member in a group:

- `balance = paid contributions - owed shares - settlements paid + settlements received`

Positive balance means the member is owed money. Negative balance means the member owes money.

## Group Page Behavior

The group page becomes the main ledger surface with three sections:

1. Expense composer and expense list
2. Current balances
3. Settle-up suggestions and settlement history

All group members can view:

- expense list
- balances
- settle-up suggestions
- settlement history

Only the expense creator can edit or delete that expense.

Any group member can mark a settle-up suggestion as paid.

## Expense UI Behavior

### Expense Form

Add the following to create/edit expense flows:

- category selector with:
  - `Food`
  - `Transport`
  - `Housing`
  - `Entertainment`
  - `Other`
- split-mode selector with:
  - `Equal`
  - `By percentage`
  - `By exact amount`
- participant picker for excluding members
- split-entry rows for percentage or exact modes

The server remains the authority for normalized owed amounts.

### Validation

The API rejects:

- empty title
- invalid date
- no payer rows
- duplicate payer rows
- payer rows for non-members or inactive members
- no included participants
- percentage totals not equal to `100`
- exact totals not equal to the expense total
- excluded members appearing in share rows

## Settle-Up Behavior

### Suggestions

Settle-up suggestions are computed from current active-member balances using a greedy debt-matching algorithm:

1. find the member with the largest negative balance
2. find the member with the largest positive balance
3. create a transfer for the smaller absolute amount
4. reduce both balances
5. repeat until all balances are settled within rounding-safe tolerance

This produces the minimum or near-minimum number of practical transactions for the target use case.

### Mark As Paid

Marking a suggestion as paid:

- creates a `Settlement` history row
- immediately changes derived balances
- removes or updates outstanding suggestions on the next read

Settlement rows stay visible in history permanently.

The API must reject settlement attempts where:

- payer and payee are the same member
- amount is zero or negative
- either member is inactive
- the transfer amount exceeds what the balances justify

## Member Removal

### Removal Rules

Removing a member:

- marks that member inactive
- removes them from active balances
- removes them from future participant and payer choices
- removes them from future settle-up suggestions

### Historical Redistribution

After removal, the ledger behaves as though the remaining active members are the current participants of record:

- any historical owed shares for the departed member are redistributed proportionally across the remaining active members
- any historical payer contributions for the departed member are redistributed proportionally across the remaining active members

This redistribution is part of the derived current-roster ledger view. The application should not require manual reassignment of old expenses.

### Removal Constraints

- removal is rejected if it would leave the group empty
- if one member remains active, that member's balance is always zero and settle-up suggestions are empty

## Recalculation Rules

All balances are recalculated from source records every time ledger data is requested.

Editing an expense:

- replaces payer rows as submitted
- replaces normalized share rows according to the chosen split mode and participant set
- updates balances through full re-derivation

Deleting an expense:

- removes its payer and share effects entirely
- updates balances through full re-derivation

Changing split mode, category, participants, or payer rows follows the same full re-derivation path.

## Money And Rounding

All server-side money logic uses integer cents.

Rounding rules:

- exact paid amounts and exact split amounts are normalized to money values with two decimal places
- equal splits divide cents across included active members, with remainder cents assigned deterministically in stable member order
- percentage splits convert percentages into cents, with remainder cents assigned deterministically in stable member order

The normalized owed-share total must always match the expense total exactly.

## API Surface

Add or evolve the following endpoints:

- `GET /groups/:groupId/ledger`
  - returns:
    - active members
    - expenses
    - balances
    - settle-up suggestions
    - settlement history
- `POST /groups/:groupId/expenses`
- `PATCH /expenses/:expenseId`
- `DELETE /expenses/:expenseId`
- `POST /groups/:groupId/settlements`
- `POST /groups/:groupId/members/:memberId/remove`

The group detail UI can still be driven from this ledger response rather than from separate balance and settlement fetches.

## Testing Strategy

### Backend

Add coverage for:

- equal split calculations
- percentage split calculations
- exact split calculations
- excluded-member participation
- deterministic rounding in cents
- balance re-derivation after create, edit, and delete
- creator-only edit/delete authorization
- settle-up suggestion simplification
- settlement application and history
- member removal redistribution across historical expenses
- settlement and member-removal authorization

### Frontend

Add coverage for:

- switching between split modes
- participant exclusion flow
- category selection
- split validation messaging
- live balance updates after create/edit/delete
- settle-up suggestion display and mark-paid flow
- settlement history rendering
- member-removal effects on balances and expense form options

## Implementation Notes

- Follow the existing React + Express + Prisma structure.
- Keep balances derived, not incrementally stored.
- Keep money and split normalization on the server to avoid client/server drift.
- Keep the group page as the primary collaboration surface rather than adding many new routes unless implementation pressure makes that clearly necessary.
