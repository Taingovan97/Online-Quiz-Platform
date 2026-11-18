# Ôn thi trắc nghiệm — Online Quiz Practice Platform

Invitation-only quiz practice app: import multiple-choice PDFs, verify answer keys, take timed exams, review results.

Stack: Next.js 16 (App Router, TypeScript strict) · Tailwind + shadcn/ui (Base UI) · Supabase (Postgres + RLS, Auth, Storage) · Vercel Hobby.

Design docs live in [`docs/`](docs/): requirements, architecture, implementation plan, detailed design, UI/UX, testing & deployment.

## Local development

Requirements: Node 24, npm, Docker Desktop (running).

```bash
npm install
npm run db:start                  # local Supabase in Docker
npm run db:reset                  # apply supabase/migrations
cp .env.example .env.local        # fill keys from: npx supabase status
npm run bootstrap-admin -- --email you@example.com --name "Admin"
npm run dev                       # http://localhost:3000
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | Static checks |
| `npm test` | Unit tests (pure modules) |
| `npm run test:int` | Integration tests (needs local Supabase running) — **wipes the local database** |
| `npm run test:e2e` | Playwright browser tests (desktop + 360 px) — **wipes the local database** |
| `npm run db:start` / `db:reset` / `db:stop` | Local Supabase |
| `npm run bootstrap-admin` | Create the first admin account |

## Status

- [x] M1 — Foundation & invitation-only auth
- [x] M2 — Subjects, quizzes, question editor
- [ ] M3 — PDF import & answer verification
- [ ] M4 — Exam & grading
- [ ] M5 — Results, history, deployment
