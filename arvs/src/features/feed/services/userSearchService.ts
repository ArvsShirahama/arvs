import { supabase } from '../../../supabaseClient';
import type { Profile } from '../../../types/database';

const USER_SEARCH_LIMIT = 20;

function normalizeSearchTerm(query: string): string {
  return query.trim().replace(/[,%]/g, '');
}

export async function searchUsers(query: string, currentUserId: string): Promise<Profile[]> {
  const term = normalizeSearchTerm(query);
  if (term.length < 2) {
    return [];
  }

  const searchTerm = `%${term}%`;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .neq('id', currentUserId)
    .or(`username.ilike.${searchTerm},display_name.ilike.${searchTerm}`)
    .order('username', { ascending: true })
    .limit(USER_SEARCH_LIMIT);

  if (error) {
    throw error;
  }

  return (data as Profile[] | null) ?? [];
}
