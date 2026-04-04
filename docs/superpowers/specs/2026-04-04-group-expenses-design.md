# Group Expenses Design

**Date:** 2026-04-04

## Goal

Extend the existing expense-group application so group members can create, view, edit, and delete group expenses. Each expense has a title, date, and one or more payer rows with separate paid amounts. The displayed total for an expense is the sum of its payer amounts.

## Context

This design builds on the already-implemented authentication, group membership, and invitation flows. It does not replace the existing group model or permission rules. It adds expense tracking inside each group page.

## Product Scope

### In Scope

- Add an expense within a group
- Store `title` and `date` on the expense
- Store one or more payer rows for the expense
- Compute the displayed total as the sum of payer-row amounts
- Show the expense list to all group members
- Sort the expense list by date ascending
- Allow only the creator of an expense to edit it
- Allow only the creator of an expense to delete it

### Out Of Scope

- Splitting an expense among members
- Balances, settlements, or debt calculations
- Attachments, notes, or categories
- Partial edit permissions for non-creators

## Data Model

### Expense

- `id`
- `groupId`
- `title`
- `expenseDate`
- `createdByUserId`
- `createdAt`
- `updatedAt`

### ExpensePayer

- `id`
- `expenseId`
- `userId`
- `amountPaid`

## Relationships

- One `ExpenseGroup` has many `Expense` records
- One `Expense` has many `ExpensePayer` records
- One `User` can create many `Expense` records
- One `User` can appear in many `ExpensePayer` rows

## Core Rules

- Any current group member may create an expense in that group
- All current group members may view the expense list for that group
- Only the user who created an expense may edit it
- Only the user who created an expense may delete it
- Every expense must have at least one payer row
- Every payer must be a current member of the same group
- Every payer amount must be positive
- The expense total shown in the API and UI is derived from payer rows, never entered separately

## Sorting Behavior

The expense list is sorted by `expenseDate` ascending, so older expenses appear before newer ones. When multiple expenses share the same date, a secondary sort by `createdAt` ascending keeps the list stable.

## Backend Changes

### Prisma

Add `Expense` and `ExpensePayer` models to the schema. `Expense` should belong to a group and creator. `ExpensePayer` should belong to an expense and payer user.

`amountPaid` should use a precise numeric column type suitable for money values. The application layer should serialize totals consistently for the client.

### Store Layer

Add store methods for:

- create expense with payer rows
- list expenses for a group with payer details and computed total
- update expense and replace payer rows
- delete expense
- verify creator ownership for edit/delete

### API Contract

- `GET /groups/:groupId/expenses`
- `POST /groups/:groupId/expenses`
- `PATCH /expenses/:expenseId`
- `DELETE /expenses/:expenseId`

#### Create Request

- `title`
- `expenseDate`
- `payers`
  - array of `{ userId, amountPaid }`

#### Update Request

- `title`
- `expenseDate`
- `payers`
  - array of `{ userId, amountPaid }`

#### Response Shape

Each expense response should include:

- expense metadata
- creator summary
- payer rows with user summary and amount paid
- computed total amount

## Authorization

- `GET /groups/:groupId/expenses`: requester must be a group member
- `POST /groups/:groupId/expenses`: requester must be a group member
- `PATCH /expenses/:expenseId`: requester must be the creator
- `DELETE /expenses/:expenseId`: requester must be the creator

## Validation

- `title` is required and non-empty
- `expenseDate` is required and valid
- `payers` must contain at least one row
- every `userId` in `payers` must belong to the target group
- every `amountPaid` must be greater than zero
- duplicate payer rows for the same user should be rejected instead of silently merged

## Frontend Changes

The existing group detail page remains the collaboration surface for the group. It gains an expense section below the member area.

### Expense Composer

Add a form on the group page with:

- title input
- date input
- repeatable payer rows
  - member selector
  - amount input

The form should show a live computed total based on the payer amounts entered so far.

### Expense List

Render all group expenses on the same group page:

- sorted by date ascending
- showing title, date, total, creator, and payer breakdown

If the signed-in user created an expense, show `Edit` and `Delete` actions on that row. Editing should reuse the same form structure with prefilled values.

## Error Handling

The API should return clear errors for:

- non-member access
- invalid or missing title/date
- missing payer rows
- non-member payers
- non-positive amounts
- edit/delete attempts by non-creators
- missing expenses

The frontend should surface those errors inline near the expense form or expense list action that triggered them.

## Testing Strategy

### Backend

- create expense succeeds for group member
- create expense fails for non-member
- expense list is sorted by date ascending
- total equals sum of payer amounts
- edit succeeds for creator
- edit fails for non-creator
- delete succeeds for creator
- delete fails for non-creator
- payer validation rejects non-members
- payer validation rejects duplicate users

### Frontend

- expense form renders on group page
- live total updates as payer amounts change
- expense submission refreshes the list
- expenses render in ascending date order
- creator sees edit/delete controls
- non-creator does not see edit/delete controls

## Implementation Notes

Keep the expense form and expense list on the existing group detail page instead of adding a new route. This fits the current product shape and keeps all group activity in one place.

The server should calculate totals from stored payer rows rather than trusting a client-submitted total. Editing an expense should replace its payer rows transactionally so the expense always stays internally consistent.
