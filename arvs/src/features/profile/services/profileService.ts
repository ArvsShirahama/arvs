import { supabase } from '../../../supabaseClient';
import type { Profile } from '../../../types/database';

export interface ProfileDetailsInput {
  displayName: string;
  username: string;
  bio: string;
  statusMessage: string;
  avatarUrl?: string | null;
}

export interface ProfileSocialUser {
  profile: Profile;
  isFollowing: boolean;
}

export async function updateProfileDetails(userId: string, input: ProfileDetailsInput): Promise<Profile> {
  const updates: Record<string, string | null> = {
    display_name: input.displayName.trim(),
    username: input.username.trim(),
    bio: input.bio.trim(),
    status_message: input.statusMessage.trim(),
  };

  if (input.avatarUrl !== undefined) {
    updates.avatar_url = input.avatarUrl;
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data as Profile;
}

async function getProfilesByIds(ids: string[]): Promise<Profile[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('id', ids);

  if (error) {
    throw error;
  }

  const profiles = (data as Profile[] | null) ?? [];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  return ids.map((id) => profileMap.get(id)).filter((profile): profile is Profile => Boolean(profile));
}

async function markFollowing(currentUserId: string, profiles: Profile[]): Promise<ProfileSocialUser[]> {
  if (profiles.length === 0) return [];

  const profileIds = profiles.map((profile) => profile.id);
  const { data, error } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', currentUserId)
    .in('following_id', profileIds);

  if (error) {
    throw error;
  }

  const followingIds = new Set(((data ?? []) as { following_id: string }[]).map((row) => row.following_id));
  return profiles.map((profile) => ({
    profile,
    isFollowing: followingIds.has(profile.id),
  }));
}

export async function getFollowers(userId: string, currentUserId: string): Promise<ProfileSocialUser[]> {
  const { data, error } = await supabase
    .from('follows')
    .select('follower_id,created_at')
    .eq('following_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    throw error;
  }

  const followerIds = ((data ?? []) as { follower_id: string }[]).map((row) => row.follower_id);
  const profiles = await getProfilesByIds(followerIds);
  return markFollowing(currentUserId, profiles);
}

export async function getFollowing(userId: string, currentUserId: string): Promise<ProfileSocialUser[]> {
  const { data, error } = await supabase
    .from('follows')
    .select('following_id,created_at')
    .eq('follower_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    throw error;
  }

  const followingIds = ((data ?? []) as { following_id: string }[]).map((row) => row.following_id);
  const profiles = await getProfilesByIds(followingIds);
  return markFollowing(currentUserId, profiles);
}
