# UI/UX Design

Status: **Approved 2026-11-18**.

## 1. Principles

- **Vietnamese-first.** All interface text lives in `lib/i18n/vi.ts`. URLs stay in English for simplicity.
- **Calm, minimal look:** shadcn/ui defaults, one accent colour, a 16 px base font. Question text is 17–18 px with 1.6 line spacing for easy reading.
- **Mobile-first.** Fits a 360 px wide screen. Tap targets are at least 44 px. Nothing scrolls sideways.
- **Accessible:**
  - Options are real `<input type=radio|checkbox>` elements wrapped in full-width `<label>`s.
  - Each question is a `<fieldset>` whose `<legend>` is the question text.
  - The timer is announced to screen readers only at 5 minutes and 1 minute (`aria-live="polite"`).
  - Status colours always come with an icon or text.
- **Every data view has a loading state** (skeleton) and an **error state** with a "Thử lại" (try again) button. Server errors appear as Vietnamese toast messages, using the `Result` messages from the design's API section.

**Reference site.** Patterns taken from baitaptracnghiem.com: all questions on one page, a numbered question grid, the duration shown next to the quiz, a Start button. The original "show result after each answer" option is **not** used (D2: answers appear after submitting).

## 2. Routes and navigation

| # | Screen | Route | Role |
|---|---|---|---|
| 1 | Login | `/login` | public |
| – | Accept invitation | `/invite/[token]` | public |
| 2 | Admin dashboard | `/admin` | admin |
| 3 | Subject & quiz library | `/quizzes` (student) · `/admin/quizzes` (admin, includes drafts) | both |
| 4 | Quiz detail | `/quizzes/[id]` | both |
| 5 | PDF upload | `/admin/imports/new` | admin |
| 6 | PDF import review | `/admin/quizzes/[id]/review` | admin |
| 7 | Question editor | side panel (sheet) inside screen 6, or `/admin/quizzes/[id]/review?q=…` | admin |
| 8 | Quiz configuration | `/admin/quizzes/[id]/settings` | admin |
| 9 | Exam | `/attempts/[id]` | owner |
| 10 | Results | `/attempts/[id]/result` | owner, admin |
| 11 | Attempt history | `/history` | student (admin can see each user's history) |
| 12 | Users & invitations | `/admin/users` | admin |
| – | Subjects | `/admin/subjects` | admin |

- **Top bar:** logo · "Đề thi" (quizzes) · "Lịch sử" (history) · [admin: "Quản trị" (administration)] · user menu (name, "Đăng xuất" (log out)).
- On mobile the links collapse into a menu (shadcn `Sheet`).
- The exam screen hides the top bar so the student isn't distracted.

## 3. Key screens

### 9. Exam (most important)

Desktop (≥ 1024 px):

```
┌────────────────────────────────────────────────────────────┬────────────────────┐
│ Pháp luật đại cương 01                     ● Đã lưu        │  ⏱  38:12          │
├────────────────────────────────────────────────────────────┤  Đã làm 17 / 42    │
│ Câu 1                                                      │ ┌──┬──┬──┬──┬──┬──┐│
│ Pháp luật đại cương nằm trong tiểu hệ thống                │ │ 1│ 2│ 3│ 4│ 5│ 6││
│  ( ) A  Khoa học pháp lý quốc tế                           │ ├──┼──┼──┼──┼──┼──┤│
│  (•) B  Khoa học pháp lý cơ bản                            │ │ 7│ 8│..│  │  │  ││
│  ( ) C  Khoa học pháp lý chuyên ngành, liên ngành          │ └──┴──┴──┴──┴──┴──┘│
│  ( ) D  Khoa học pháp lý ứng dụng kỹ thuật                 │  ■ đã làm □ chưa   │
│                                                            │  ⚑ đánh dấu        │
│ Câu 2   ⚑                                                  │                    │
│ ...  (all questions on one page, scrolling)                │  [  Nộp bài  ]     │
└────────────────────────────────────────────────────────────┴────────────────────┘
```

Mobile: a sticky top bar shows `⏱ 38:12 · 17/42 · [Nộp bài]` (Submit). The "Danh sách câu" (question list) button opens the question grid in a bottom sheet.

**Behaviour**
- **All questions on one page.** The question grid scrolls to a question (`scrollIntoView`), and each question's number is highlighted in the grid while it is on screen.
- **Answer controls.** Single-answer questions use radio buttons, and tapping the chosen option again does not clear it; a small "Bỏ chọn" (clear) link does. Multiple-answer questions use checkboxes, with the caption "Chọn một hoặc nhiều đáp án" ("choose one or more answers").
- **⚑ Flag for review.** Only stored in the browser (`localStorage`), not graded. It is just a reminder to come back to the question.
- **Save status:**
  - `● Đã lưu` (saved)
  - `◌ Đang lưu…` (saving)
  - `⚠ Mất kết nối – đang thử lại` (connection lost – retrying), shown in amber.

  While offline, answers wait in a queue and are resent when the connection returns. Leaving the page with unsent answers triggers the browser's "leave this page?" warning.
- **Timer** counts down to `deadlineAt`, corrected for the server's clock. It turns amber under 5 minutes and red under 1 minute, with a toast at 5 minutes. At 0 the client sends all queued answers and then submits. A full-screen message "Hết giờ — đang nộp bài…" (time's up — submitting…) shows until the results page loads.
- **Submit dialog:** "Bạn còn **3 câu chưa làm** (12, 30, 41). Nộp bài?" ("You have 3 unanswered questions (12, 30, 41). Submit?") with the buttons [Tiếp tục làm bài] (keep working) and [Nộp bài] (submit). The submit button is disabled while the request is in flight.
- **Resuming:** reloading or reopening the page restores every saved answer and the remaining time.

### 10. Results

```
┌──────────────────────────────────────────────┐
│  Pháp luật đại cương 01                      │
│        7,14 / 10                             │
│  ✓ 30 đúng   ✗ 9 sai   ○ 3 chưa làm   42 câu │
│  Thời gian làm bài: 31 phút 05 giây          │
│  [Làm lại]  [Về danh sách đề]                │
├──────────────────────────────────────────────┤
│ Lọc: (Tất cả) (Sai) (Chưa làm)               │
│ Câu 6  ✗                                     │
│  ✗ A  Quyền lực tư tưởng        ← bạn chọn   │
│  ✓ B  Quyền lực kinh tế         ← đáp án đúng│
│     C  …                                     │
│  💡 Giải thích: … (only when available)      │
└──────────────────────────────────────────────┘
```

- Each question is marked ✓ (correct), ✗ (incorrect) or ○ (unanswered).
- Within a question, the correct option is green with a ✓. A wrongly chosen option is red with a ✗. Unchosen options are neutral.
- "Hết giờ (tự động nộp)" (time ran out, submitted automatically) appears as a badge when `submit_reason = timeout`.
- Time spent is `submitted_at − started_at`.

### 6. Import review (most important for the admin)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Kiểm tra đề: Pháp luật đại cương 01          [Cài đặt đề]  [Xuất bản ▸]        │
│ ┌───────────┬───────────────┬──────────────┬───────────────┐                   │
│ │ Tổng 42   │ Từ PDF 37     │ AI gợi ý 3   │ Cần xử lý 2   │                   │
│ └───────────┴───────────────┴──────────────┴───────────────┘                   │
│ ⚠ 1 cảnh báo nhập: Đáp án cho câu 43 không khớp câu hỏi nào.  [Xem]            │
│ Lọc: [Cần xử lý ▾]   ☐ Chọn tất cả   [✨ Hỏi AI (2 câu)]  [✓ Xác nhận đã chọn] │
├───────────────────────────────────────────────────────────────────────────────┤
│ ☐ 12  ⛔ Thiếu đáp án                     Nhà nước nào sau đây có hình thức…  │
│ ☐  7  ⚠ Kiểm tra nội dung: "Cả B và C"    Nhà nước phong kiến Việt Nam…  ✓ C  │
│ ☐ 19  ✨ AI gợi ý (cần xác nhận)  · Gốc PDF: –                     ✓ A         │
│ ☐  1  ✓ Từ PDF                            Pháp luật đại cương nằm trong…  ✓ B │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Sort order:** `invalid`, `ambiguous`, `missing` first, then `ai_suggested`, then rows with warnings, then `extracted_valid`, then `verified`. Within each group, by position.
- **Status badges** (colour + icon + text):
  - ⛔ Thiếu / Sai / Mơ hồ (missing / invalid / ambiguous) in red
  - ✨ AI gợi ý (AI suggested) in violet
  - ⚠ Cảnh báo (warning) in amber
  - ✓ Từ PDF (from PDF) in grey
  - ✓✓ Đã xác nhận (verified) in green.

  The answer's source is shown as a small tag: "PDF", "AI" or "Thủ công" (manual).
- **AI flow:** "Hỏi AI" (ask AI) is disabled when nothing is selected and hidden when AI is off. Clicking it opens a dialog: "Gửi **2 câu** tới AI (gpt-4o-mini). Câu đã có trong bộ nhớ đệm sẽ không tính phí. Tiếp tục?" ("Send 2 questions to the AI (gpt-4o-mini). Questions already in the cache are not charged. Continue?"). Afterwards a toast reports "Đã áp dụng 2 · từ bộ nhớ đệm 0 · bị từ chối 0" (applied 2 · from cache 0 · rejected 0).
- **"Xuất bản" (Publish)** runs validation. If there are issues, a dialog lists them, and each one links to its question.

### 7. Question editor (side panel)

- Stem: a textarea.
- Options: a list of rows `[label] [text input] [✓ đúng]` with add, remove and move up/down. Labels A, B, C… are re-assigned automatically from the order.
- Selection type: two toggle buttons, Một đáp án (single) / Nhiều đáp án (multiple). Locked when the quiz mode is not `mixed`, with a note explaining why.
- Explanation: a textarea.
- **Provenance panel**, read-only:
  - "Đáp án gốc từ PDF: B" (original answer from the PDF)
  - "Nguồn hiện tại: Thủ công" (current source: manual)
  - the `LETTER_REFERENCE` warning, if there is one.
- **Buttons:** [Lưu] (save) and [Lưu & xác nhận] (save and verify). Pressing Lưu & xác nhận and then `Ctrl/⌘+Enter` saves the question, verifies it and jumps to the next unresolved one.

### 5. PDF upload

- Choose a subject (dropdown, with "+ Môn mới" to add a new subject) and drop or pick a file (`accept="application/pdf"`, at most 10 MB, checked before upload).
- A progress bar shows the upload, followed by the step "Đang phân tích…" (analysing…).
- On success the review screen opens. On `PARSE_FAILED` the error message is shown, with a [Thử file khác] (try another file) button.
- A duplicate file shows: "File này đã được nhập ngày 18/11 → Mở đề cũ / Vẫn nhập" (This file was already imported on 18/11 → open the earlier quiz / import anyway).

### Other screens (short)

- **Login:** email, password and "Đăng nhập" (log in). There is no sign-up link. The text says "Tài khoản chỉ được tạo qua lời mời" ("Accounts are created by invitation only").
- **Accept invitation:** shows the invited email (read-only), then full name, password and confirm password. An invalid or expired link shows "Lời mời không hợp lệ hoặc đã hết hạn — liên hệ quản trị viên" ("This invitation is invalid or expired — contact the administrator").
- **Library (student):**
  - cards grouped by subject, with a search box
  - each card shows the title, number of questions, duration, and the student's best and latest score
  - each card has a [Làm bài] (start) or [Tiếp tục] (continue) button; Continue appears while an attempt is in progress.
- **Library (admin):** a table of title, subject, status, number of questions and updated date, filtered by status and subject.
- **Quiz detail:**
  - description, number of questions, duration, answer mode in plain words
  - the student's past attempts on this quiz
  - a [Bắt đầu] (start) button that opens a confirmation: "Thời gian 45 phút sẽ bắt đầu tính ngay" ("The 45-minute timer starts now").
  - Admins also see Preview, which shows the student view with no timer and no saving.
- **Quiz configuration:**
  - title, description, subject
  - duration (minutes)
  - default answer mode: three radio cards (Một đáp án / Nhiều đáp án / Hỗn hợp: single / multiple / mixed)
  - publish status, plus buttons for Ẩn (unpublish), Lưu trữ (archive) and Xoá (delete, drafts only)
  - version history (v1, v2… with their dates).
- **History:**
  - a table of attempts showing quiz, date, score, correct count and time spent, each linking to its result
  - "Chỉ câu sai" (wrong answers only) opens the results page with the "Sai" (wrong) filter
  - a "Làm lại" (retake) button.
- **Users & invitations:**
  - a tab of users (name, email, role, status, an active toggle)
  - a tab of invitations (email, expiry, status, Revoke)
  - "Mời người dùng" (invite a user): enter an email, then the dialog shows the link once with [Sao chép] (copy) and "Hết hạn sau 72 giờ" ("expires in 72 hours").
- **Admin dashboard:**
  - four counts: users, published quizzes, drafts that need review, attempts in the last 7 days
  - a list of recent imports, linking to their review
  - AI status (on or off).

## 4. Shared components

`AppShell`, `PageHeader`, `StatCard`, `StatusBadge` (answer status and source), `QuestionCard` (modes: exam, review, result, preview), `OptionRow`, `QuestionNavGrid`, `CountdownTimer`, `SaveIndicator`, `ConfirmDialog`, `EmptyState`, `ErrorState`, `DataTable` (shadcn table + filters), `FileDropzone`.

`QuestionCard` is the same component in all four modes, so every screen looks the same.

## 5. Vietnamese wording (main labels)

| Key | Text |
|---|---|
| answerMode.single / multiple / mixed | Một đáp án / Nhiều đáp án / Hỗn hợp |
| status.draft / published / archived | Bản nháp / Đã xuất bản / Lưu trữ |
| answerStatus.* | Từ PDF · Thiếu đáp án · Đáp án sai định dạng · Mơ hồ · AI gợi ý · Đã xác nhận |
| exam.submit / confirm | Nộp bài / Bạn chắc chắn muốn nộp bài? |
| result.correct / incorrect / unanswered | Đúng / Sai / Chưa làm |
