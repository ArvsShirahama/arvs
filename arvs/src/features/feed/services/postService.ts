import { supabase } from '../../../supabaseClient';
import type {
  CreatePostMediaInput,
  FeedPageCursor,
  Post,
  PostAspectRatio,
  PostLike,
  PostMedia,
  PostWithAuthor,
  Profile,
} from '../../../types/database';

const DEFAULT_FEED_PAGE_SIZE = 12;
const POST_MEDIA_BUCKET = 'post-media';
const MAX_POST_MEDIA_ITEMS = 10;

function createPostMediaPath(userId: string, fileName: string, index: number): string {
  const safeName = fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return `${userId}/${Date.now()}-${index}-${safeName}`;
}

function mapLikesByPost(rows: PostLike[] | null): Record<string, number> {
  return (rows ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.post_id] = (acc[row.post_id] ?? 0) + 1;
    return acc;
  }, {});
}

async function enrichPosts(posts: Post[], currentUserId: string): Promise<PostWithAuthor[]> {
  if (posts.length === 0) {
    return [];
  }

  const postIds = posts.map((post) => post.id);
  const authorIds = Array.from(new Set(posts.map((post) => post.user_id)));
  const [profilesResult, mediaResult, likesResult, myLikesResult, followsResult] = await Promise.all([
    supabase.from('profiles').select('*').in('id', authorIds),
    supabase
      .from('post_media')
      .select('id,post_id,media_url,media_path,media_type,position,width,height,created_at')
      .in('post_id', postIds)
      .order('position', { ascending: true }),
    supabase.from('post_likes').select('id,post_id,user_id,created_at').in('post_id', postIds),
    supabase
      .from('post_likes')
      .select('id,post_id,user_id,created_at')
      .in('post_id', postIds)
      .eq('user_id', currentUserId),
    supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', currentUserId)
      .in('following_id', authorIds),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (mediaResult.error) throw mediaResult.error;
  if (likesResult.error) throw likesResult.error;
  if (myLikesResult.error) throw myLikesResult.error;
  if (followsResult.error) throw followsResult.error;

  const profilesById = new Map(((profilesResult.data as Profile[] | null) ?? []).map((profile) => [profile.id, profile]));
  const mediaByPostId = ((mediaResult.data as PostMedia[] | null) ?? []).reduce<Record<string, PostMedia[]>>((acc, item) => {
    if (!acc[item.post_id]) {
      acc[item.post_id] = [];
    }
    acc[item.post_id].push(item);
    return acc;
  }, {});
  const likeCounts = mapLikesByPost(likesResult.data as PostLike[] | null);
  const myLikedPostIds = new Set(((myLikesResult.data as PostLike[] | null) ?? []).map((like) => like.post_id));
  const followingIds = new Set(((followsResult.data as { following_id: string }[] | null) ?? []).map((row) => row.following_id));

  return posts
    .map((post) => {
      const author = profilesById.get(post.user_id);
      if (!author) return null;

      return {
        ...post,
        aspect_ratio: post.aspect_ratio ?? 'square',
        author,
        media: mediaByPostId[post.id] ?? [{
          id: `${post.id}-legacy-media`,
          post_id: post.id,
          media_url: post.media_url,
          media_path: post.media_path,
          media_type: post.media_type,
          position: 0,
          width: null,
          height: null,
          created_at: post.created_at,
        }],
        like_count: likeCounts[post.id] ?? 0,
        liked_by_me: myLikedPostIds.has(post.id),
        is_following_author: followingIds.has(post.user_id),
      };
    })
    .filter((post): post is PostWithAuthor => post !== null);
}

export async function getFeedPage(
  currentUserId: string,
  cursor: FeedPageCursor = { beforeCreatedAt: null, limit: DEFAULT_FEED_PAGE_SIZE }
): Promise<{ posts: PostWithAuthor[]; oldestCursor: string | null; hasMore: boolean }> {
  let query = supabase
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(cursor.limit);

  if (cursor.beforeCreatedAt) {
    query = query.lt('created_at', cursor.beforeCreatedAt);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data as Post[] | null) ?? [];
  const posts = await enrichPosts(rows, currentUserId);

  return {
    posts,
    oldestCursor: rows.length > 0 ? rows[rows.length - 1].created_at : cursor.beforeCreatedAt,
    hasMore: rows.length === cursor.limit,
  };
}

export async function getUserPosts(userId: string, currentUserId: string, limit = 24): Promise<PostWithAuthor[]> {
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return enrichPosts((data as Post[] | null) ?? [], currentUserId);
}

export async function createPost(args: {
  userId: string;
  files: CreatePostMediaInput[];
  aspectRatio: PostAspectRatio;
  caption: string;
}): Promise<Post> {
  if (args.files.length === 0) {
    throw new Error('Choose at least one photo or video.');
  }
  if (args.files.length > MAX_POST_MEDIA_ITEMS) {
    throw new Error(`Choose up to ${MAX_POST_MEDIA_ITEMS} photos or videos.`);
  }

  const uploadedMedia: Array<CreatePostMediaInput & {
    mediaUrl: string;
    mediaPath: string;
    position: number;
  }> = [];

  try {
    for (const [index, media] of args.files.entries()) {
      const filePath = createPostMediaPath(args.userId, media.file.name, index);
      const { error: uploadError } = await supabase.storage
        .from(POST_MEDIA_BUCKET)
        .upload(filePath, media.file, {
          contentType: media.file.type || undefined,
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: urlData } = supabase.storage.from(POST_MEDIA_BUCKET).getPublicUrl(filePath);
      uploadedMedia.push({
        ...media,
        mediaUrl: urlData.publicUrl,
        mediaPath: filePath,
        position: index,
      });
    }

    const firstMedia = uploadedMedia[0];
    const { data, error } = await supabase
      .from('posts')
      .insert({
        user_id: args.userId,
        media_url: firstMedia.mediaUrl,
        media_path: firstMedia.mediaPath,
        media_type: firstMedia.mediaType,
        aspect_ratio: args.aspectRatio,
        caption: args.caption.trim(),
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    const post = data as Post;
    const { error: mediaInsertError } = await supabase.from('post_media').insert(uploadedMedia.map((media) => ({
      post_id: post.id,
      media_url: media.mediaUrl,
      media_path: media.mediaPath,
      media_type: media.mediaType,
      position: media.position,
      width: media.width,
      height: media.height,
    })));

    if (mediaInsertError) {
      await supabase.from('posts').delete().eq('id', post.id);
      throw mediaInsertError;
    }

    return post;
  } catch (error) {
    const paths = uploadedMedia.map((media) => media.mediaPath);
    if (paths.length > 0) {
      await supabase.storage.from(POST_MEDIA_BUCKET).remove(paths);
    }
    throw error;
  }
}

export async function deletePost(post: Pick<Post, 'id' | 'media_path'> & { media?: PostMedia[] }): Promise<void> {
  const { error } = await supabase.from('posts').delete().eq('id', post.id);
  if (error) throw error;

  const paths = Array.from(new Set([
    post.media_path,
    ...(post.media ?? []).map((item) => item.media_path),
  ].filter(Boolean)));

  if (paths.length > 0) {
    await supabase.storage.from(POST_MEDIA_BUCKET).remove(paths);
  }
}

export async function togglePostLike(post: PostWithAuthor, currentUserId: string): Promise<boolean> {
  if (post.liked_by_me) {
    const { error } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', post.id)
      .eq('user_id', currentUserId);
    if (error) throw error;
    return false;
  }

  const { error } = await supabase.from('post_likes').insert({
    post_id: post.id,
    user_id: currentUserId,
  });

  if (error) throw error;
  return true;
}

export async function getPostById(postId: string, currentUserId: string): Promise<PostWithAuthor | null> {
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('id', postId)
    .maybeSingle();

  if (error) throw error;
  const rows = data ? await enrichPosts([data as Post], currentUserId) : [];
  return rows[0] ?? null;
}
