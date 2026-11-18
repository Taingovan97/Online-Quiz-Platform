-- M1: profiles, invitations, role helper, RLS.
-- See docs/design.md §A.

create type public.user_role as enum ('admin', 'student');

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique check (email = lower(email)),
  full_name   text not null check (length(full_name) between 1 and 100),
  role        public.user_role not null default 'student',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.invitations (
  id               uuid primary key default gen_random_uuid(),
  email            text not null check (email = lower(email)),
  token_hash       text not null unique,
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  accepted_user_id uuid references public.profiles(id) on delete set null,
  revoked_at       timestamptz,
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  check (not (accepted_at is not null and revoked_at is not null))
);

-- at most one open invitation per email
create unique index invitations_one_open_per_email
  on public.invitations(email) where accepted_at is null and revoked_at is null;

-- Role helper used by RLS policies. SECURITY DEFINER so it can read profiles
-- regardless of the caller's own policies; it only ever inspects auth.uid().
create function public.is_admin() returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- RLS ---------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.invitations enable row level security;

-- profiles: read own row; admins read all. No insert/update/delete policies:
-- role and is_active can only be changed with the service (secret) key.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- invitations: admins may read. All writes happen server-side with the secret key.
create policy invitations_select_admin on public.invitations
  for select to authenticated
  using (public.is_admin());

-- Defense in depth: strip table privileges from anon entirely.
revoke all on public.profiles    from anon;
revoke all on public.invitations from anon;
-- authenticated users never write these tables directly.
revoke insert, update, delete on public.profiles    from authenticated;
revoke insert, update, delete on public.invitations from authenticated;
