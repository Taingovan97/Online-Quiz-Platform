# Testing Strategy & Deployment Guide

Status: **Approved 2026-11-18**.

---

## Part A — Testing

### A.1 Tools and layers

| Layer | Tool | Runs against | When |
|---|---|---|---|
| Unit | Vitest | Pure modules: `lib/pdf-import`, `lib/grading`, `lib/quiz`, `lib/ai` (mocked fetch) | Every save (watch mode), and CI |
| Integration | Vitest + local Supabase (`supabase start`, Docker) | Server actions and database rules (RLS) called directly, with real user logins | CI, and before finishing each milestone |
| End-to-end | Playwright (Chromium, desktop and a 360 px mobile viewport) | The Next.js dev server + local Supabase, with AI mocked by a local stub server | CI (one main-flow test), and before deployment |

CI: one GitHub Actions workflow runs `lint → typecheck → unit → (supabase start) → integration → e2e`.

### A.2 Unit tests (SRD §9)

| SRD item | Test file | Main cases |
|---|---|---|
| PDF question splitting | `pdf-import/segment.test.ts` | PLDC1 gives 42 questions; questions without a blank line before them (Q7, Q13, Q25); multi-line stems (Q19, Q20, Q26); no answer-key line becomes a question; header removed; expected count of 42 read |
| Option extraction | `pdf-import/grid.test.ts` | 4 options per question; wrapped option text; outer letter on the option's second line (Q8, Q11, Q38, Q41); inner label removed; deliberately mismatched grid → `GRID_MISMATCH` |
| Answer validation | `pdf-import/answer-key.test.ts` | Lowercase key in 4 columns; multi-letter `A, C`; `Câu 1: B` form; explanation lines; missing / invalid / ambiguous / orphaned / duplicate cases; partial key (5 entries removed → 37 kept, 5 missing) |
| Answer-mode validation | `quiz/validate.test.ts` | Every `ValidationIssue` code; mixed mode allows each question its own type; Mode B fails when any question has one correct option |
| Single-answer grading | `grading/grade.test.ts` | SRD example 1; a wrong pick; no pick → unanswered |
| Multiple-answer grading | same file | SRD examples 2–4; order of picks doesn't matter |
| Score calculation | same file | 0/42 → 0; 42/42 → 10; 7/42 → 1.6667 stored, "1,67" shown; half-up rounding at the edge (e.g. 0.125 → "0,13") |
| Timer and deadline rules | `grading/deadline.test.ts` | Save allowed at deadline + 9 s and rejected at + 11 s; a submission after the deadline is recorded as `timeout`; `submitted_at` capped at deadline + grace |
| AI response checks | `ai/validate.test.ts` | Unknown `ref`, label not among the options, wrong number of labels, text that isn't JSON → rejected; cache key is stable |
| Invite token | `auth/token.test.ts` | Hash only; expiry comparison |

### A.3 Integration tests (SRD §9)

Each test runs against a fresh local database (`supabase db reset`, then a fixture seed). Users are created with the admin key and the tests log in as them.

| SRD item | Scenario |
|---|---|
| PDF import | `processImport` on PLDC1 → database has 1 draft quiz, 42 questions, 168 options; options matching the key have `is_correct`; `import_jobs.summary` = {total 42, extractedValid 42} |
| Review and publishing | Edit a question's correct options → `manually_verified` and `original_answer` unchanged; publishing a quiz with a `missing` question → `PUBLISH_BLOCKED`; fix it → publish → `quiz_versions` v1; edit → republish → v2, v1 unchanged and cannot be updated (trigger) |
| Invitation authorization | Student calling `createInvitation` → `FORBIDDEN`; sign-up through the public key → rejected; reused, expired or revoked token → `INVITE_INVALID`; student `update profiles set role='admin'` → 0 rows; deactivated user blocked |
| Answer-key protection | Student logged in: `select` from `questions`, `question_options`, `quiz_versions` → 0 rows; the exam page's data contains no `correct` or `explanation` |
| Quiz submission | Two `submitAttempt` calls at once → one submission, same score; `saveAnswer` after submitting → `ATTEMPT_CLOSED`; after the grace period → `DEADLINE_PASSED`; attempt past its deadline with no submit → closed as `timeout` when listed |
| Result persistence | Grading failure simulated after the claim → result page grades it on the next read |
| Attempt history integrity | Attempt on v1 → admin edits the stem and correct answer and republishes v2 → v1 attempt's result page and score are byte-for-byte the same |

### A.4 End-to-end tests (SRD §9, 10 steps)

`e2e/main-flow.spec.ts`, in one test file using two browser sessions (admin and student):

1. Admin logs in and uploads `PLDC1.pdf`.
2. The review summary shows 42 questions.
3. The test clears the answers of 5 questions in the database to simulate a partial key, so 5 questions show "Thiếu đáp án" (missing answer). The parser's real partial-key behaviour on this PDF is covered by unit tests, so production code has no test-only flag.
4. Admin clicks "Hỏi AI (5 câu)" and confirms. The AI stub (`e2e/ai-stub.mjs`, OpenAI-compatible, local, free) answers.
5. Publishing is blocked until the answers are verified. The admin verifies all questions.
6. Admin publishes.
7. The student starts the exam.
8. The student answers and submits. The timeout variant (a 1-minute quiz with the clock moved forward via `page.clock`) is in `e2e/exam.spec.ts`.
9. The results page shows the expected score (1/42 → "0,24").
10. The student opens the history, then the "Câu sai" (wrong answers) view. The library card shows best and latest scores, and the admin sees the attempt.

All browser specs run on two projects: desktop and a 360 px viewport. Playwright starts both the AI stub and the dev server, with AI pointed at the stub. Real AI providers are never called in tests.

### A.5 Fixtures

- `tests/fixtures/pdf/PLDC1.pdf`, plus `PLDC1.items.json` (the raw positioned text items, regenerated with `npx tsx scripts/dump-pdf-items.mts tests/fixtures/pdf/PLDC1.pdf > tests/fixtures/pdf/PLDC1.items.json`).
- The expected key and hand-checked option texts live in `src/lib/pdf-import/parse.test.ts`.
- Variants are made by editing a copy of the items in the test (see design §C.9).
- **Every new real PDF that breaks the parser gets added as a fixture before the fix.**

---

## Part B — Deployment & operations

### B.1 Requirements

Node 24, npm, Docker Desktop (for the local Supabase), Supabase CLI, a GitHub account, a Vercel account (Hobby), a Supabase account (Free).

### B.2 Environment variables (`.env.example`)

| Variable | Where it is used | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser and server | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser and server | no (protected by RLS) |
| `SUPABASE_SECRET_KEY` | server only (`server/admin-client.ts` imports `server-only`) | **yes** |
| `APP_ORIGIN` | building invite links, e.g. `https://quiz.example.vercel.app` | no |
| `INVITE_TTL_HOURS` | default 72 | no |
| `AI_PROVIDER` | `anthropic` \| `openai-compatible`; leave empty to turn AI off | no |
| `AI_API_KEY` | server only | **yes** |
| `AI_MODEL` | Defaults to `claude-opus-5-5` (Anthropic) or `gpt-4o-mini` (OpenAI-compatible). A cheaper model such as `claude-haiku-5-5` works too; the choice and its cost are yours | no |
| `AI_BASE_URL` | needed only for OpenAI-compatible providers other than OpenAI | no |
| `AI_BATCH_SIZE` | default 20 | no |

### B.3 Local development

```bash
npm install
npm run db:start               # local Postgres, Auth and Storage in Docker (applies migrations)
cp .env.example .env.local     # fill API_URL / PUBLISHABLE_KEY / SECRET_KEY from `npx supabase status`
npm run bootstrap-admin -- --email you@example.com --name "Admin"   # asks for a password
npm run dev                    # http://localhost:3000
npm test && npm run test:int && npm run test:e2e   # integration + e2e WIPE the local database
```

`npx playwright install chromium` is needed once before the first e2e run.

### B.4 Supabase project setup (production)

1. Create a project on the Free plan, in the region closest to your users (e.g. Singapore).
2. **Auth → Providers → Email:** turn email login on, turn **"Allow new users to sign up" off**, and turn "Confirm email" off (the app confirms invited users itself).
3. **Auth → URL configuration:** set the Site URL to `APP_ORIGIN`.
4. Apply the migrations: `npx supabase link --project-ref <ref>`, then `npx supabase db push --remote` (preview first with `--dry-run`). The migrations also create the `imports` storage bucket and its rules, so nothing needs clicking in the dashboard.
5. **Project Settings → API keys:** copy the project URL, the **publishable** key and the **secret** key into Vercel's environment variables.
6. Bootstrap the admin against production: put the production values in a temporary file (e.g. `.env.prod`), run `npm run bootstrap-admin -- --env .env.prod --email … --name "…"`, then delete the file.

### B.5 Migrations

- Migrations are plain SQL in `supabase/migrations/`, timestamped, and only ever added, never edited.
- Each milestone adds its own migration (M1 auth, M2 quizzes, M3 imports and AI, M4 attempts).
- To change the schema: `npx supabase migration new <name>` → write the SQL → `npm run db:reset` locally → run the tests → `npx supabase db push --remote`.
- To undo a change, write a new migration that reverses it.

### B.6 Storage rules

Created in a migration:
- `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('imports','imports', false, 10485760, '{application/pdf}')`
- A `storage.objects` policy limiting `select/insert/delete` to `bucket_id = 'imports' and is_admin()`.

The server also checks the `%PDF-` file header itself. Uploaded PDFs are small (the sample is 165 KB) and are kept for re-checking. If storage ever gets close to the 1 GB limit, delete old files under Storage → `imports` in the Supabase dashboard; quizzes don't depend on them after import. (A "Xoá file PDF gốc" button was deferred; it isn't needed at this scale.)

### B.7 Admin bootstrap

`scripts/bootstrap-admin.ts`:
1. Asks for a password.
2. Calls `auth.admin.createUser({ email, password, email_confirm: true })`.
3. Inserts `profiles(role = 'admin')`.

The script refuses to run if an admin already exists, unless `--force` is passed. The admin role can only be granted with the admin key; there is no in-app way to promote a user (prevents users granting themselves admin).

### B.8 Invitation workflow (operator view)

1. Quản trị (administration) → Người dùng (users) → **Mời người dùng** (invite a user) → enter the email → **Sao chép liên kết** (copy the link). The link is shown only once.
2. Send the link through any channel (Zalo, Messenger, email).
3. The invitee opens it within 72 h and sets a name and password. They are logged in as a student.
4. Lost or expired link: create a new invitation (the old one is revoked automatically).
5. Removing access: Users → turn **Hoạt động** (active) off. Their sessions are ended right away and their history is kept.

### B.9 Vercel deployment

1. Push the repo to GitHub and import it in Vercel (framework: Next.js; the defaults are fine).
2. Add the B.2 variables for Production and Preview. Only Production gets the real AI key.
3. Deploy. Every push to `main` deploys to production, and pull requests get preview URLs.
4. The functions run in the region `sin1`, next to Supabase Singapore (`vercel.json` → `"regions": ["sin1"]`).
5. **Note:** Vercel Hobby is for non-commercial use only.

### B.10 Maintenance

| Task | How | Frequency |
|---|---|---|
| Stop the Supabase Free project from pausing | `.github/workflows/keepalive.yml` calls `GET /api/health`, which runs a tiny database query | Every 3 days |
| Back up the database | `.github/workflows/backup.yml`: `supabase db dump --remote=<url>` (schema) + `--data-only` → stored as a workflow artifact (kept 90 days) | Weekly (Sunday) |
| Test a restore | Run `psql` against a local `supabase start` database using the latest dump | Once at launch, then every quarter |
| Check usage | Supabase dashboard (database size < 500 MB, storage < 1 GB), Vercel usage page | Monthly |
| Update dependencies | `npm outdated`, Dependabot for security fixes only | Monthly |
| Rotate keys | Supabase service key or AI key: update it in Vercel → redeploy | When a key may have leaked |

GitHub Actions secrets: `SUPABASE_DB_URL` (Supabase → Connect → session pooler URI, with the password) and `APP_ORIGIN`. The repository should be private, because the backups are stored with it.

`.github/workflows/ci.yml` runs lint, typecheck and unit tests, then starts a local Supabase and runs the integration and e2e suites on every push and pull request.

**Restoring a backup:** download the artifact, then run `psql "$DB_URL" -f schema.sql` followed by `psql "$DB_URL" -f data.sql` against an empty project, or against a local `npm run db:start` database to test it.
