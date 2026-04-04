# Expense Groups Auth App

Full-stack React + Express web application for user registration, login, expense groups, and invitations backed by PostgreSQL.

## Development

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL: `docker compose up -d`.
3. Install dependencies: `npm install`.
4. Sync the schema: `npm run db:push`.
5. Generate Prisma client if needed: `npm run db:generate`.
6. Start the app: `npm run dev`.

## Verification

- `npm test`
- `npm run build`
