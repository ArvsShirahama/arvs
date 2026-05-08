-- ============================================================
-- Arvs Messenger — Supabase Database Setup
-- Run this entire file in the Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- ==============================
-- STEP 1: CREATE ALL TABLES
-- ==============================

-- 1a. PROFILES TABLE
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null default '',
  avatar_url text,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

-- 1b. CONVERSATIONS TABLE
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1c. CONVERSATION PARTICIPANTS TABLE
create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_message_id uuid,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- 1d. MESSAGES TABLE
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  message_type text not null default 'text',
  media_url text,
  thumbnail_url text,
  status text not null default 'sent',
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ==============================
-- STEP 2: ENABLE RLS ON ALL TABLES
-- ==============================

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

-- ==============================
-- STEP 3: HELPER FUNCTION (prevents recursive RLS)
-- ==============================

create or replace function public.is_conversation_member(conv_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = conv_id and user_id = auth.uid()
  );
$$;

-- ==============================
-- STEP 4: RLS POLICIES (all tables exist now)
-- ==============================

-- Profiles policies
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Conversations policies
create policy "Users can view their own conversations"
  on public.conversations for select
  to authenticated
  using (public.is_conversation_member(id));

create policy "Authenticated users can create conversations"
  on public.conversations for insert
  to authenticated
  with check (true);

create policy "Participants can update conversation"
  on public.conversations for update
  to authenticated
  using (public.is_conversation_member(id));

-- Conversation participants policies
create policy "Users can view participants of their conversations"
  on public.conversation_participants for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

create policy "Authenticated users can add participants"
  on public.conversation_participants for insert
  to authenticated
  with check (true);

-- Messages policies
create policy "Users can view messages in their conversations"
  on public.messages for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

create policy "Users can send messages in their conversations"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

create policy "Participants can update message status"
  on public.messages for update
  to authenticated
  using (public.is_conversation_member(conversation_id))
  with check (public.is_conversation_member(conversation_id));

-- Conversation participants update policy (read position)
create policy "Users can update their own read position"
  on public.conversation_participants for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ==============================
-- STEP 5: INDEXES
-- ==============================

create index if not exists idx_messages_conversation_id on public.messages(conversation_id, created_at desc);
create index if not exists idx_conversation_participants_user_id on public.conversation_participants(user_id);
create index if not exists idx_profiles_username on public.profiles(username);

-- 6. FUNCTION + TRIGGER: Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 7. FUNCTION + TRIGGER: Update conversations.updated_at on new message
create or replace function public.handle_new_message()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists on_new_message on public.messages;
create trigger on_new_message
  after insert on public.messages
  for each row execute function public.handle_new_message();

-- 8. STORAGE BUCKETS
-- Note: Run these lines separately if they fail in a batch
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public) values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

drop policy if exists "Anyone can view avatars" on storage.objects;
create policy "Anyone can view avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Authenticated users can upload avatars" on storage.objects;
create policy "Authenticated users can upload avatars"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update their own avatars" on storage.objects;
create policy "Users can update their own avatars"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their own avatars" on storage.objects;
create policy "Users can delete their own avatars"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Chat media storage policies
drop policy if exists "Anyone can view chat media" on storage.objects;
create policy "Anyone can view chat media"
  on storage.objects for select
  using (bucket_id = 'chat-media');

drop policy if exists "Authenticated users can upload chat media" on storage.objects;
create policy "Authenticated users can upload chat media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'chat-media');

drop policy if exists "Users can delete their own chat media" on storage.objects;
create policy "Users can delete their own chat media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- 9. ENABLE REALTIME on messages table
-- Go to Supabase Dashboard → Database → Replication and enable the "messages" table
-- Or run:
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.profiles;

-- ============================================================
-- DONE! Your database is ready for the Arvs Messenger app.
-- ============================================================
