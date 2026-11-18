# Ôn thi trắc nghiệm — Online Quiz Practice Platform

Invitation-only quiz practice for a small group: import multiple-choice PDFs, verify the answer keys (optionally with AI), publish timed exams, and review graded results.

**Stack:** Next.js 16 (App Router, TypeScript strict) · Tailwind + shadcn/ui (Base UI) · Supabase (Postgres + RLS, Auth, Storage) · Vercel Hobby · optional LLM (Anthropic or any OpenAI-compatible API).

## Features

- **Invitation-only accounts.** The admin creates single-use invite links (72 h) and can revoke them or deactivate users. There is no public sign-up.
- **PDF import.** Text PDFs with numbered questions, options in a 2-column grid and an "Đáp án" key at the end. Options are identified by their grid letter, and answers are mapped by question number. Missing, invalid and ambiguous answers are flagged, along with options that refer to other options ("Cả B và C").
- **AI fallback (optional).** Only for unresolved or selected questions. The number of questions is shown before anything is sent, responses are cached, and every AI answer must be verified before publishing.
- **Quiz management.** Subjects, single / multiple / mixed answer modes, per-question type, a side-panel editor, preview, publishing to immutable versions, archiving.
- **Exams.**
  - The server sets the start time and deadline.
  - Answers autosave, retry when offline, and resume after a refresh.
  - Students can flag questions and jump between them with a numbered grid.
  - The exam submits itself at the deadline, and attempts abandoned in a closed browser are closed and graded by the server.
- **Grading.** Exact-set match with no partial credit. Score = correct ÷ total × 10, shown with 2 decimals.
- **Results and history.** A per-question review with explanations, wrong-answer and unanswered filters, retakes, best and latest score per quiz, and an admin view of all attempts.

Design docs: [`docs/`](docs/), covering requirements, architecture, implementation plan, detailed design (DB/API/PDF), UI/UX, and testing & deployment.

## Local development

Requirements: Node 24, npm, Docker Desktop (running).

```bash
npm install
npm run db:start                  # local Supabase in Docker (applies migrations)
cp .env.example .env.local        # fill keys from: npx supabase status
npx tsx scripts/bootstrap-admin.ts --email you@example.com --name "Admin"
npm run dev                       # http://localhost:3000
```

Then sign in, go to **Quản trị → Môn học** (add a subject), then **Nhập PDF**, upload `input/PLDC1.pdf`, review it and publish. Invite a student from **Người dùng**.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | Static checks |
| `npm test` | Unit tests (parser, grading, validation, AI response checks) |
| `npm run test:int` | Integration tests against local Supabase. **Wipes the local database** |
| `npm run test:e2e` | Playwright (desktop + 360 px), uses a local AI stub. **Wipes the local database** |
| `npm run db:start` / `db:reset` / `db:stop` | Local Supabase |
| `npm run bootstrap-admin` | Create the first admin account |
| `npx tsx scripts/dump-pdf-items.mts <file.pdf>` | Dump a PDF's positioned text (for new parser fixtures) |

## Deployment (free tier)

Full guide: [`docs/testing-and-deployment.md`](docs/testing-and-deployment.md) Part B. In short:

1. **Supabase (Free):**
   - Create a project in Singapore.
   - Under Auth, turn **off** "Allow new users to sign up".
   - Run `npx supabase login`, then `npx supabase link --project-ref <ref>` (the ref is the ID in the project URL, e.g. `abcd1234` from `https://abcd1234.supabase.co`), then `npx supabase db push --remote`.
2. **Vercel (Hobby):** import the GitHub repo and set these variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `APP_ORIGIN`
   - optionally `AI_PROVIDER`, `AI_API_KEY` and `AI_MODEL`.
3. **First admin:** run `npx tsx scripts/bootstrap-admin.ts --env .env.prod …` against production.
4. **GitHub Actions secrets:**
   - `APP_ORIGIN`: the keep-alive job pings `/api/health` every 3 days.
   - `SUPABASE_DB_URL`: used by the weekly backup job, which stores dumps as private artifacts for 90 days.

   Keep the repository private.

AI is optional. Without `AI_PROVIDER` / `AI_API_KEY` the app works fully, and answers are entered or confirmed manually.

## Status

- [x] M1 — Foundation & invitation-only auth
- [x] M2 — Subjects, quizzes, question editor
- [x] M3 — PDF import & answer verification
- [x] M4 — Exam & grading
- [x] M5 — Results, history, CI/backup/keep-alive, docs. **Production deployment still to be done:** it needs your Supabase and Vercel accounts.
