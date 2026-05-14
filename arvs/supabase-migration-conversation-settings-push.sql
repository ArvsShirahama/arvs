-- ============================================================
-- Migration: Conversation Settings, Media Metadata, and Push Tokens
-- Run this in Supabase SQL Editor
-- ============================================================

create table if not exists public.conversation_preferences (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  peer_nickname text,
  theme_id text not null default 'sunrise',
  background_type text not null default 'gradient',
  background_image_url text,
  background_image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  constraint conversation_preferences_background_type_check
    check (background_type in ('gradient', 'image'))
);

create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null,
  app_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.conversation_preferences enable row level security;
alter table public.push_tokens enable row level security;

alter table public.messages add column if not exists media_path text;
alter table public.messages add column if not exists media_name text;
alter table public.messages add column if not exists media_mime_type text;
alter table public.messages add column if not exists media_size_bytes bigint;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_conversation_preferences_updated_at on public.conversation_preferences;
create trigger set_conversation_preferences_updated_at
  before update on public.conversation_preferences
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_push_tokens_updated_at on public.push_tokens;
create trigger set_push_tokens_updated_at
  before update on public.push_tokens
  for each row
  execute function public.set_updated_at();

drop policy if exists "Users can view their own conversation preferences" on public.conversation_preferences;
create policy "Users can view their own conversation preferences"
  on public.conversation_preferences for select
  to authenticated
  using (user_id = auth.uid() and public.is_conversation_member(conversation_id));

drop policy if exists "Users can manage their own conversation preferences" on public.conversation_preferences;
create policy "Users can manage their own conversation preferences"
  on public.conversation_preferences for all
  to authenticated
  using (user_id = auth.uid() and public.is_conversation_member(conversation_id))
  with check (user_id = auth.uid() and public.is_conversation_member(conversation_id));

drop policy if exists "Users can view their own push tokens" on public.push_tokens;
create policy "Users can view their own push tokens"
  on public.push_tokens for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert their own push tokens" on public.push_tokens;
create policy "Users can insert their own push tokens"
  on public.push_tokens for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update their own push tokens" on public.push_tokens;
create policy "Users can update their own push tokens"
  on public.push_tokens for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can delete their own push tokens" on public.push_tokens;
create policy "Users can delete their own push tokens"
  on public.push_tokens for delete
  to authenticated
  using (user_id = auth.uid());

create index if not exists idx_conversation_preferences_user_id
  on public.conversation_preferences(user_id, updated_at desc);
create index if not exists idx_push_tokens_user_id
  on public.push_tokens(user_id, last_seen_at desc);
create index if not exists idx_messages_conversation_media_created
  on public.messages(conversation_id, message_type, created_at desc)
  where message_type in ('image', 'video', 'file');

insert into storage.buckets (id, name, public)
values ('conversation-backgrounds', 'conversation-backgrounds', true)
on conflict (id) do nothing;

drop policy if exists "Anyone can view conversation backgrounds" on storage.objects;
create policy "Anyone can view conversation backgrounds"
  on storage.objects for select
  using (bucket_id = 'conversation-backgrounds');

drop policy if exists "Users can upload conversation backgrounds" on storage.objects;
create policy "Users can upload conversation backgrounds"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'conversation-backgrounds'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update their own conversation backgrounds" on storage.objects;
create policy "Users can update their own conversation backgrounds"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'conversation-backgrounds'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own conversation backgrounds" on storage.objects;
create policy "Users can delete their own conversation backgrounds"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'conversation-backgrounds'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop function if exists public.get_conversation_summaries(uuid, integer, timestamptz);

create function public.get_conversation_summaries(
  p_user_id uuid,
  p_limit integer default 30,
  p_before timestamptz default null
)
returns table (
  conversation_id uuid,
  updated_at timestamptz,
  other_user jsonb,
  last_message jsonb,
  unread_count integer,
  preference jsonb
)
language sql
security definer
set search_path = ''
as $$
with my_conversations as (
  select c.id, c.updated_at
  from public.conversations c
  inner join public.conversation_participants cp
    on cp.conversation_id = c.id
   and cp.user_id = p_user_id
  where (p_before is null or c.updated_at < p_before)
  order by c.updated_at desc
  limit greatest(p_limit, 1)
),
other_participants as (
  select
    mc.id as conversation_id,
    p.id as user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.last_seen,
    p.created_at
  from my_conversations mc
  inner join public.conversation_participants cp
    on cp.conversation_id = mc.id
   and cp.user_id <> p_user_id
  inner join public.profiles p
    on p.id = cp.user_id
),
last_messages as (
  select distinct on (m.conversation_id)
    m.id,
    m.conversation_id,
    m.sender_id,
    m.content,
    m.message_type,
    m.media_url,
    m.media_path,
    m.media_name,
    m.media_mime_type,
    m.media_size_bytes,
    m.thumbnail_url,
    m.status,
    m.delivered_at,
    m.read_at,
    m.created_at
  from public.messages m
  inner join my_conversations mc
    on mc.id = m.conversation_id
  order by m.conversation_id, m.created_at desc
),
last_read_times as (
  select
    cp.conversation_id,
    rm.created_at as last_read_created_at
  from public.conversation_participants cp
  left join public.messages rm
    on rm.id = cp.last_read_message_id
  where cp.user_id = p_user_id
    and cp.conversation_id in (select id from my_conversations)
),
unread_counts as (
  select
    mc.id as conversation_id,
    count(m.id)::integer as unread_count
  from my_conversations mc
  left join last_read_times lrt
    on lrt.conversation_id = mc.id
  left join public.messages m
    on m.conversation_id = mc.id
   and m.sender_id <> p_user_id
   and (lrt.last_read_created_at is null or m.created_at > lrt.last_read_created_at)
  group by mc.id
),
current_preferences as (
  select
    cp.conversation_id,
    cp.user_id,
    cp.peer_nickname,
    cp.theme_id,
    cp.background_type,
    cp.background_image_url,
    cp.background_image_path,
    cp.created_at,
    cp.updated_at
  from public.conversation_preferences cp
  where cp.user_id = p_user_id
    and cp.conversation_id in (select id from my_conversations)
)
select
  mc.id as conversation_id,
  mc.updated_at,
  jsonb_build_object(
    'id', op.user_id,
    'username', op.username,
    'display_name', op.display_name,
    'avatar_url', op.avatar_url,
    'last_seen', op.last_seen,
    'created_at', op.created_at
  ) as other_user,
  case
    when lm.id is null then null
    else jsonb_build_object(
      'id', lm.id,
      'conversation_id', lm.conversation_id,
      'sender_id', lm.sender_id,
      'content', lm.content,
      'message_type', lm.message_type,
      'media_url', lm.media_url,
      'media_path', lm.media_path,
      'media_name', lm.media_name,
      'media_mime_type', lm.media_mime_type,
      'media_size_bytes', lm.media_size_bytes,
      'thumbnail_url', lm.thumbnail_url,
      'status', lm.status,
      'delivered_at', lm.delivered_at,
      'read_at', lm.read_at,
      'created_at', lm.created_at
    )
  end as last_message,
  coalesce(uc.unread_count, 0) as unread_count,
  case
    when pref.conversation_id is null then null
    else jsonb_build_object(
      'conversation_id', pref.conversation_id,
      'user_id', pref.user_id,
      'peer_nickname', pref.peer_nickname,
      'theme_id', pref.theme_id,
      'background_type', pref.background_type,
      'background_image_url', pref.background_image_url,
      'background_image_path', pref.background_image_path,
      'created_at', pref.created_at,
      'updated_at', pref.updated_at
    )
  end as preference
from my_conversations mc
inner join other_participants op
  on op.conversation_id = mc.id
left join last_messages lm
  on lm.conversation_id = mc.id
left join unread_counts uc
  on uc.conversation_id = mc.id
left join current_preferences pref
  on pref.conversation_id = mc.id
order by mc.updated_at desc;
$$;

grant execute on function public.get_conversation_summaries(uuid, integer, timestamptz) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.conversation_preferences;
  exception when duplicate_object then
    null;
  end;
end $$;

-- After deploying the send-chat-push Edge Function, wire a database webhook to
-- public.messages INSERT events for fully server-triggered notifications.
-- Docs: https://supabase.com/docs/guides/database/webhooks

-- ============================================================
-- DONE
-- ============================================================
