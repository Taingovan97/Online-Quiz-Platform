-- M3: PDF import jobs, AI suggestion cache, private storage bucket.
-- See docs/design.md §A, §C.

create type public.import_status as enum ('uploaded', 'processing', 'parsed', 'failed');

create table public.import_jobs (
  id           uuid primary key default gen_random_uuid(),
  subject_id   uuid not null references public.subjects(id) on delete restrict,
  quiz_id      uuid references public.quizzes(id) on delete set null,
  storage_path text not null unique,
  file_name    text not null check (length(file_name) between 1 and 255),
  file_size    int  not null check (file_size between 1 and 10485760),
  file_sha256  text,
  status       public.import_status not null default 'uploaded',
  summary      jsonb,
  warnings     jsonb not null default '[]',
  error        text,
  created_by   uuid not null references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index import_jobs_sha on public.import_jobs(file_sha256);
create index import_jobs_quiz on public.import_jobs(quiz_id);

create table public.ai_suggestions (
  id               uuid primary key default gen_random_uuid(),
  content_hash     text not null,
  provider         text not null,
  model            text not null,
  suggested_labels text[] not null,
  explanation      text,
  created_at       timestamptz not null default now(),
  unique (content_hash, provider, model)
);

-- Creates the draft quiz with all parsed questions/options in one transaction.
-- p_questions: [{source_number, content, selection_type, explanation, answer_status,
--                answer_source, original_answer[], content_hash,
--                options:[{label, content, is_correct}]}]
create function public.create_imported_quiz(
  p_job uuid, p_title text, p_mode public.answer_mode,
  p_questions jsonb, p_summary jsonb, p_warnings jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_job import_jobs;
  v_quiz uuid;
  v_question uuid;
  q jsonb;
  pos int := 0;
begin
  select * into v_job from import_jobs where id = p_job for update;
  if v_job.id is null then raise exception 'NOT_FOUND'; end if;
  if v_job.status <> 'processing' then raise exception 'JOB_NOT_PROCESSING'; end if;

  insert into quizzes (subject_id, title, default_mode, created_by)
  values (v_job.subject_id, p_title, p_mode, v_job.created_by)
  returning id into v_quiz;

  for q in select * from jsonb_array_elements(p_questions) loop
    pos := pos + 1;
    insert into questions (quiz_id, position, source_number, content, selection_type, explanation,
                           answer_status, answer_source, original_answer, content_hash)
    values (v_quiz, pos, (q->>'source_number')::int, q->>'content',
            (q->>'selection_type')::selection_type, nullif(q->>'explanation', ''),
            (q->>'answer_status')::answer_status, (q->>'answer_source')::answer_source,
            case when jsonb_typeof(q->'original_answer') = 'array'
                 then array(select jsonb_array_elements_text(q->'original_answer')) end,
            q->>'content_hash')
    returning id into v_question;

    insert into question_options (question_id, label, content, is_correct)
    select v_question, o->>'label', o->>'content', (o->>'is_correct')::boolean
    from jsonb_array_elements(q->'options') as o;
  end loop;

  update import_jobs
     set status = 'parsed', quiz_id = v_quiz, summary = p_summary, warnings = p_warnings, error = null
   where id = p_job;
  return v_quiz;
end;
$$;

-- Applies a validated AI suggestion to a draft question. original_answer is untouched.
create function public.apply_ai_answer(p_question uuid, p_labels text[], p_explanation text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status public.quiz_status;
begin
  select z.status into v_status
    from questions q join quizzes z on z.id = q.quiz_id
   where q.id = p_question for update of z;
  if v_status is null then raise exception 'NOT_FOUND'; end if;
  if v_status <> 'draft' then raise exception 'QUIZ_NOT_DRAFT'; end if;

  update question_options set is_correct = (label = any(p_labels)) where question_id = p_question;
  update questions
     set answer_status = 'ai_suggested',
         answer_source = 'ai_generated',
         explanation = coalesce(explanation, nullif(p_explanation, ''))
   where id = p_question;
end;
$$;

revoke execute on function public.create_imported_quiz(uuid, text, public.answer_mode, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.apply_ai_answer(uuid, text[], text) from public, anon, authenticated;

-- RLS ---------------------------------------------------------------
alter table public.import_jobs    enable row level security;
alter table public.ai_suggestions enable row level security;

create policy import_jobs_select_admin on public.import_jobs
  for select to authenticated using (public.is_admin());
create policy ai_suggestions_select_admin on public.ai_suggestions
  for select to authenticated using (public.is_admin());

revoke all on public.import_jobs, public.ai_suggestions from anon;
revoke insert, update, delete on public.import_jobs, public.ai_suggestions from authenticated;

-- Storage: private bucket for uploaded PDFs ---------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imports', 'imports', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy imports_admin_select on storage.objects
  for select to authenticated using (bucket_id = 'imports' and public.is_admin());
create policy imports_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'imports' and public.is_admin());
create policy imports_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'imports' and public.is_admin());
