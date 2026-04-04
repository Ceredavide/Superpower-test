# Expense Groups Auth Design

**Date:** 2026-04-04

## Goal

Build a web application where users can register, log in, create expense groups, and invite existing registered users to groups by email or display name. Data must persist in a real PostgreSQL database and survive page refreshes.

## Chosen Stack

- React SPA in `client/`
- Express REST API in `server/`
- PostgreSQL for persistence
- Prisma ORM for schema and database access
- Cookie-based authentication with server-side sessions
- React Router for client-side navigation

## Product Scope

### In Scope

- User registration with email and password
- User login and logout
- Persistent authenticated sessions across page refreshes
- Required profile completion for a unique display name after sign-up
- Create expense groups
- View groups a user belongs to
- Invite already-registered users to groups by email or display name
- View pending invitations
- Accept or decline invitations
- Persist all application data in PostgreSQL

### Out Of Scope

- Expense entry creation or settlement flows
- Sending real invitation emails
- Password reset
- Social auth
- Roles beyond `owner` and `member`

## Architecture

The repository will be organized as a small monorepo with a React frontend and an Express backend. The frontend is responsible for rendering forms, protected routes, and authenticated pages. The backend owns authentication, validation, authorization, and all database reads and writes.

In development, the client and server run as separate processes. In production, the Express server can serve the built React assets in addition to the API routes. The browser never connects to PostgreSQL directly.

Authentication uses an HTTP-only cookie that contains an opaque session token. The server stores only a hash of that token in the database, along with the user relationship and expiration time. On page refresh, the frontend calls `GET /auth/me` to rehydrate the current session from the cookie.

## Data Model

### User

- `id`
- `email` - unique, required, stored lowercase
- `passwordHash` - required
- `displayName` - unique case-insensitively, nullable until completed, then required for normal app usage
- `createdAt`
- `updatedAt`

### Session

- `id`
- `userId`
- `tokenHash` - unique
- `expiresAt`
- `createdAt`

### ExpenseGroup

- `id`
- `name`
- `ownerId`
- `createdAt`
- `updatedAt`

### GroupMembership

- `id`
- `groupId`
- `userId`
- `role` - `owner` or `member`
- `createdAt`

Constraint: one membership per `groupId` + `userId`.

### GroupInvitation

- `id`
- `groupId`
- `invitedUserId`
- `invitedByUserId`
- `status` - `pending`, `accepted`, `declined`
- `createdAt`
- `respondedAt`

Constraint: at most one pending invitation per `groupId` + `invitedUserId`.

## Core Flows

### Registration

1. User submits email and password.
2. Server validates input, rejects duplicate email, hashes the password, creates the user, creates a session, and sets the auth cookie.
3. Frontend redirects to the profile completion page because `displayName` is still unset.

### Profile Completion

1. Authenticated user submits a display name.
2. Server validates uniqueness and updates the user record.
3. Frontend redirects to the dashboard.

Users without a display name can access logout, `GET /auth/me`, and profile completion, but they cannot create groups or respond to invitations until the display name is set.

### Login

1. User submits email and password.
2. Server verifies the password, creates a session, and sets the auth cookie.
3. Frontend loads the current user and routes to profile completion or dashboard based on `displayName`.

### Group Creation

1. Authenticated user with a completed profile submits a group name.
2. Server creates the `ExpenseGroup` with that user as `ownerId`.
3. Server also creates a `GroupMembership` row for the owner with role `owner`.
4. Frontend refreshes the group list and navigates to the new group page.

### Invite By Email Or Display Name

1. Group owner enters either an email address or a display name.
2. Server determines lookup type:
   - valid email format: normalize to lowercase and exact-match on `User.email`
   - otherwise: exact-match on `User.displayName` using case-insensitive uniqueness rules
3. If no registered user matches, the server returns a validation error.
4. If the user is already a member or already has a pending invite for that group, the server returns a validation error.
5. Otherwise, the server creates a pending `GroupInvitation`.

### Invitation Response

1. Authenticated invited user views pending invitations on the dashboard.
2. User accepts or declines.
3. On accept, the server marks the invitation accepted, timestamps `respondedAt`, and creates a `GroupMembership` with role `member`.
4. On decline, the server marks the invitation declined and timestamps `respondedAt`.

## Frontend Structure

### Pages

- Auth page with registration and login forms
- Profile completion page
- Dashboard page showing:
  - groups the current user belongs to
  - pending invitations
- Group detail page showing:
  - group name
  - member list
  - invite form for owners

### Client Behavior

- App boot calls `GET /auth/me`
- Protected routes redirect unauthenticated users to the auth page
- Users missing `displayName` are redirected to profile completion until finished
- Forms show inline validation errors from API responses
- Logout clears session state and returns the user to the auth page

## API Contract

### Auth

- `POST /auth/register`
  - body: `email`, `password`
- `POST /auth/login`
  - body: `email`, `password`
- `POST /auth/logout`
- `GET /auth/me`

### Profile

- `PATCH /users/me/profile`
  - body: `displayName`

### Groups

- `GET /groups`
- `POST /groups`
  - body: `name`
- `GET /groups/:groupId`

### Invitations

- `POST /groups/:groupId/invitations`
  - body: `identifier`
  - `identifier` accepts either email or display name
- `POST /invitations/:invitationId/accept`
- `POST /invitations/:invitationId/decline`

## Validation And Authorization

### Validation Rules

- Email must be present and unique at registration
- Password must be present and at least 8 characters at registration and login
- Display name must be present and unique case-insensitively when completing profile
- Group name must be present and non-empty
- Invitation identifier must be present and resolve to an existing registered user
- Duplicate pending invites are rejected

### Authorization Rules

- Only authenticated users may access protected routes
- Only users with completed profiles may create groups or respond to invitations
- Only group owners may create invitations for a group
- Only group members may view that group’s details
- Only the invited user may accept or decline a specific invitation

## Error Handling

The API will return structured JSON errors with clear messages for invalid credentials, duplicate accounts, duplicate display names, nonexistent invite targets, duplicate invites, unauthorized access, and not-found resources. The frontend will surface those messages inline on the relevant form or page.

## Security Notes

- Passwords are stored only as hashes
- Session cookies are `HttpOnly`
- Session tokens are stored hashed in the database
- Server authorization checks do not rely on client state
- The frontend will not store auth tokens in `localStorage`

## Testing Strategy

### Backend

- Registration success and duplicate-email rejection
- Login success and invalid-credential rejection
- Session persistence through `GET /auth/me`
- Profile completion and duplicate-display-name rejection
- Group creation with owner membership creation
- Group list and group detail authorization
- Invite lookup by email
- Invite lookup by display name
- Reject invite for nonexistent user
- Reject duplicate pending invite
- Accept invitation creates membership
- Decline invitation does not create membership

### Frontend

- Register flow redirects to profile completion
- Login flow restores user session
- Protected routes block unauthenticated access
- Profile completion gate blocks incomplete users from the dashboard
- Dashboard renders groups and invitations
- Group owner can submit an invite
- Invited user can accept or decline an invitation

## Implementation Notes

Prisma should model the unique constraints directly so duplicate cases are enforced both in application logic and at the database level. The server should keep route handlers thin by separating request validation, auth/session helpers, and database operations into focused modules. The client should keep data-fetching logic near route-level pages and use small reusable form components only where duplication is real.
