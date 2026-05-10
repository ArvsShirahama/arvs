-- ============================================================
-- Migration: Conversation Summaries RPC (pagination + unread)
-- Run this in Supabase SQL Editor
-- ============================================================

create or replace function public.get_conversation_summaries(
  p_user_id uuid,
  p_limit integer default 30,
  p_before timestamptz default null
)
returns table (
  conversation_id uuid,
  updated_at timestamptz,
  other_user jsonb,
  last_message jsonb,
  unread_count integer
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
      'thumbnail_url', lm.thumbnail_url,
      'status', lm.status,
      'delivered_at', lm.delivered_at,
      'read_at', lm.read_at,
      'created_at', lm.created_at
    )
  end as last_message,
  coalesce(uc.unread_count, 0) as unread_count
from my_conversations mc
inner join other_participants op
  on op.conversation_id = mc.id
left join last_messages lm
  on lm.conversation_id = mc.id
left join unread_counts uc
  on uc.conversation_id = mc.id
order by mc.updated_at desc;
$$;

grant execute on function public.get_conversation_summaries(uuid, integer, timestamptz) to authenticated;

create index if not exists idx_conversations_updated_at on public.conversations(updated_at desc);
create index if not exists idx_messages_conversation_sender_created
  on public.messages(conversation_id, sender_id, created_at desc);

-- ============================================================
-- DONE
-- ============================================================
