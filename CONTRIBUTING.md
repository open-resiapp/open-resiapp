# Contributing to OpenResiApp

Thanks for your interest in contributing! OpenResiApp is an open-source tool for managing Slovak residential buildings, and every contribution helps make it better for building administrators and owners across Slovakia.

## Ways to Contribute

- **Report bugs** — found something broken? [Open an issue](https://github.com/open-resiapp/open-resiapp/issues/new?template=bug_report.yml)
- **Request features** — have an idea? [Start a discussion](https://github.com/open-resiapp/open-resiapp/discussions/categories/feature-requests)
- **Fix bugs** — check [open issues](https://github.com/open-resiapp/open-resiapp/issues) for things to work on
- **Improve translations** — help translate the UI to more languages
- **Write documentation** — better docs help everyone
- **Share your setup** — running OpenResiApp? Tell us about it in [Discussions](https://github.com/open-resiapp/open-resiapp/discussions)

## Development Setup

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL)

### Getting Started

```bash
git clone https://github.com/open-resiapp/open-resiapp.git
cd open-resiapp
npm install
docker compose up db        # start PostgreSQL
npm run db:generate
npm run db:migrate
npm run db:seed             # creates test data
npm run dev                 # http://localhost:3000
```

### Test Credentials

| Role  | Email          | Password   |
|-------|----------------|------------|
| Admin | admin@test.sk  | Admin123!  |
| Owner | jan@test.sk    | Admin123!  |

## Making Changes

### 1. Fork and branch

```bash
git checkout -b feature/your-feature
# or
git checkout -b fix/your-bugfix
```

### 2. Follow the conventions

- **Code is in English** — variable names, functions, comments, file names
- **UI text is in Slovak and English** — all user-facing strings go through `next-intl` translation files (`messages/sk.json`, `messages/en.json`)
- **Tailwind CSS** for styling — follow existing patterns
- **Minimum 16px font size** for accessibility

### 3. Translation changes

If you add or change UI text:

1. Add the key to both `messages/sk.json` and `messages/en.json`
2. Use `useTranslations()` hook in components
3. Never hardcode user-facing text in components

### 4. Database changes

If your change requires schema modifications:

1. Edit `src/db/schema.ts`
2. Run `npm run db:generate` to create a migration
3. Run `npm run db:migrate` to apply it
4. Include the migration files in your PR

### 5. Commit and push

Write clear commit messages that explain **what** and **why**.

```bash
git commit -m "Add entrance filter to announcements board"
git push origin feature/your-feature
```

### 6. Open a Pull Request

- Describe what your PR does and why
- Link any related issues
- Include screenshots for UI changes
- Make sure existing functionality still works

## Project Structure

```
src/
  app/
    [locale]/(auth)/       # login pages
    [locale]/(dashboard)/  # protected pages (board, voting, owners, etc.)
    api/                   # API routes (not inside [locale])
  components/              # React components
  db/
    schema.ts              # Drizzle ORM schema (all tables)
  lib/
    auth.ts                # NextAuth v5 config
    permissions.ts         # Role-based access control
    voting.ts              # Weighted voting logic
  types/
    index.ts               # Shared TypeScript types
messages/
  sk.json                  # Slovak translations
  en.json                  # English translations
```

## Code of Conduct

Be respectful and constructive. We're building this for real communities — let's be a good one ourselves.

- Be welcoming to newcomers
- Assume good intentions
- Focus on what's best for the project
- Respect different viewpoints

## Questions?

- [GitHub Discussions](https://github.com/open-resiapp/open-resiapp/discussions) — ask anything
- [Issues](https://github.com/open-resiapp/open-resiapp/issues) — report bugs

Thanks for helping make residential building management better!