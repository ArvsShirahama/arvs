import { supabase } from '../../../supabaseClient';

export interface FollowState {
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
}

export async function followUser(currentUserId: string, targetUserId: string): Promise<void> {
  if (currentUserId === targetUserId) {
    throw new Error('You cannot follow yourself.');
  }

  const { error } = await supabase.from('follows').upsert(
    {
      follower_id: currentUserId,
      following_id: targetUserId,
    },
    { onConflict: 'follower_id,following_id' }
  );

  if (error) {
    throw error;
  }
}

export async function unfollowUser(currentUserId: string, targetUserId: string): Promise<void> {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', currentUserId)
    .eq('following_id', targetUserId);

  if (error) {
    throw error;
  }
}

export async function getFollowState(currentUserId: string, targetUserId: string): Promise<FollowState> {
  const [followersResult, followingResult, followResult] = await Promise.all([
    supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', targetUserId),
    supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', targetUserId),
    currentUserId === targetUserId
      ? Promise.resolve({ data: null, error: null })
      : supabase
        .from('follows')
        .select('follower_id')
        .eq('follower_id', currentUserId)
        .eq('following_id', targetUserId)
        .maybeSingle(),
  ]);

  if (followersResult.error) throw followersResult.error;
  if (followingResult.error) throw followingResult.error;
  if (followResult.error) throw followResult.error;

  return {
    followerCount: followersResult.count ?? 0,
    followingCount: followingResult.count ?? 0,
    isFollowing: Boolean(followResult.data),
  };
}
