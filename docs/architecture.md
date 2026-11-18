# Architecture — Online Quiz Practice Platform (MVP)

Status: **Approved 2026-11-18**. See `requirements.md` for decisions D1–D6 and assumptions A1–A8.

## 1. Overview

A single **Next.js (App Router) app on Vercel**. Supabase provides the database, login, and file storage. Nothing else runs in the background. An LLM API is called only when the admin explicitly asks for AI suggestions.

```
 Browser (student / admin)
   │  HTTPS
   ▼
 Next.js on Vercel ───────────────────────────────────────────────
   app/(student)  app/(admin)   Server Actions / Route Handlers
        │                │                │
        │        ┌───────┴─────────┬──────┴─────────┬──────────────┐
        │        │ lib/pdf-import  │ lib/grading    │ lib/ai       │  pure TS modules,
        │        │ (no I/O)        │ (no I/O)       │ (provider)   │  unit-tested
        │        └─────────────────┴────────────────┴──────┬───────┘
        ▼                                                   │ fetch (optional)
 Supabase: Auth (JWT) · Postgres (RLS) · Storage (private)  ▼
                                                     External LLM API
```

### Module boundaries

| Module | Responsibility | Talks to the database or network? |
|---|---|---|
| `lib/pdf-import/` | Read text and positions from the PDF, split it into questions and the answer key, build each question's option grid, map answers, validate | No. Takes the PDF file's bytes, returns a parsed result |
| `lib/grading/` | Grade answers by exact match, compute the score, apply deadline rules | No |
| `lib/ai/` | Common interface over AI providers, build the prompt, check the response, compute the cache key | Calls the AI provider over HTTP |
| `lib/quiz/` | Publish checks (answers match the answer mode), build the frozen published copy (snapshot) | No |
| `server/` | Server actions and route handlers: confirm who the user is and their role, then call the modules above and the database | Yes |
| `components/` | shadcn/ui-based UI pieces | No |

The business logic is in pure functions. The server layer only checks permissions and handles reading and writing data.

## 2. Technology decisions

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router, TypeScript strict. **Cache Components turned off** (decided 2026-11-18): every page is per-user and checks login on the server, so static pre-rendering gains nothing, and turning it on would add Suspense and caching rules to every page. | Approved stack. Server actions are enough for an app this small, so there is no separate API service. |
| UI | Tailwind + shadcn/ui, Vietnamese strings in one dictionary file | Approved. Full translation tooling is unnecessary for a Vietnamese-only app. |
| Supabase connection | `@supabase/ssr`, using the user's own login cookie | Database security rules (RLS) apply automatically. |
| Privileged operations | Admin-level Supabase client (`service_role` key), server-only and kept in a separate `server/admin-client.ts` | Used only for: accepting invitations, deactivating users, exam operations after an explicit check. |
| PDF text extraction | `unpdf` (pdf.js bundled for serverless) running on the server | Gives each text piece with its x/y position. Needs no native binaries, so it works on Vercel. |
| Validation | zod | Checks form input, AI responses, and parser output. |
| Tests | Vitest for unit and integration tests, Playwright for end-to-end, Supabase CLI to run a local database for integration tests | Small, standard tooling. |

## 3. Data model (summary; full DDL in Phase 2)

```
auth.users 1─1 profiles(role, is_active)
invitations(email, token_hash, expires_at, accepted_at, revoked_at)
subjects 1─* quizzes(status, duration_minutes, default_mode, current_version)
quizzes 1─* questions(position, content, selection_type, explanation,
                      answer_status, answer_source, original_answer)
questions 1─* question_options(label A..F, content, is_correct)
quizzes 1─* quiz_versions(version_no, snapshot jsonb)     <- immutable, created on publish
quiz_versions 1─* attempts(user, status, started_at, deadline_at, submitted_at,
                           correct/incorrect/unanswered counts, score)
attempts 1─* attempt_answers(question_id, selected_labels[], is_correct)
import_jobs(storage_path, sha256, status, summary, parse_log)  -> creates 1 quiz
ai_suggestions(content_hash, model, labels[], explanation)     <- cache
```

Key rules:
- **Answer key protection.** Students have no read access to `questions` or `question_options`. On `quiz_versions` they can read only the metadata columns (version number, question count, dates) of published quizzes: the `snapshot` column, which holds the key, is never granted to them. During an attempt they get the questions only from the server, which removes `correct` and explanations until the attempt is submitted. This holds even if a student calls Supabase directly with the public key.
- **History integrity.** Publishing writes a `quiz_versions.snapshot`: the questions, options, answer key and explanations as they are at that moment. Attempts point to a `quiz_version_id` and are graded only against it. Editing the quiz afterwards never touches past attempts.
- **One active attempt** per (user, quiz): a partial unique index on `attempts(user_id, quiz_id) WHERE status = 'in_progress'`.
- **Deleting:**
  - A quiz can only be deleted while it is `DRAFT` and has no attempts. Otherwise it can only be archived.
  - A subject can only be deleted if it has no quizzes (enforced with `on delete restrict`).
  - Questions and options are deleted together with their quiz.
- **`content_hash`** is a hash of the normalized question and option text. It is used for the AI cache and to avoid sending the same question twice.

## 4. PDF import pipeline

```
[Admin browser]
  1. Ask the server for a signed upload URL (admin only)
  2. Upload the PDF straight to Storage, into the private "imports" bucket (avoids Vercel's ~4.5 MB request limit)
[Server action: processImport(jobId)]
  3. Download the file, check size ≤ 10 MB and the %PDF header, compute sha256 (warn if the same file was imported before)
  4. Read text pieces with x/y positions (unpdf), normalize to Unicode NFC
  5. Group pieces into lines by y position, and order each line left to right by x position
  6. Find where the answer key starts: a line matching /^\s*đáp\s*án\s*:?\s*$/i
     followed by a run of entries (\d+)\s*[.:)]\s*([a-f](\s*,\s*[a-f])*)
     → everything from there on is the answer key, never parsed as questions
  7. Split the rest into questions at the left margin: /^(\d+)\.\s+/
  8. For each question, build the option grid:
     - an option starts at an inner-label marker /^[A-F]\.\s/ (used only to find where an option starts; the letter itself is ignored, per D4)
     - its column (left or right) comes from its x position, its row from its y position
     - its outer letter is the lone A–F character just left of the option within its vertical span,
       or, if that is missing, its grid position (A top-left, B top-right, …)
     - the inner label is removed from the stored option text
  9. Map key entries to questions by question number (never by position in the list)
 10. Validate → set answer_status for each question; log every warning
 11. Write the draft quiz, questions, options and import_job summary in a single database transaction
```

**Validation results:**

| Check | Result |
|---|---|
| A question number appears twice, in the questions or in the key | `AMBIGUOUS` |
| The key has no entry for a question | `MISSING` |
| The key gives a letter the question doesn't have | `INVALID` |
| The outer letters in a question don't form a clean grid (missing or repeated letter, or disagree with grid position) | `AMBIGUOUS` + a parse warning |
| A key entry has no matching question | A job-level warning listing the orphaned numbers |
| Option text contains "Cả … [A-F]" or "Đáp án [A-F]" | A review warning (see requirements §2) |
| Leftover stray characters, or a question with fewer than 2 options | A review warning |

**Performance.** The sample PDF is 165 KB with 9 pages, and parsing it takes well under a second, far below Vercel Hobby's function time limit. Nothing needs to run in the background.

## 5. AI fallback

```ts
interface AnswerSuggester {
  suggest(items: { ref: string; stem: string; options: { label: string; text: string }[];
                   selectionType: 'single'|'multiple' }[]): Promise<Suggestion[]>;
}
```

- **Providers:** the default adapter is "OpenAI-compatible chat completions". It works with OpenAI, Gemini's OpenAI-compatible endpoint, OpenRouter and Groq through `AI_BASE_URL`. A second adapter covers Anthropic. Which one is used is set by `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` and `AI_BASE_URL`. If `AI_API_KEY` is missing, AI features are hidden.
- **Flow:**
  1. The admin selects questions. The selection defaults to questions with status `MISSING`, `INVALID` or `AMBIGUOUS`.
  2. A dialog shows "N câu, ~M yêu cầu" (N questions, about M requests) and asks for confirmation.
  3. Questions already in the cache are answered from it and not sent.
  4. The rest go in batches of 20.
- **Protection against instructions hidden in the PDF:**
  - The system prompt says the content is untrusted data and must never be followed as instructions.
  - Questions are sent as a JSON data block, not mixed into the instructions.
  - The response must be a JSON object that matches a fixed schema (zod).
  - Suggested labels must exist among the question's options, and their count must fit the selection type.
  - Responses that fail any of these checks are thrown away.
- **Result:**
  - Each accepted answer gets `answer_status = AI_SUGGESTED` and `answer_source = AI_GENERATED`. Publishing stays blocked until the admin confirms it (`VERIFIED`).
  - If the AI call fails, only that batch is reported as failed. No existing data changes.

## 6. Authentication and invitations (recommendation)

**Recommendation: invite links created by the app, shared by the admin through any channel.** This costs nothing and needs no email setup. Supabase's built-in email sender is heavily rate-limited, so it isn't usable for invitations.

1. The admin enters an email address. The server, after checking the admin role, generates 32 random bytes and stores only their **sha256** with `expires_at = now() + 72h`. It shows the link `/{origin}/invite/{token}` once, with a Copy button.
2. The invitee opens the link and sets their name and password. The server then:
   - hashes the token and finds an invitation that is not expired, not revoked and not yet accepted
   - creates the user with `auth.admin.createUser({ email, password, email_confirm: true })`
   - inserts `profiles(role = 'student')`
   - marks the invitation accepted.

   All of this happens in one server action. Users cannot sign up by themselves (`Disable signups` is on in Supabase).
3. **Roles live only in `profiles.role`.** RLS stops users from updating their own `role` or `is_active`. Only the admin client (`service_role`) can change them. The first admin is created by `scripts/bootstrap-admin.ts`, which runs locally with the admin key.
4. **Deactivating a user:**
   - sets `is_active = false`
   - bans the user in Supabase Auth (`ban_duration`), which also ends their sessions
   - is checked on the server on every request (`getActiveProfile` in `src/server/auth.ts`). `src/proxy.ts` (formerly called middleware) only refreshes the login cookie and sends logged-out visitors to `/login`.
5. **Later, optional:** send the same link by email via Resend, which has a free tier. No other change is needed.

## 7. Exam timing and submission

- **Starting an attempt** (server): if an attempt is already in progress, return it. Otherwise create one with `started_at = now()` and `deadline_at = now() + duration`, using the database clock.
- **The client timer** counts down to `deadline_at`. It is corrected by the difference between server and browser time, measured when the exam loads. It is for display only.
- **Autosave:** each answer change is sent after a short delay (debounced). Unsent changes wait in a queue (also copied to `localStorage`) and are resent when the connection returns. The status shows "Đã lưu" (saved), "Đang lưu…" (saving) or "Mất kết nối – sẽ thử lại" (connection lost, will retry). The server rejects saves after the deadline plus 10 seconds (A6), and saves to attempts that are no longer in progress.
- **Submitting** (on click, or automatically when the timer hits 0):
  1. `UPDATE attempts SET status='submitted' … WHERE id=$1 AND status='in_progress' RETURNING`. Only the first submission wins; repeat submissions just return the existing result.
  2. Grade against the snapshot and store the counts and score in the same transaction.
- **Closing attempts when the browser is gone:** whenever an attempt or an attempt list is read (by a student or an admin), the server first closes any in-progress attempts past their deadline (`submit_reason = 'timeout'`). No scheduled job is needed. `pg_cron` stays an optional extra.

## 8. Deployment options (free)

| Option | PDF parsing | Free-tier problems | Verdict |
|---|---|---|---|
| **Vercel Hobby + Supabase Free** | Fine (Node function, up to 300 s) | Non-commercial use only. ~4.5 MB request size limit (avoided by uploading straight to Storage). Supabase pauses after ~7 days with no activity, gives 500 MB database / 1 GB storage, and has no reliable automatic backups | **Recommended** |
| Netlify Free + Supabase | Fine | Fewer monthly function invocations, and Next.js support goes through an adapter | Fallback |
| Cloudflare Workers (OpenNext) + Supabase | Risky: the free plan allows ~10 ms of CPU per request, too little to parse a PDF | Workers runtime differs from Node | Not recommended |
| Render / Fly free + Supabase | Fine | Servers go to sleep and are slow to start; free plans change often | Not recommended |

**Keeping Supabase Free running safely:** a GitHub Actions job (free) that:
- sends a weekly keep-alive request so the project isn't paused
- runs a weekly `pg_dump` and stores it as a private file on GitHub.

Uploaded PDFs are only needed until the import is reviewed. They can be deleted after the quiz is published, which keeps storage use small.

*Limits taken from Vercel and Supabase documentation and 2026 summaries. They will be re-checked against the official pricing pages before deployment.*

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Other PDFs place items slightly differently (outer letter shifted, 3 or 5 options, two-line questions) | Wrong mapping between options and answers | Build options from their x/y positions. Cross-check outer letters against grid positions, and mark mismatches `AMBIGUOUS` rather than guessing. Add a test fixture for every new PDF that breaks the parser. |
| Options mentioning letters ("Cả B và C") point to the wrong option after relabelling | Students see misleading choices | Review warning plus manual edit (requirements §2) |
| The answer key itself is wrong in the source PDF | Wrong grading | Cannot be detected (the SRD says the same). The admin's review and AI re-checks are opt-in. |
| Supabase project paused or data lost | App down or data lost | Keep-alive and backup job (§8) |
| Answer key leaks through a direct Supabase query | Students can cheat | Students have no RLS access to the key tables. The integration test "student cannot read key" guards this. |
| Clock drift or network drops near the deadline | Lost answers | Server time is the authority, plus the 10 s grace period, the retry queue and the local backup copy |
| Vercel Hobby forbids commercial use | Terms of service problem if the app is ever monetized | Stay non-commercial, or move to Vercel Pro or Netlify |
