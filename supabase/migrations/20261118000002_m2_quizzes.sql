-- M2: subjects, quizzes, questions, options, immutable published versions.
-- See docs/design.md §A.

create type public.quiz_status    as enum ('draft', 'published', 'archived');
create type public.answer_mode    as enum ('single', 'multiple', 'mixed');
create type public.selection_type as enum ('single', 'multiple');
create type public.answer_status  as enum ('extracted_valid', 'missing', 'invalid',
                                           'ambiguous', 'ai_suggested', 'verified');
create type public.answer_source  as enum ('pdf_extracted', 'ai_generated', 'manually_verified');

create function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Tables ------------------------------------------------------------
create table public.subjects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 120),
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index subjects_name_ci on public.subjects(lower(name));
create trigger subjects_updated_at before update on public.subjects
  for each row execute function public.set_updated_at();

create table public.quizzes (
  id                 uuid primary key default gen_random_uuid(),
  subject_id         uuid not null references public.subjects(id) on delete restrict,
  title              text not null check (length(trim(title)) between 1 and 200),
  description        text,
  duration_minutes   int  not null default 45 check (duration_minutes between 1 and 300),
  default_mode       public.answer_mode not null default 'single',
  status             public.quiz_status not null default 'draft',
  current_version_id uuid,
  created_by         uuid not null references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index quizzes_subject_status on public.quizzes(subject_id, status);
create trigger quizzes_updated_at before update on public.quizzes
  for each row execute function public.set_updated_at();

create table public.questions (
  id              uuid primary key default gen_random_uuid(),
  quiz_id         uuid not null references public.quizzes(id) on delete cascade,
  position        int  not null check (position > 0),
  source_number   int,
  content         text not null check (length(content) > 0),
  selection_type  public.selection_type not null default 'single',
  explanation     text,
  answer_status   public.answer_status not null default 'missing',
  answer_source   public.answer_source,
  original_answer text[],
  content_hash    text not null,
  updated_at      timestamptz not null default now(),
  constraint questions_quiz_position unique (quiz_id, position) deferrable initially immediate
);
create trigger questions_updated_at before update on public.questions
  for each row execute function public.set_updated_at();

create table public.question_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  label       char(1) not null check (label ~ '^[A-F]$'),
  content     text not null check (length(content) > 0),
  is_correct  boolean not null default false,
  unique (question_id, label)
);

create table public.quiz_versions (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid not null references public.quizzes(id) on delete cascade,
  version_no     int  not null check (version_no > 0),
  snapshot       jsonb not null,
  question_count int  not null check (question_count > 0),
  published_by   uuid not null references public.profiles(id),
  published_at   timestamptz not null default now(),
  unique (quiz_id, version_no)
);
alter table public.quizzes add constraint quizzes_current_version_fk
  foreign key (current_version_id) references public.quiz_versions(id) on delete set null;

-- original_answer is write-once: once set it may never change.
create function public.questions_freeze_original_answer() returns trigger language plpgsql as $$
begin
  if old.original_answer is not null and new.original_answer is distinct from old.original_answer then
    raise exception 'original_answer is immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger questions_original_answer_immutable before update on public.questions
  for each row execute function public.questions_freeze_original_answer();

-- Published snapshots are immutable.
create function public.forbid_update() returns trigger language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name using errcode = 'check_violation';
end;
$$;
create trigger quiz_versions_immutable before update on public.quiz_versions
  for each row execute function public.forbid_update();

-- Atomic write helpers (service role only) ---------------------------

-- Inserts (p_question null) or replaces a draft question and all its options.
-- p_fields: {content, selection_type, explanation, answer_status, answer_source, content_hash}
-- p_options: [{label, content, is_correct}, ...]
create function public.save_question(p_quiz uuid, p_question uuid, p_fields jsonb, p_options jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_status public.quiz_status;
  v_id uuid := p_question;
begin
  select status into v_status from quizzes where id = p_quiz for update;
  if v_status is null then raise exception 'NOT_FOUND'; end if;
  if v_status <> 'draft' then raise exception 'QUIZ_NOT_DRAFT'; end if;

  if v_id is null then
    insert into questions (quiz_id, position, content, selection_type, explanation,
                           answer_status, answer_source, content_hash)
    values (p_quiz,
            coalesce((select max(position) from questions where quiz_id = p_quiz), 0) + 1,
            p_fields->>'content',
            (p_fields->>'selection_type')::selection_type,
            nullif(p_fields->>'explanation', ''),
            (p_fields->>'answer_status')::answer_status,
            (p_fields->>'answer_source')::answer_source,
            p_fields->>'content_hash')
    returning id into v_id;
  else
    update questions set
      content        = p_fields->>'content',
      selection_type = (p_fields->>'selection_type')::selection_type,
      explanation    = nullif(p_fields->>'explanation', ''),
      answer_status  = (p_fields->>'answer_status')::answer_status,
      answer_source  = (p_fields->>'answer_source')::answer_source,
      content_hash   = p_fields->>'content_hash'
    where id = v_id and quiz_id = p_quiz;
    if not found then raise exception 'NOT_FOUND'; end if;
    delete from question_options where question_id = v_id;
  end if;

  insert into question_options (question_id, label, content, is_correct)
  select v_id, o->>'label', o->>'content', (o->>'is_correct')::boolean
  from jsonb_array_elements(p_options) as o;

  return v_id;
end;
$$;

-- Deletes a draft question and closes the gap in positions.
create function public.delete_question(p_quiz uuid, p_question uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status public.quiz_status;
  v_pos int;
begin
  select status into v_status from quizzes where id = p_quiz for update;
  if v_status is null then raise exception 'NOT_FOUND'; end if;
  if v_status <> 'draft' then raise exception 'QUIZ_NOT_DRAFT'; end if;
  delete from questions where id = p_question and quiz_id = p_quiz returning position into v_pos;
  if v_pos is null then raise exception 'NOT_FOUND'; end if;
  set constraints questions_quiz_position deferred;
  update questions set position = position - 1 where quiz_id = p_quiz and position > v_pos;
end;
$$;

-- Stores a new immutable version and publishes the quiz (draft only).
create function public.publish_quiz(p_quiz uuid, p_user uuid, p_snapshot jsonb, p_question_count int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_status public.quiz_status;
  v_no int;
  v_version uuid;
begin
  select status into v_status from quizzes where id = p_quiz for update;
  if v_status is null then raise exception 'NOT_FOUND'; end if;
  if v_status <> 'draft' then raise exception 'QUIZ_NOT_DRAFT'; end if;

  select coalesce(max(version_no), 0) + 1 into v_no from quiz_versions where quiz_id = p_quiz;
  insert into quiz_versions (quiz_id, version_no, snapshot, question_count, published_by)
  values (p_quiz, v_no, jsonb_set(p_snapshot, '{versionNo}', to_jsonb(v_no)), p_question_count, p_user)
  returning id into v_version;

  update quizzes set status = 'published', current_version_id = v_version where id = p_quiz;
  return v_no;
end;
$$;

revoke execute on function public.save_question(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.delete_question(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.publish_quiz(uuid, uuid, jsonb, int) from public, anon, authenticated;

-- RLS ---------------------------------------------------------------
alter table public.subjects         enable row level security;
alter table public.quizzes          enable row level security;
alter table public.questions        enable row level security;
alter table public.question_options enable row level security;
alter table public.quiz_versions    enable row level security;

create policy subjects_select on public.subjects
  for select to authenticated using (true);

create policy quizzes_select on public.quizzes
  for select to authenticated using (status = 'published' or public.is_admin());

create policy questions_select_admin on public.questions
  for select to authenticated using (public.is_admin());

create policy question_options_select_admin on public.question_options
  for select to authenticated using (public.is_admin());

-- Version metadata is readable for published quizzes; the snapshot column (which
-- contains the answer key) is NOT granted to `authenticated` at all — only the
-- secret-key server client can read it.
create policy quiz_versions_select on public.quiz_versions
  for select to authenticated using (
    public.is_admin()
    or exists (select 1 from public.quizzes q where q.id = quiz_id and q.status = 'published')
  );
revoke select on public.quiz_versions from authenticated;
grant select (id, quiz_id, version_no, question_count, published_by, published_at)
  on public.quiz_versions to authenticated;

-- All writes go through server code using the secret key.
revoke all on public.subjects, public.quizzes, public.questions,
              public.question_options, public.quiz_versions from anon;
revoke insert, update, delete on public.subjects, public.quizzes, public.questions,
              public.question_options, public.quiz_versions from authenticated;
