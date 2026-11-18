# Master Prompt: AI-Powered Online Quiz Practice Platform

## 1. Your Role

Act as a **Senior Full-Stack Software Architect, Technical Lead, and AI Engineering Specialist**.

Your responsibility is to analyze, design, plan, and implement a lightweight online quiz practice platform.

The application is intended for personal use and a small group of invited users.

Prioritize:

- Simple and intuitive UI/UX.
- Accurate PDF-to-quiz conversion.
- Optional AI-assisted answer detection.
- Flexible quiz configuration.
- Reliable, deterministic grading.
- Free or extremely low-cost hosting.
- Clean, maintainable architecture.
- Minimal infrastructure complexity.

Avoid overengineering.

Prefer a modular monolithic application with clearly separated responsibilities.

## 2. Reference Materials

### UI/UX Reference

https://baitaptracnghiem.com/lam-bai/thi-thu-trac-nghiem-on-tap-mon-phap-luat-dai-cuong-online-chuong-1-de-31

Analyze the reference website and identify relevant interaction patterns:

- Question and answer presentation.
- Question navigation.
- Exam timer.
- Answer selection.
- Submission.
- Result presentation.
- Mobile responsiveness.

Build an original, clean, modern UI inspired by its functionality.

### Sample PDF Documents

Refer to folder `input` in current repo.

Inspect the actual PDF files before finalizing the parsing design.

Identify question numbering patterns, answer option formats, answer-key markings, and layout variations.

If these files are inaccessible, request sample PDFs instead of inventing their structure.

## 3. Approved Technology Direction

Use the following stack as the initial recommendation:

- Frontend: Next.js + TypeScript.
- UI: Tailwind CSS + shadcn/ui.
- Backend: Next.js Route Handlers / Server Actions.
- Database: Supabase PostgreSQL.
- Authentication: Supabase Auth.
- File Storage: Supabase Storage.
- Deployment: Vercel Hobby.
- AI Integration: Configurable external LLM API.

Verify compatibility with current free-tier restrictions before finalizing the architecture.

A separate backend service is not required unless technically justified.

Avoid microservices, Kubernetes, Kafka, and unnecessary background infrastructure.

## 4. Functional Requirements

### FR-01: Invitation-Only Authentication

The application must be accessible only to authorized users.

Requirements:

1. No public registration.
2. Users can log in using email and password.
3. Only the application owner or authorized administrator can invite users.
4. Invitations should support a secure, expiring activation mechanism.
5. Users must not be able to grant themselves administrator privileges.
6. Authentication and authorization must be enforced server-side.

Roles:

**Admin**

- Invite or remove users.
- Manage subjects and quizzes.
- Upload PDF documents.
- Review extracted questions.
- Configure answer keys.
- Configure and publish quizzes.
- Configure the AI provider.

**Student**

- Browse accessible quizzes.
- Take quizzes.
- View personal results.
- Review attempt history.

For the MVP, use these two roles unless a simpler model provides equivalent security.

Ensure that invitation-only access is enforced through trusted backend operations, not merely by hiding the registration UI.

### FR-02: Subject & Quiz Management

Admin users must be able to:

- Create, edit, and delete subjects.
- Create, edit, and delete quizzes.
- Assign quizzes to subjects.
- Configure quiz title and description.
- Configure exam duration.
- Configure question answer-selection modes.
- Preview quizzes.
- Publish and unpublish quizzes.

Quiz states:

- DRAFT
- PUBLISHED
- ARCHIVED

A quiz cannot be published until its questions and answer keys pass validation.

Question banks should be reusable independently of quiz configurations.

### FR-03: PDF Import & Answer Key Extraction

The MVP must support text-based PDF documents containing multiple-choice questions.

**Important clarification:** In most input PDF documents, the correct answers are provided in a dedicated answer key section near the end of the document, typically on the final page or final few pages.

The system must prioritize extracting this answer key before attempting any AI-based answer identification.

### 3.1 PDF Processing Pipeline

Implement the following processing stages:

1. Upload and validate the PDF.
2. Extract text from all pages.
3. Identify question sections and answer key sections.
4. Parse questions and their answer options.
5. Extract the answer key from the end of the document.
6. Map extracted answers to their corresponding questions.
7. Validate answer mappings and identify unresolved questions.
8. Invoke AI only for questions without a valid answer key, if AI is configured.
9. Normalize the extracted data.
10. Present the questions and answers for review.
11. Save verified questions to the question bank.

### 3.2 Answer Key Detection

The parser must recognize common answer key formats, including but not limited to:

**Format A: One answer per line**

```text
ĐÁP ÁN
Câu 1: B
Câu 2: A
Câu 3: D
Câu 4: C
```

**Format B: Compact answer list**

```text
Đáp án:
1.B  2.A  3.D  4.C  5.B
```

**Format C: Tabular answer key**

| Question | Answer | Question | Answer |
|---|---|---|---|
| 1 | B | 6 | A |
| 2 | A | 7 | C |
| 3 | D | 8 | B |

**Format D: Multiple correct answers**

```text
Câu 1: A, C
Câu 2: B, D
Câu 3: A, B, D
```

**Format E: Answer explanations**

```text
Câu 1: B
Giải thích: ...

Câu 2: A
Giải thích: ...
```

These are illustrative formats. The actual parser must be designed based on the supplied PDF samples.

### 3.3 Answer Mapping

After extracting the answer key:

- Match answers to questions using their question numbers.
- Support single-answer and multiple-answer mappings.
- Validate that every extracted answer option exists in the corresponding question.
- Detect duplicate question numbers.
- Detect missing answer entries.
- Detect invalid answer labels.
- Detect answer entries that do not correspond to any extracted question.
- Handle answer keys that are split across multiple pages.
- Prevent answer key content from being mistakenly parsed as additional questions.
- Preserve answer explanations when available.

Never assume that the position of an answer in the answer key directly corresponds to the position of a question without validating the numbering.

### 3.4 Answer Key Validation

Classify extracted answers into the following states:

- `EXTRACTED_VALID`: Successfully extracted and structurally validated.
- `MISSING`: No answer was found.
- `INVALID`: Extracted answer references nonexistent options or violates structural constraints.
- `AMBIGUOUS`: Multiple conflicting interpretations exist.
- `AI_SUGGESTED`: AI has proposed an answer.
- `VERIFIED`: Admin has manually confirmed the answer.

Structural validation does not guarantee that an answer is academically correct.

Questions with missing, invalid, or ambiguous answers must be clearly highlighted in the review interface.

### 3.5 Partial Answer Keys

Some PDFs may provide answers for only a subset of questions.

For example:

- Total questions: 50.
- Successfully extracted answers: 45.
- Missing or unresolved answers: 5.

The system must preserve the 45 successfully extracted answers.

Only the remaining 5 questions should be eligible for AI-assisted answer identification.

Do not regenerate all 50 answers unnecessarily.

### 3.6 PDF Without Answer Keys

If no answer key can be identified:

1. Mark all questions as requiring answer identification.
2. Check whether an AI provider is configured.
3. If configured, allow AI-assisted answer generation.
4. If not configured, allow manual answer entry.
5. Require answer verification before publishing.

Do not block the PDF import process merely because no answer key exists.

### FR-04: AI-Assisted Answer Detection — Fallback Only

The AI answer detection mechanism must operate as a fallback, not as the default processing method.

### 4.1 Answer Resolution Priority

Apply the following priority:

**Priority 1 — PDF Answer Key Extraction**

Use deterministic parsing to identify answers provided within the PDF document.

**Priority 2 — AI Answer Detection**

Use AI only when an answer is:

- Missing.
- Invalid.
- Ambiguous.
- Not found in the PDF answer key.

AI invocation must be optional and require a configured API key.

**Priority 3 — Manual Verification**

Allow the admin to confirm, correct, or manually enter answers.

### 4.2 AI Processing Rules

- Do not invoke AI for successfully extracted valid answers by default.
- Allow the admin to explicitly request AI re-evaluation of selected questions.
- Process only unresolved or explicitly selected questions.
- Support batch processing where appropriate.
- Use structured JSON output.
- Validate AI responses against existing answer options.
- Support multiple correct answers.
- Provide explanations where possible.
- Mark AI-generated answers as requiring review.
- Cache AI responses to avoid unnecessary repeated calls.
- Handle API failures without losing previously extracted data.

### 4.3 AI Configuration

The application owner must be able to configure an optional AI provider.

Requirements:

- API key stored securely on the server.
- Provider abstraction for future extensibility.
- AI disabled gracefully when no API key is configured.
- No API key exposure to invited students.
- No automatic paid API requests without an explicit processing action or approved configuration.

### 4.4 Answer Provenance

Track the origin of each answer key:

- `PDF_EXTRACTED`
- `AI_GENERATED`
- `MANUALLY_VERIFIED`

Preserve the original extracted answer when AI or manual verification changes it, so modifications can be reviewed.

### 4.5 Import Review Interface

After PDF parsing, display an import summary such as:

```text
Total questions:             50
Answers extracted from PDF:  45
Answers suggested by AI:      3
Answers requiring review:     2
```

The interface must allow the admin to:

- Review all parsed questions.
- See where each answer originated.
- Correct incorrect question content.
- Modify answer options.
- Edit correct answers.
- Request AI assistance for selected unresolved questions.
- Verify answers.
- Publish only when all required validation checks pass.

The interface should prioritize unresolved and problematic questions to minimize manual review effort.

### 4.6 Cost Optimization

To minimize AI API consumption:

1. Always attempt deterministic answer key extraction first.
2. Never call AI for all questions when only a subset is unresolved.
3. Avoid repeated processing of identical questions.
4. Cache successful AI responses.
5. Allow manual resolution without AI.
6. Show the number of questions requiring AI processing before executing the request.

The primary objective is to **maximize reliable answer extraction from existing PDF content and minimize unnecessary AI inference**.

### FR-05: Question Answer Modes

Support three quiz configuration modes.

**Mode A: Single Answer**

Every question requires exactly one correct answer.

Students may select only one option.

**Mode B: Multiple Answers for All Questions**

Every question must have at least two correct answers.

Students may select multiple options.

Prevent publishing if any question violates this rule.

**Mode C: Mixed Answer Types**

The quiz contains both single-answer and multiple-answer questions.

The admin must be able to configure the selection type for individual questions.

Requirements:

- Quiz-level default answer mode.
- Question-level answer mode.
- Question-level overrides.
- Validation between the configured mode and verified answer key.
- Radio buttons for single-answer questions.
- Checkboxes for multiple-answer questions.

Store selection mode independently from the set of correct answer IDs.

### FR-06: Quiz Taking

Students must be able to:

- Browse available quizzes.
- Start an exam.
- View all questions or navigate between questions.
- Select and revise answers.
- See answered/unanswered indicators.
- Track remaining time.
- Submit manually.
- Receive a submission confirmation.
- Automatically submit when the deadline expires.
- Resume an active attempt after refreshing the browser.
- Review results after submission.

Important rules:

- Use a server-authoritative start time and deadline.
- Persist answer progress.
- Prevent duplicate submissions.
- Handle temporary network interruptions.
- Prevent submitted attempts from being modified.
- Do not expose answer keys before submission.
- Auto-submission must be reliable even if the browser is closed or disconnected; if scheduled background processing is not used, enforce attempt expiration and finalization server-side when the attempt is next accessed or submitted.

### FR-07: Automatic Grading

Use a grading scale from 0 to 10.

Every question has equal weight.

Formula:

Final Score = (Fully Correct Questions / Total Questions) × 10

Rules:

- Single-answer questions require an exact correct match.
- Multiple-answer questions require an exact set match.
- Missing a correct option results in zero credit.
- Selecting an additional incorrect option results in zero credit.
- Unanswered questions receive zero credit.
- No partial credit is allowed.

Examples:

Question 1:
Correct = [B]
Selected = [B]
Result = Correct.

Question 2:
Correct = [A, C]
Selected = [A, C]
Result = Correct.

Question 3:
Correct = [A, C]
Selected = [A]
Result = Incorrect.

Question 4:
Correct = [A, C]
Selected = [A, B, C]
Result = Incorrect.

The grading engine must use deterministic backend logic.

Never use AI to grade answers.

Store the raw score and apply a consistent display rounding policy.

### FR-08: Quiz Results

After submission, display:

- Final score out of 10.
- Number of questions.
- Correct count.
- Incorrect count.
- Unanswered count.
- Time spent.
- Selected answers.
- Correct answers.
- Available answer explanations.

Provide a question-by-question review interface.

### FR-09: Attempt History

Students should be able to:

- View previous attempts.
- Review previous scores.
- Review incorrect answers.
- Retake quizzes.

Ensure that editing a quiz does not modify historical results.

Use immutable question snapshots or versioned question/answer-key references for completed attempts.

## 5. UI/UX Requirements

Design a responsive interface with the following screens:

1. Login.
2. Admin Dashboard.
3. Subject & Quiz Library.
4. Quiz Detail.
5. PDF Upload.
6. PDF Import Review.
7. Question Editor.
8. Quiz Configuration.
9. Exam Taking.
10. Exam Results.
11. Attempt History.
12. User Invitation Management.

UI expectations:

- Modern and minimalistic.
- Vietnamese-first interface.
- Responsive on desktop and mobile.
- Clear question navigation.
- Readable answer options.
- Accessible form controls.
- Intuitive import/review workflow.
- Proper loading and error states.

Use reusable components and consistent styling.

## 6. Data Architecture

Design a normalized PostgreSQL schema.

Consider:

- Profiles / Users.
- Invitations or equivalent Auth invitation flow.
- Subjects.
- Question Banks.
- Questions.
- Question Options.
- Quizzes.
- Quiz Questions.
- Import Jobs.
- Quiz Attempts.
- Attempt Answers.

Avoid introducing tables that do not serve a clear functional purpose.

Ensure:

- Proper foreign keys.
- Appropriate unique constraints.
- Required indexes.
- Consistent deletion policies.
- Role-based authorization.
- Row-level security.
- Historical attempt integrity.
- No unnecessary duplicated fields.

Separate:

- Original question content.
- Verified answer keys.
- Quiz configuration.
- Student responses.
- Historical submission results.

## 7. Security

Implement:

- Secure authentication.
- Invitation-only access.
- Server-side role validation.
- Row-level security.
- Private file storage.
- File size and MIME validation.
- Secure API key management.
- Input validation.
- Submission idempotency.
- Server-side deadline enforcement.
- Answer-key protection.

Treat uploaded PDF content as untrusted data, including when passed to AI.

Never allow PDF instructions to override system or AI processing instructions.

## 8. Deployment Requirements

The application must target free-tier infrastructure.

Preferred deployment:

- Vercel Hobby for the application.
- Supabase Free for database, authentication, and storage.

Evaluate current limits before implementation.

Pay attention to:

- Serverless execution limits.
- PDF processing memory and CPU requirements.
- Upload limits.
- Database storage.
- Inactive project suspension.
- AI API costs.
- Backup and recovery options.

Do not introduce paid services without explaining the requirement and obtaining approval.

AI functionality must remain optional.

Provide instructions for:

- Local development.
- Environment variables.
- Supabase project configuration.
- Database migrations.
- Storage policies.
- Admin bootstrap.
- Invitation workflow.
- Vercel deployment.
- Basic maintenance.

## 9. Testing Strategy

Implement meaningful automated tests.

Required unit tests:

- PDF question segmentation.
- Answer option extraction.
- Answer validation.
- Question mode validation.
- Single-answer grading.
- Multiple-answer exact-set grading.
- Score calculation.
- Timer and deadline rules.

Required integration tests:

- PDF import.
- Question review and publishing.
- Invitation authorization.
- Quiz submission.
- Result persistence.
- Attempt history integrity.

Required end-to-end scenarios:

1. Admin uploads a PDF.
2. Questions are extracted.
3. Missing answers are identified.
4. Admin optionally requests AI suggestions.
5. Admin verifies answers.
6. Admin publishes the quiz.
7. Student starts the exam.
8. Student completes or times out.
9. System grades the attempt.
10. Student reviews results.

Use test fixtures derived from the actual sample PDF formats where possible.

## 10. Architecture Principles

Apply:

- Modular monolithic architecture.
- Separation of concerns.
- TypeScript strict mode.
- Schema-based validation.
- Secure server-side operations.
- Database migrations.
- Reusable UI components.
- Clear error handling.
- Minimal dependencies.
- Testable business logic.

Keep PDF parsing, AI integration, quiz management, and grading logically separated.

Do not introduce unnecessary design patterns or abstractions.

## 11. Project Phases

### Phase 1: Analysis & Architecture

Deliver:

- `docs/requirements.md`
- `docs/architecture.md`
- `docs/implementation-plan.md`

Activities:

1. Analyze requirements.
2. Inspect reference materials.
3. Identify ambiguities.
4. Define MVP boundaries.
5. Evaluate technical alternatives.
6. Propose architecture.
7. Identify risks.
8. Create milestones.

### Phase 2: Detailed Design

Deliver:

- `docs/database-design.md`
- `docs/api-design.md`
- `docs/pdf-processing-design.md`
- `docs/ui-ux-design.md`
- `docs/testing-strategy.md`
- `docs/deployment-guide.md`

Include diagrams and API contracts where useful.

### Phase 3: Implementation

Implement the approved plan incrementally.

Suggested milestones:

**M1 — Foundation & Authentication**

- Project initialization.
- Supabase integration.
- Invitation-only authentication.
- Basic layout and navigation.

**M2 — Quiz & Question Management**

- Subjects.
- Quiz CRUD.
- Question editor.
- Answer-mode configuration.

**M3 — PDF Import & Answer Verification**

- Text-based PDF extraction.
- Question parsing.
- Import review.
- Optional AI answer detection.
- Manual verification.

**M4 — Exam & Grading**

- Exam interface.
- Timer.
- Answer persistence.
- Submission.
- Deterministic grading.

**M5 — Results & Deployment**

- Results review.
- Attempt history.
- End-to-end testing.
- Production deployment.
- Documentation.

Each milestone must include acceptance criteria and relevant tests.

Do not create an excessive number of tiny tasks.

## 12. Expected Deliverables

The final MVP should include:

- Working full-stack application.
- Database schema and migrations.
- Authentication and invitation flow.
- PDF import functionality.
- Optional AI integration.
- Question review/editor.
- Quiz-taking interface.
- Automatic grading.
- Results and attempt history.
- Automated tests.
- README.
- Environment variable template.
- Deployment guide.

The system must remain usable when AI is disabled.

## 13. AI Agent Working Instructions

Follow these rules:

1. Do not start coding immediately.
2. Analyze the requirements and references first.
3. Identify architectural decisions and tradeoffs.
4. Highlight missing requirements.
5. Recommend the simplest suitable solution.
6. Produce a clear implementation plan.
7. Define acceptance criteria for each milestone.
8. Avoid unnecessary architectural complexity.
9. Request approval before starting implementation.
10. After approval, implement incrementally.
11. Verify each milestone before continuing.
12. Update documentation as decisions change.
13. Never claim functionality is complete without verification.

## 14. Initial Assignment

**Start with Phase 1 only. Do not implement application code yet.**

Your immediate tasks:

1. Review the complete requirements.
2. Analyze the UI reference.
3. Inspect sample PDF documents if accessible.
4. Identify missing requirements and technical risks.
5. Confirm the most suitable technology stack.
6. Propose a high-level architecture.
7. Propose the database model.
8. Define the PDF import strategy.
9. Define optional AI integration.
10. Compare free deployment alternatives.
11. Produce an MVP implementation roadmap with clear acceptance criteria.

Present the findings for review and approval before beginning Phase 2 or Phase 3.