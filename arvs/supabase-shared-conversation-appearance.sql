-- ============================================================
-- Migration: Shared 1:1 Conversation Appearance and Nicknames
-- Run this in Supabase SQL Editor.
-- Keeps background/theme shared and adds Messenger-style shared nicknames.
-- ============================================================

create table if not exists public.conversation_nicknames (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  nickname text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.conversation_nicknames enable row level security;

drop trigger if exists set_conversation_nicknames_updated_at on public.conversation_nicknames;
create trigger set_conversation_nicknames_updated_at
  before update on public.conversation_nicknames
  for each row
  execute function public.set_updated_at();

drop policy if exists "Conversation members can view nicknames" on public.conversation_nicknames;
create policy "Conversation members can view nicknames"
  on public.conversation_nicknames for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "Conversation members can insert nicknames through RPC" on public.conversation_nicknames;
create policy "Conversation members can insert nicknames through RPC"
  on public.conversation_nicknames for insert
  to authenticated
  with check (false);

drop policy if exists "Conversation members can update nicknames through RPC" on public.conversation_nicknames;
create policy "Conversation members can update nicknames through RPC"
  on public.conversation_nicknames for update
  to authenticated
  using (false)
  with check (false);

do $$
begin
  begin
    alter publication supabase_realtime add table public.conversation_nicknames;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

drop function if exists public.save_conversation_participant_nickname(
  uuid,
  uuid,
  text
);

create or replace function public.save_conversation_participant_nickname(
  p_conversation_id uuid,
  p_user_id uuid,
  p_nickname text
)
returns public.conversation_nicknames
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_user_id uuid := auth.uid();
  v_result public.conversation_nicknames;
begin
  if v_current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not a conversation member';
  end if;

  if not exists (
    select 1
    from public.conversation_participants
    where conversation_id = p_conversation_id
      and user_id = p_user_id
  ) then
    raise exception 'Target user is not a conversation member';
  end if;

  insert into public.conversation_nicknames (
    conversation_id,
    user_id,
    nickname,
    updated_by,
    updated_at
  )
  values (
    p_conversation_id,
    p_user_id,
    nullif(trim(p_nickname), ''),
    v_current_user_id,
    now()
  )
  on conflict (conversation_id, user_id)
  do update set
    nickname = excluded.nickname,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

grant execute on function public.save_conversation_participant_nickname(
  uuid,
  uuid,
  text
) to authenticated;

drop function if exists public.save_shared_conversation_appearance(
  uuid,
  text,
  text,
  text,
  text
);

create or replace function public.save_shared_conversation_appearance(
  p_conversation_id uuid,
  p_theme_id text,
  p_background_type text,
  p_background_image_url text,
  p_background_image_path text
)
returns public.conversation_preferences
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_user_id uuid := auth.uid();
  v_result public.conversation_preferences;
begin
  if v_current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_background_type not in ('gradient', 'image') then
    raise exception 'Invalid background type';
  end if;

  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not a conversation member';
  end if;

  insert into public.conversation_preferences (
    conversation_id,
    user_id,
    peer_nickname,
    theme_id,
    background_type,
    background_image_url,
    background_image_path,
    updated_at
  )
  select
    cp.conversation_id,
    cp.user_id,
    existing.peer_nickname,
    coalesce(p_theme_id, 'system'),
    p_background_type,
    p_background_image_url,
    p_background_image_path,
    now()
  from public.conversation_participants cp
  left join public.conversation_preferences existing
    on existing.conversation_id = cp.conversation_id
   and existing.user_id = cp.user_id
  where cp.conversation_id = p_conversation_id
  on conflict (conversation_id, user_id)
  do update set
    theme_id = excluded.theme_id,
    background_type = excluded.background_type,
    background_image_url = excluded.background_image_url,
    background_image_path = excluded.background_image_path,
    updated_at = now();

  select *
  into v_result
  from public.conversation_preferences
  where conversation_id = p_conversation_id
    and user_id = v_current_user_id;

  if v_result is null then
    raise exception 'Unable to save conversation appearance';
  end if;

  return v_result;
end;
$$;

grant execute on function public.save_shared_conversation_appearance(
  uuid,
  text,
  text,
  text,
  text
) to authenticated;
