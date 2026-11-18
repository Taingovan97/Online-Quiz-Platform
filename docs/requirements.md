# Requirements — Online Quiz Practice Platform (MVP)

Status: **Approved 2026-11-18**
Source: `online-quiz-requirements.md` (SRD), sample `input/PLDC1.pdf`, owner clarifications (2026-11-18).

## 1. Confirmed decisions

| # | Decision | Source |
|---|---|---|
| D1 | **One PDF = one quiz.** Importing a PDF creates one draft quiz with all its questions. | Owner |
| D2 | **Students see correct answers and explanations right after submitting.** | Owner |
| D3 | **Invitations use app-generated, single-use, expiring links that the admin copies and shares** (Zalo, Messenger, email…). No email service is needed. Sending invites by email (e.g. Resend) can be added later. | Owner asked for a recommendation; see architecture §6 |
| D4 | **All input PDFs follow the layout of `PLDC1.pdf`.** Options sit in a grid, and the **outer letter (the option's position in the grid) is the option's identifier**. The answer key refers to outer letters. The inner letter printed in the option text ("C. …") is ignored and removed from the text. | Owner |
| D5 | Stack: Next.js + TypeScript, Tailwind + shadcn/ui, Supabase (Postgres, Auth, Storage), Vercel Hobby, optional external LLM. No separate backend. | SRD §3 |
| D6 | The AI API key is a server environment variable. The admin UI only shows whether AI is configured; it does not store keys. | Recommendation (simpler and safer than storing an encrypted key in the database) |

## 2. Sample PDF format (the one format the parser supports)

Observed in `input/PLDC1.pdf` (42 questions, text-based, Unicode Vietnamese):

```
Pháp luật đại cương 01                      TÊN :      <- header, ignore
42 Câu hỏi                                  LỚP :
1. Pháp luật đại cương nằm trong tiểu hệ thống          <- "N." question stem
A  C. Khoa học pháp lý quốc tế        B  A. Khoa học pháp lý cơ bản
C  B. Khoa học pháp lý chuyên ngành,  D  D. Khoa học pháp lý ứng dụng…
   liên ngành                                           <- wrapped option text
...
Đáp án                                                  <- answer key heading
1. b   2. d   3. d   4. d                               <- lowercase, 4-column grid
```

- Grid positions: **A = top-left, B = top-right, C = bottom-left, D = bottom-right.**
- The answer key's letters are outer letters. Checked by hand against Q1, 2, 4, 16, 24, 25, 30 and 31.
- Layout quirks the parser must handle:
  - Option text wraps over several lines.
  - The outer letter sometimes sits on an option's second line (Q8, Q11, Q38, Q41).
  - Some questions start with no blank line before them (Q7, Q13, Q25).
  - The `Đáp án` heading follows the last question directly, with no page break.
  - Accents are sometimes stored as separate combining marks (e.g. `thuế́`), so text must be normalized to NFC.
  - Stray characters appear (a `?` in Q6).
- **Consequence of D4:** a few options mention other options by their *inner* letter (Q7 "Cả B và C", Q19 "Cả A, B và C đều sai", Q35, Q39 "Đáp án B và C là đúng"). Once the app labels options by outer letter, these texts can point at the wrong options. The import review **flags options whose text mentions an option letter**, so the admin can fix the wording. The app does not rewrite them.

## 3. MVP scope

### In scope
- **FR-01 Auth:** Invitation-only access with email + password login, roles `admin` and `student`. Invitations are single-use and expire (default 72 h). The admin can revoke invitations and deactivate users. Accounts are created only by trusted server code. The first admin is created by a bootstrap script.
- **FR-02 Subjects & quizzes:** Create, edit and delete subjects and quizzes. Quiz states are `DRAFT → PUBLISHED ↔ ARCHIVED`. The admin sets duration, default answer mode, title and description, and can preview a quiz. A quiz can only be published when validation passes.
- **FR-03 PDF import:**
  - Upload one PDF (≤ 10 MB, checked as `application/pdf` and by its `%PDF` file header).
  - The parser extracts questions, options and the answer key, maps them by question number, and validates the result.
  - Each answer gets a status (`EXTRACTED_VALID`, `MISSING`, `INVALID`, `AMBIGUOUS`, `AI_SUGGESTED`, `VERIFIED`).
  - The admin reviews and edits the questions.
  - A PDF with no answer key is still imported.
- **FR-04 AI fallback (optional):**
  - Runs only for unresolved questions or questions the admin selects, and only after the admin confirms a count ("Gửi N câu cho AI?").
  - Batched requests with structured JSON output that is checked against the question's options.
  - Responses are cached by a hash of the question content.
  - Every AI answer is marked as needing review.
  - The source of each answer is recorded (`PDF_EXTRACTED`, `AI_GENERATED`, `MANUALLY_VERIFIED`), and the original extracted answer is kept.
- **FR-05 Answer modes:** Single, Multiple (every question has ≥ 2 correct options) or Mixed (each question chooses). The selection type is stored separately from the correct options. Single-answer questions use radio buttons; multiple-answer questions use checkboxes.
- **FR-06 Exam:**
  - The server sets the start time and the deadline.
  - Answers autosave, and an attempt in progress resumes after a page refresh.
  - The student sees which questions are answered, can jump between questions, and confirms before submitting.
  - Submitting is safe to repeat (only the first submission counts).
  - After the deadline, the server closes the attempt itself.
- **FR-07 Grading:** Score = fully correct / total × 10. Every option must match exactly; there is no partial credit. Grading is plain server code, never AI.
- **FR-08 Results**, **FR-09 History:** Each attempt is graded against a frozen copy (snapshot) of the quiz as it was published, so later edits never change past results. Retakes are allowed.

### Out of scope (MVP)
- Scanned or image-only PDFs (OCR), other PDF layouts, Word or Excel import.
- Shuffling question or option order. It would break the outer-letter answer key and the letter-referencing options above.
- Per-quiz or per-group access control. Every student sees every published quiz.
- Sending invitations by email, password-reset emails, social login.
- Picking a subset of questions or pulling random questions from a larger pool (see D1).
- Analytics dashboards beyond simple counts.

## 4. Assumptions (correct me if wrong)

| # | Assumption |
|---|---|
| A1 | Retakes are unlimited. History lists every attempt, and the quiz list shows best and latest score. |
| A2 | Multiple-answer questions show the hint "Chọn một hoặc nhiều đáp án" ("Choose one or more answers"). The number of correct options is **not** revealed. |
| A3 | Every quiz has a time limit (duration > 0, default 45 minutes). There is no untimed practice mode in the MVP. |
| A4 | Score storage and display: the exact score is stored with 4 decimals (`numeric(6,4)`) and displayed rounded half-up to 2 decimals (e.g. `7.14`). |
| A5 | Questions in one PDF have 2–6 options, and correct answers are listed in the end-of-document key. The sample always has 4 options and one correct answer. |
| A6 | Autosaves arriving up to 10 seconds after the deadline are accepted (grace period). Anything later is rejected, and the attempt is closed with the answers already saved. |
| A7 | Editing a published quiz requires unpublishing it, or re-publishing it, which creates a new snapshot. Attempts already in progress keep their original snapshot. |
| A8 | Users removed by the admin are deactivated (their history is kept) and their sessions are ended. They are not hard-deleted. |

## 5. Deviations from the SRD (need approval)

1. **No separate question-bank table.** Because of D1, a quiz owns its questions directly. The SRD's "reusable question banks" would only add a table and a join with no current use. If reuse is needed later, it can be added without breaking anything.
2. **Fewer documents.** The 6 Phase 2 documents are merged into 3: `design.md` (database + API + PDF processing), `ui-ux-design.md` and `testing-and-deployment.md`. This follows the SRD's own "avoid overengineering" principle.
3. **The answer state and its source are two separate fields.** The SRD's lists overlap (`VERIFIED` and `MANUALLY_VERIFIED`). Each question gets `answer_status` (the state) and `answer_source` (where the answer came from), plus `original_answer` (the answer as first extracted, never changed).

## 6. Non-functional requirements
- Vietnamese-first, responsive UI (usable on a 360 px wide phone), with keyboard-accessible form controls.
- Every authorization decision is made on the server. Database row-level security (RLS) is a second line of defense, because the Supabase anon key is public.
- Everything runs on free tiers. AI is optional, and the app is fully usable without it.
- TypeScript strict mode, input validated with zod, database changes in versioned migrations.
