# Implementation Plan — Online Quiz Practice Platform (MVP)

Status: **Approved 2026-11-18**. Each milestone ends with a demo and a passing test suite before the next one starts.

## Phase 2 — Detailed design (before any code)

Deliverables, merged per requirements §5:
- `docs/design.md`: full database schema and RLS policies, server action and route contracts, PDF parser rules and test fixtures.
- `docs/ui-ux-design.md`: the 12 screens, wireframes, component list, Vietnamese wording.
- `docs/testing-and-deployment.md`: test matrix, environment variables, Supabase setup, migrations, admin bootstrap, Vercel deployment, maintenance.

**Acceptance:** owner approves all three.

## Phase 3 — Milestones

### M1 — Foundation & invitation-only auth
- Set up Next.js + TypeScript strict, Tailwind, shadcn/ui, ESLint, Vitest, Playwright, Supabase CLI.
- Migrations: `profiles`, `invitations`, and their RLS rules. Turn off public sign-up.
- Login and logout. Middleware that checks the session, the role and `is_active`. Separate admin and student layouts.
- Invitation screen (create, copy link, revoke, list), the accept-invite page, and user deactivation.
- `scripts/bootstrap-admin.ts`.

**Acceptance criteria**
- A visitor who isn't logged in is sent to `/login` from every page. There is no sign-up route, and signing up directly through the Supabase API is rejected.
- An invite link works once, fails after 72 h, and fails after being revoked.
- A student cannot update their own `role` or `is_active`. Tested with the student's own login against the database rules (RLS).
- A deactivated user is logged out on their next request.

**Tests:** unit tests for token hashing and expiry; integration tests for accepting invitations and for RLS role protection.

### M2 — Subjects, quizzes, question editor
- Migrations: `subjects`, `quizzes`, `questions`, `question_options`, `quiz_versions`.
- Create, edit and delete subjects and quizzes. Quiz library page with filters.
- Question editor: stem, options (add, delete, reorder), correct options, selection type, explanation, answer status and source shown as badges.
- Quiz settings: duration, default answer mode, individual question overrides.
- Publish checks (`lib/quiz/validate.ts`):
  - every question has at least 2 options and is `VERIFIED` or `EXTRACTED_VALID`
  - single-answer questions have exactly 1 correct option; multiple-answer questions have at least 2
  - questions follow the quiz's mode.
- Publishing saves a frozen copy of the quiz (snapshot). Unpublish and archive. Preview as a student would see it.

**Acceptance criteria**
- Publishing is refused, with a list of the questions that fail the rules, when any rule is broken. Mode B is refused if any question has only one correct option.
- Editing a published quiz and publishing it again creates version 2; version 1 is unchanged.
- A student's login cannot read `questions`, `question_options` or `quiz_versions` directly.

**Tests:** unit tests for answer-mode checks and building the snapshot; integration tests for publishing and the RLS rule that hides answers.

### M3 — PDF import & answer verification
- Private `imports` storage bucket with admin-only rules. Signed upload URL. `import_jobs` table.
- `lib/pdf-import`: text and position extraction, splitting into questions and the answer key, option grid, answer mapping, validation (rules in architecture §4).
- Import review screen:
  - summary (total, extracted, from AI, needs review)
  - problem questions listed first, with filters by status
  - inline editing
  - "Xác nhận" (confirm) per question and in bulk
- Optional AI: `lib/ai` adapters, `ai_suggestions` cache, a confirmation dialog showing the number of questions, display of AI results.

**Acceptance criteria**
- `input/PLDC1.pdf` gives **42 questions × 4 options**, and all 42 answers are `EXTRACTED_VALID` and match the outer-letter key. Tested against a hand-checked expected JSON fixture.
- The parser handles each quirk listed in requirements §2:
  - wrapped option text
  - outer letter on an option's second line (Q8, Q11, Q38, Q41)
  - no blank line before a question (Q7, Q13, Q25)
  - the key following the last question directly
  - combining accents
- No line of the answer key ever becomes a question.
- Made-up test variants:
  - the key with 5 entries removed → exactly 5 `MISSING`, the other 37 kept
  - a key entry `43. b` → orphaned-entry warning
  - `12. f` → `INVALID`
  - two entries for question 7 → `AMBIGUOUS`
  - no key at all → 42 `MISSING`, and the import still succeeds.
- With AI turned off, all AI buttons are hidden and the full import → confirm → publish flow works.
- With AI turned on, only the selected unresolved questions are sent. A repeat request is answered from the cache with no HTTP call (tested with a mocked provider). Invalid AI JSON is rejected without changing any data.

**Tests:** unit tests for line building, splitting, the option grid, key parsing and the status rules; an integration test of the whole import, run on the actual PDF.

### M4 — Exam & grading
- `attempts` and `attempt_answers` tables.
- Server actions: start or resume, save an answer, submit, close expired attempts.
- Exam screen:
  - question panel (all questions on one page, plus a numbered grid that jumps to a question)
  - answered / not answered indicators
  - sticky countdown timer
  - save status
  - submit confirmation dialog listing unanswered questions
  - automatic submit when time runs out
- `lib/grading`: exact matching of the selected options, score = correct / total × 10, deadline and grace-period rules.

**Acceptance criteria**
- The four SRD grading examples give the expected results. Unanswered questions score 0. A 7-of-42 attempt is stored as `1.6667` and shown as `1.67`.
- Refreshing the page in the middle of an exam resumes it with every saved answer and the correct remaining time.
- Submitting twice at the same time leaves exactly one submission and one score.
- If the browser closes before the deadline, the attempt shows as submitted (`timeout`) with the saved answers the next time it is opened or listed.
- Saves after deadline + 10 s are rejected. Nothing can change an attempt after it is submitted.
- Before submitting, the server's responses contain no `is_correct` values and no explanations.
- The timer and the selection controls work on a 360 px wide screen, and radio buttons and checkboxes can be used with the keyboard.

**Tests:** unit tests for grading and deadlines; integration tests for submitting, idempotency, rejection after the deadline and automatic closing.

### M5 — Results, history, deployment
- Results screen: score out of 10, correct / incorrect / unanswered counts, time spent, each question with the student's choice and the correct answer, explanations.
- History: list of attempts per quiz, "Làm lại" (retake), filter to incorrect answers only.
- Admin dashboard: user count, quizzes by status, recent attempts.
- Production setup: Supabase project with migrations, Vercel project, GitHub Actions keep-alive and backup job, README, `.env.example`, deployment guide.
- Playwright end-to-end test of the 10-step SRD flow, run against the local Supabase.

**Acceptance criteria**
- Editing or republishing a quiz after an attempt leaves that attempt's stored results and review page exactly the same.
- The end-to-end test passes: admin uploads `PLDC1.pdf` → reviews → (AI mocked) → confirms → publishes → student takes the exam → one run submitted by hand and one timed out → both graded → student reviews.
- The production deployment works end-to-end with AI turned off. The backup job produces a dump that can be restored, checked once by hand.

## Out of scope / later
Per-group quiz access, question or option shuffling, email invitations (Resend), OCR, other PDF layouts, a reusable cross-quiz question bank, untimed practice mode.
