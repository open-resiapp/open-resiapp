# BytovaApp

Open-source web application for managing residential apartment buildings (bytove domy) in Slovakia. Built for building administrators, owners, and tenants to handle voting, announcements, document management, and owner administration.

## Features

- **Board (Nastenka)** — Post announcements with categories (info, urgent, event, maintenance), pin/unpin posts
- **Voting** — Weighted voting by ownership share, electronic and paper ballots, mandate delegation, audit trail
- **Owner Management** — User CRUD with role-based access (admin, owner, tenant, vote counter)
- **Documents** — Upload and share building documents
- **Settings** — Building configuration and management
- **Authentication** — Secure login with NextAuth v5 credentials provider
- **RBAC** — Role-based permissions across all features

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Database:** PostgreSQL 16
- **ORM:** Drizzle ORM
- **Auth:** NextAuth v5 (beta)
- **Deployment:** Docker + Caddy

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 16 (or Docker)
- npm

### Setup

1. Clone the repository:

```bash
git clone https://github.com/open-housing/byt-app.git
cd byt-app
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file based on `.env.example` and configure your database connection and auth secret.

4. Start the database (if using Docker):

```bash
docker compose up db
```

5. Run migrations and seed:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

6. Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Seed Credentials

| Role  | Email          | Password   |
|-------|----------------|------------|
| Admin | admin@test.sk  | Admin123!  |
| Owner | jan@test.sk    | Admin123!  |
| Owner | maria@test.sk  | Admin123!  |
| Owner | peter@test.sk  | Admin123!  |
| Owner | anna@test.sk   | Admin123!  |

## Project Structure

```
src/
  app/
    (auth)/           # Login page
    (dashboard)/      # Protected pages
      board/          # Announcements board
      voting/         # Voting system
      owners/         # Owner/user management
      settings/       # Building settings
    api/              # API routes
  components/         # Reusable UI components
  db/                 # Schema, migrations, seed
  lib/                # Auth, permissions, voting logic
  types/              # TypeScript type definitions
```

## Scripts

| Command              | Description                    |
|----------------------|--------------------------------|
| `npm run dev`        | Start development server       |
| `npm run build`      | Build for production           |
| `npm run start`      | Start production server        |
| `npm run lint`       | Run ESLint                     |
| `npm run db:generate`| Generate Drizzle migrations    |
| `npm run db:migrate` | Run database migrations        |
| `npm run db:seed`    | Seed database with test data   |
| `npm run db:studio`  | Open Drizzle Studio            |

## Contributing

Contributions are welcome! Please read the [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

This project is licensed under the [MIT License](LICENSE).
