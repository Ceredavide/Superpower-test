# Feature Folder Refactor Design

## Goal

Refactor the application into feature folders on both the client and server while preserving existing behavior, API contracts, database schema, and visual design. The refactor should make product areas easier to reason about and reduce the size and responsibility of the current top-level composition files.

## Objectives

- Split product code by feature area rather than by broad technical layer where practical.
- Keep a small shared `core`/`lib` layer for infrastructure and cross-feature utilities.
- Thin down [client/src/App.tsx](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/client/src/App.tsx) and [server/src/app.ts](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/server/src/app.ts) so they become composition roots instead of feature containers.
- Preserve current runtime behavior and test outcomes.

## Non-Goals

- No product redesign.
- No database schema changes.
- No API contract redesign.
- No feature additions beyond minimal adapter code needed to preserve behavior through the move.
- No broad rewrite of store/persistence architecture unless a small extraction is required for the folder split.

## Target Structure

### Client

- `client/src/app/`
  - app bootstrap, route composition, app shell wiring
- `client/src/core/`
  - shared API client, shared types/helpers, shared presentational pieces that are not feature-owned
- `client/src/features/auth/`
  - auth page, profile completion, auth-specific tests and supporting modules
- `client/src/features/groups/`
  - dashboard groups list, invitations, group detail shell
- `client/src/features/ledger/`
  - ledger section, expense composer, balances, settle-up, settlement history, ledger tests

### Server

- `server/src/app/`
  - express bootstrap, route registration, request/auth middleware/helpers
- `server/src/core/`
  - environment, database bootstrap, and shared libs such as money/session/ledger helpers when those are truly cross-feature
- `server/src/features/auth/`
  - auth and profile routes/handlers
- `server/src/features/groups/`
  - groups, invitations, dashboard flows
- `server/src/features/ledger/`
  - expense, ledger, settlement, and member-removal routes/handlers
- `server/src/store/`
  - shared store contracts and adapters remain centralized unless a smaller split clearly improves the result without changing behavior

## Design Rules

- Prefer moving code over rewriting code.
- Keep one top-level entry/composition file per side, but make it thin.
- Feature folders own feature-specific UI, handlers, and tests.
- Shared infrastructure belongs in `core`, not in a feature folder.
- Avoid replacing one giant file with one giant feature index file.
- Preserve stable import surfaces during transition when helpful, then simplify once compilation is green.

## Client Migration Boundaries

- Route/page logic inside [client/src/App.tsx](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/client/src/App.tsx) will be extracted into feature-owned modules.
- [client/src/api.ts](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/client/src/api.ts) will move toward a `core` HTTP client plus feature-grouped exports or modules layered on top of it.
- [client/src/components/group-ledger-section.tsx](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/client/src/components/group-ledger-section.tsx) and [client/src/components/group-expenses-section.tsx](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/client/src/components/group-expenses-section.tsx) will move under feature folders.
- Feature tests will move with the feature they exercise.
- Global styles may stay centralized if splitting them would create noise without clear ownership benefits, but any obvious feature-local styling helpers can move with their feature.

## Server Migration Boundaries

- [server/src/app.ts](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/server/src/app.ts) will become a thin composition root.
- Route schemas, request validation helpers, and handlers will be extracted by feature where possible.
- [server/src/lib/money.ts](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/server/src/lib/money.ts), [server/src/lib/session.ts](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/server/src/lib/session.ts), and [server/src/lib/ledger.ts](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/server/src/lib/ledger.ts) will move under `core/lib` or an equivalent shared location.
- [server/src/db.ts](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/server/src/db.ts) and [server/src/env.ts](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/server/src/env.ts) will move under `core`.
- Store contracts/adapters can stay in [server/src/store/](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/server/src/store/) unless the extraction naturally reveals a better low-risk split.

## Execution Strategy

1. Create destination folders and move low-risk shared modules first.
2. Extract client feature modules from [client/src/App.tsx](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/client/src/App.tsx) without changing route behavior.
3. Extract server feature route modules from [server/src/app.ts](/Users/davideceresa/Documents/Code/GitHub/Superpower-test/server/src/app.ts) without changing endpoint behavior.
4. Move or regroup tests alongside their feature areas where it improves ownership and discoverability.
5. Run verification after each major slice and again at the end.

## Safety Checks

- If a move changes behavior, stop and fix it before continuing.
- Keep mechanical refactors separate from optional cleanup where possible.
- Do not change user-visible copy or API response shapes except where an adapter is needed to preserve current behavior during the move.
- Use the existing test suite as the primary guardrail for behavior preservation.

## Expected Outcome

- Thinner application entry files.
- Clearer ownership of auth, groups, and ledger code on both client and server.
- A shared `core` layer that contains infrastructure instead of feature logic.
- Easier future work on additional features without increasing top-level file sprawl.
