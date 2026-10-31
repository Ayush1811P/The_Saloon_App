-- BOOKSALOON | 010: Server-side admin sessions
-- Supabase Auth remains responsible for password verification. This table
-- tracks dashboard sessions and makes the three-device limit enforceable by RPC.

create table public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text
);

create index admin_sessions_active_idx
  on public.admin_sessions (created_at)
  where revoked_at is null;

alter table public.admin_sessions enable row level security;

create or replace function public.issue_admin_session(p_user_agent text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
begin
  if v_user_id is null or not exists (
    select 1
    from public.platform_admins
    where user_id = v_user_id
  ) then
    raise exception 'ADMIN_ACCESS_REQUIRED' using errcode = '42501';
  end if;

  -- Serialize issuance so concurrent logins cannot exceed three active rows.
  perform pg_advisory_xact_lock(hashtextextended('booksaloon-admin-session-limit', 0));

  update public.admin_sessions
  set revoked_at = now(),
      revoked_reason = 'SESSION_LIMIT'
  where id = (
    select id
    from public.admin_sessions
    where revoked_at is null
    order by created_at asc
    offset 2
    limit 1
  );

  insert into public.admin_sessions (user_id, user_agent)
  values (v_user_id, nullif(trim(p_user_agent), ''))
  returning id into v_session_id;

  return v_session_id;
end;
$$;

create or replace function public.validate_admin_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  update public.admin_sessions
  set last_seen_at = now()
  where id = p_session_id
    and user_id = auth.uid()
    and revoked_at is null;

  return found;
end;
$$;

create or replace function public.revoke_admin_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.admin_sessions
  set revoked_at = now(),
      revoked_reason = 'LOGOUT'
  where id = p_session_id
    and user_id = auth.uid()
    and revoked_at is null;

  return found;
end;
$$;

revoke all on public.admin_sessions from public, anon, authenticated;
revoke all on function public.issue_admin_session(text) from public, anon;
revoke all on function public.validate_admin_session(uuid) from public, anon;
revoke all on function public.revoke_admin_session(uuid) from public, anon;
grant execute on function public.issue_admin_session(text) to authenticated;
grant execute on function public.validate_admin_session(uuid) to authenticated;
grant execute on function public.revoke_admin_session(uuid) to authenticated;
