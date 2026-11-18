-- M4: exam attempts, answers, server-authoritative timing, idempotent submission.
-- See docs/design.md §A.2, §A.5. Grace period (10 s) mirrors src/lib/grading/deadline.ts.

create type public.attempt_status as enum ('in_progress', 'submitted');
create type public.submit_reason  as enum ('manual', 'timeout');

create table public.attempts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete restrict,
  quiz_id          uuid not null references public.quizzes(id) on delete restrict,
  quiz_version_id  uuid not null references public.quiz_versions(id) on delete restrict,
  status           public.attempt_status not null default 'in_progress',
  started_at       timestamptz not null default now(),
  deadline_at      timestamptz not null,
  submitted_at     timestamptz,
  submit_reason    public.submit_reason,
  graded_at        timestamptz,
  total_questions  int not null check (total_questions > 0),
  correct_count    int,
  incorrect_count  int,
  unanswered_count int,
  score            numeric(6,4) check (score between 0 and 10),
  check ((status = 'submitted') = (submitted_at is not null and submit_reason is not null)),
  check (deadline_at > started_at),
  check (graded_at is null or status = 'submitted')
);
create unique index attempts_one_active on public.attempts(user_id, quiz_id) where status = 'in_progress';
create index attempts_user_recent on public.attempts(user_id, started_at desc);
create index attempts_open_deadline on public.attempts(deadline_at) where status = 'in_progress';

create table public.attempt_answers (
  attempt_id      uuid not null references public.attempts(id) on delete cascade,
  question_id     uuid not null, -- snapshot question id; no FK on purpose (questions stay editable)
  selected_labels text[] not null default '{}',
  is_correct      boolean,
  updated_at      timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

-- Integrity guards ---------------------------------------------------

-- A graded attempt never changes again.
create function public.attempts_guard() returns trigger language plpgsql as $$
begin
  if old.graded_at is not null then
    raise exception 'ATTEMPT_IMMUTABLE' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger attempts_immutable before update on public.attempts
  for each row execute function public.attempts_guard();

-- Answers of a submitted attempt are frozen, except for the one grading pass
-- that fills is_correct (graded_at still null, selection unchanged).
create function public.attempt_answers_guard() returns trigger language plpgsql as $$
declare
  v_status public.attempt_status;
  v_graded timestamptz;
begin
  select status, graded_at into v_status, v_graded from public.attempts where id = new.attempt_id;
  if v_status = 'submitted' then
    if tg_op = 'UPDATE' and v_graded is null and new.selected_labels = old.selected_labels then
      return new;
    end if;
    raise exception 'ATTEMPT_CLOSED' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger attempt_answers_frozen before insert or update on public.attempt_answers
  for each row execute function public.attempt_answers_guard();

-- Exam operations (service role only; callers verify the user) -------

create function public.start_attempt(p_user uuid, p_quiz uuid)
returns public.attempts language plpgsql security definer set search_path = public as $$
declare
  v_quiz quizzes;
  v_version quiz_versions;
  v_attempt attempts;
begin
  select * into v_attempt from attempts
   where user_id = p_user and quiz_id = p_quiz and status = 'in_progress';
  if found then return v_attempt; end if;

  select * into v_quiz from quizzes where id = p_quiz;
  if v_quiz.id is null or v_quiz.status <> 'published' or v_quiz.current_version_id is null then
    raise exception 'QUIZ_NOT_AVAILABLE';
  end if;
  select * into v_version from quiz_versions where id = v_quiz.current_version_id;

  begin
    insert into attempts (user_id, quiz_id, quiz_version_id, deadline_at, total_questions)
    values (p_user, p_quiz, v_version.id,
            now() + make_interval(mins => (v_version.snapshot->>'durationMinutes')::int),
            v_version.question_count)
    returning * into v_attempt;
  exception when unique_violation then
    -- Concurrent start: return the attempt the other request created.
    select * into v_attempt from attempts
     where user_id = p_user and quiz_id = p_quiz and status = 'in_progress';
  end;
  return v_attempt;
end;
$$;

-- Locks the attempt row, so it serializes with claim_submission.
create function public.save_answer(p_user uuid, p_attempt uuid, p_question uuid, p_labels text[], p_grace_s int default 10)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_attempt attempts;
  v_now timestamptz := now();
begin
  select * into v_attempt from attempts where id = p_attempt and user_id = p_user for update;
  if v_attempt.id is null then raise exception 'NOT_FOUND'; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'ATTEMPT_CLOSED'; end if;
  if v_now > v_attempt.deadline_at + make_interval(secs => p_grace_s) then raise exception 'DEADLINE_PASSED'; end if;

  insert into attempt_answers (attempt_id, question_id, selected_labels)
  values (p_attempt, p_question, coalesce(p_labels, '{}'))
  on conflict (attempt_id, question_id) do update set selected_labels = excluded.selected_labels;
  return v_now;
end;
$$;

-- Idempotent: the first call submits; later calls return the submitted row.
create function public.claim_submission(p_user uuid, p_attempt uuid, p_reason public.submit_reason)
returns public.attempts language plpgsql security definer set search_path = public as $$
declare
  v_attempt attempts;
begin
  update attempts
     set status = 'submitted',
         submitted_at = least(now(), deadline_at),
         submit_reason = case when now() > deadline_at then 'timeout'::submit_reason else p_reason end
   where id = p_attempt and user_id = p_user and status = 'in_progress'
  returning * into v_attempt;
  if v_attempt.id is null then
    select * into v_attempt from attempts where id = p_attempt and user_id = p_user;
    if v_attempt.id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_attempt;
end;
$$;

-- Lazy finalization: closes in-progress attempts past deadline + grace.
create function public.close_expired_attempts(p_user uuid default null, p_grace_s int default 10)
returns setof uuid language sql security definer set search_path = public as $$
  update attempts
     set status = 'submitted', submitted_at = deadline_at, submit_reason = 'timeout'
   where status = 'in_progress'
     and now() > deadline_at + make_interval(secs => p_grace_s)
     and (p_user is null or user_id = p_user)
  returning id;
$$;

-- Stores grading results once (graded_at guards double grading).
create function public.record_grade(
  p_attempt uuid, p_results jsonb, p_correct int, p_incorrect int, p_unanswered int, p_score numeric
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform 1 from attempts where id = p_attempt and status = 'submitted' and graded_at is null for update;
  if not found then return false; end if;

  update attempt_answers a
     set is_correct = (r.value)::boolean
    from jsonb_each_text(p_results) r
   where a.attempt_id = p_attempt and a.question_id = r.key::uuid;

  update attempts
     set correct_count = p_correct, incorrect_count = p_incorrect,
         unanswered_count = p_unanswered, score = p_score, graded_at = now()
   where id = p_attempt;
  return true;
end;
$$;

revoke execute on function public.start_attempt(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.save_answer(uuid, uuid, uuid, text[], int) from public, anon, authenticated;
revoke execute on function public.claim_submission(uuid, uuid, public.submit_reason) from public, anon, authenticated;
revoke execute on function public.close_expired_attempts(uuid, int) from public, anon, authenticated;
revoke execute on function public.record_grade(uuid, jsonb, int, int, int, numeric) from public, anon, authenticated;

-- RLS ---------------------------------------------------------------
alter table public.attempts        enable row level security;
alter table public.attempt_answers enable row level security;

create policy attempts_select on public.attempts
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

create policy attempt_answers_select on public.attempt_answers
  for select to authenticated using (
    public.is_admin()
    or exists (select 1 from public.attempts a
               where a.id = attempt_id and a.user_id = auth.uid() and a.status = 'submitted')
  );

revoke all on public.attempts, public.attempt_answers from anon;
revoke insert, update, delete on public.attempts, public.attempt_answers from authenticated;
