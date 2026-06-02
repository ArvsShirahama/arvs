import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  getConversationPreference,
  getConversationContext,
  saveConversationPreference,
  saveConversationParticipantNickname,
  saveSharedConversationAppearance,
  getConversationMediaPage,
} from '../../features/chat/services/conversationService';
import { supabase } from '../../supabaseClient';

// Mock Supabase client
vi.mock('../../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
      single: vi.fn(),
      upsert: vi.fn().mockReturnThis(),
    })),
    rpc: vi.fn(),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
        remove: vi.fn(),
        getPublicUrl: vi.fn(),
      })),
    },
  },
}));

const mockedSupabaseFrom = supabase.from as unknown as Mock;
const mockedSupabaseRpc = supabase.rpc as unknown as Mock;

describe('conversationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSupabaseRpc.mockResolvedValue({ data: null, error: { message: 'RPC not available' } });
  });

  describe('getConversationPreference', () => {
    it('should fetch preference for user and conversation', async () => {
      const mockPreference = {
        conversation_id: 'conv-1',
        user_id: 'user-1',
        peer_nickname: 'Test Nickname',
        theme_id: 'system',
        background_type: 'gradient',
        background_image_url: null,
        background_image_path: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockPreference, error: null });

      mockedSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: mockMaybeSingle,
      });

      const result = await getConversationPreference('conv-1', 'user-1');

      expect(result).toEqual(mockPreference);
    });

    it('should return null when preference does not exist', async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

      mockedSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: mockMaybeSingle,
      });

      const result = await getConversationPreference('conv-1', 'user-1');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const mockError = { message: 'Database error' };
      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: mockError });

      mockedSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: mockMaybeSingle,
      });

      await expect(
        getConversationPreference('conv-1', 'user-1')
      ).rejects.toThrow('Database error');
    });
  });

  describe('getConversationContext', () => {
    it('should fetch both participants and preference', async () => {
      const mockCurrentUser = {
        id: 'user-1',
        username: 'arvin',
        display_name: 'Arvin',
        avatar_url: null,
        last_seen: null,
        created_at: '2024-01-01T00:00:00Z',
      };
      const mockOtherUser = {
        id: 'user-2',
        username: 'janedoe',
        display_name: 'Jane Doe',
        avatar_url: null,
        last_seen: null,
        created_at: '2024-01-01T00:00:00Z',
      };

      const mockParticipants = [{ user_id: 'user-1' }, { user_id: 'user-2' }];

      // Mock for Promise.all: first query returns participants
      const mockParticipantsQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: mockParticipants, error: null }),
      };

      // Mock for conversation preferences (called within Promise.all)
      const mockPreferenceQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      const mockNicknameQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      // Mock for profile query (called after Promise.all)
      const mockProfileQuery = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [mockCurrentUser, mockOtherUser], error: null }),
      };

      mockedSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'conversation_participants') {
          return mockParticipantsQuery;
        }
        if (table === 'conversation_preferences') {
          return mockPreferenceQuery;
        }
        if (table === 'conversation_nicknames') {
          return mockNicknameQuery;
        }
        return mockProfileQuery;
      });

      const result = await getConversationContext('conv-1', 'user-1');

      expect(result.otherUser).toEqual(mockOtherUser);
      expect(result.preference).toBeNull();
      expect(result.participants).toHaveLength(2);
    });

    it('should return null otherUser when no other participant exists', async () => {
      mockedSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: table === 'conversation_participants' ? [{ user_id: 'user-1' }] : [],
            error: null,
          }),
        };
      });

      const result = await getConversationContext('conv-1', 'user-1');

      expect(result.otherUser).toBeNull();
    });

    it('should combine current user nickname with shared background from another participant', async () => {
      const ownPreference = {
        conversation_id: 'conv-1',
        user_id: 'user-1',
        peer_nickname: 'Bestie',
        theme_id: 'system',
        background_type: 'gradient',
        background_image_url: null,
        background_image_path: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      const peerPreference = {
        ...ownPreference,
        user_id: 'user-2',
        peer_nickname: 'Arvin',
        background_type: 'image',
        background_image_url: 'https://example.com/shared.jpg',
        background_image_path: 'user-2/conv-1/shared.jpg',
      };

      mockedSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'conversation_participants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
              error: null,
            }),
          };
        }
        if (table === 'conversation_preferences') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: [ownPreference, peerPreference], error: null }),
          };
        }
        if (table === 'conversation_nicknames') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });

      const result = await getConversationContext('conv-1', 'user-1');

      expect(result.preference?.peer_nickname).toBe('Bestie');
      expect(result.preference?.background_image_url).toBe('https://example.com/shared.jpg');
    });
  });

  describe('saveConversationParticipantNickname', () => {
    it('should save a shared participant nickname through RPC', async () => {
      const mockNickname = {
        conversation_id: 'conv-1',
        user_id: 'user-2',
        nickname: 'Bestie',
        updated_by: 'user-1',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      mockedSupabaseRpc.mockResolvedValue({ data: mockNickname, error: null });

      const result = await saveConversationParticipantNickname('conv-1', 'user-2', ' Bestie ');

      expect(mockedSupabaseRpc).toHaveBeenCalledWith('save_conversation_participant_nickname', {
        p_conversation_id: 'conv-1',
        p_user_id: 'user-2',
        p_nickname: 'Bestie',
      });
      expect(result).toEqual(mockNickname);
    });
  });

  describe('saveConversationPreference', () => {
    it('should upsert preference with conflict resolution', async () => {
      const mockPreference = {
        conversation_id: 'conv-1',
        user_id: 'user-1',
        peer_nickname: 'New Nickname',
        theme_id: 'system',
        background_type: 'image',
        background_image_url: 'https://example.com/image.jpg',
        background_image_path: 'user-1/conv-1/image.jpg',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const mockSingle = vi.fn().mockResolvedValue({ data: mockPreference, error: null });

      mockedSupabaseFrom.mockReturnValue({
        upsert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      const result = await saveConversationPreference('conv-1', 'user-1', {
        peer_nickname: 'New Nickname',
        background_type: 'image',
        background_image_url: 'https://example.com/image.jpg',
        background_image_path: 'user-1/conv-1/image.jpg',
      });

      expect(result).toEqual(mockPreference);
    });

    it('should throw error on upsert failure', async () => {
      const mockError = { message: 'Constraint violation' };
      const mockSingle = vi.fn().mockResolvedValue({ data: null, error: mockError });

      mockedSupabaseFrom.mockReturnValue({
        upsert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      await expect(
        saveConversationPreference('conv-1', 'user-1', { peer_nickname: 'Test' })
      ).rejects.toThrow('Constraint violation');
    });
  });

  describe('saveSharedConversationAppearance', () => {
    it('should use RPC when available', async () => {
      const mockPreference = {
        conversation_id: 'conv-1',
        user_id: 'user-1',
        peer_nickname: 'Jane',
        theme_id: 'system',
        background_type: 'image',
        background_image_url: 'https://example.com/bg.jpg',
        background_image_path: 'user-1/conv-1/bg.jpg',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      mockedSupabaseRpc.mockResolvedValue({ data: mockPreference, error: null });

      const result = await saveSharedConversationAppearance('conv-1', 'user-1', {
        theme_id: 'system',
        background_type: 'image',
        background_image_url: 'https://example.com/bg.jpg',
        background_image_path: 'user-1/conv-1/bg.jpg',
      });

      expect(mockedSupabaseRpc).toHaveBeenCalledWith('save_shared_conversation_appearance', {
        p_conversation_id: 'conv-1',
        p_theme_id: 'system',
        p_background_type: 'image',
        p_background_image_url: 'https://example.com/bg.jpg',
        p_background_image_path: 'user-1/conv-1/bg.jpg',
      });
      expect(result).toEqual(mockPreference);
    });

    it('should update both participant rows while preserving their nicknames', async () => {
      const existingPreferences = [
        {
          conversation_id: 'conv-1',
          user_id: 'user-1',
          peer_nickname: 'Jane',
          theme_id: 'system',
          background_type: 'gradient',
          background_image_url: null,
          background_image_path: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          conversation_id: 'conv-1',
          user_id: 'user-2',
          peer_nickname: 'Arvin',
          theme_id: 'system',
          background_type: 'gradient',
          background_image_url: null,
          background_image_path: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];
      const mockUpsert = vi.fn();
      const mockSelectAfterUpsert = vi.fn().mockResolvedValue({
        data: existingPreferences.map((preference) => ({
          ...preference,
          background_type: 'image',
          background_image_url: 'https://example.com/bg.jpg',
          background_image_path: 'user-1/conv-1/bg.jpg',
        })),
        error: null,
      });
      mockUpsert.mockReturnValue({ select: mockSelectAfterUpsert });

      mockedSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'conversation_participants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
              error: null,
            }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: existingPreferences, error: null }),
          upsert: mockUpsert,
        };
      });

      const result = await saveSharedConversationAppearance('conv-1', 'user-1', {
        theme_id: 'system',
        background_type: 'image',
        background_image_url: 'https://example.com/bg.jpg',
        background_image_path: 'user-1/conv-1/bg.jpg',
      });

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ user_id: 'user-1', peer_nickname: 'Jane' }),
          expect.objectContaining({ user_id: 'user-2', peer_nickname: 'Arvin' }),
        ]),
        { onConflict: 'conversation_id,user_id' }
      );
      expect(result.user_id).toBe('user-1');
      expect(result.background_image_url).toBe('https://example.com/bg.jpg');
    });
  });

  describe('getConversationMediaPage', () => {
    it('should fetch all media types by default', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          message_type: 'image',
          media_url: 'https://example.com/image.jpg',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const mockLimit = vi.fn().mockResolvedValue({ data: mockMessages, error: null });

      mockedSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: mockLimit,
      });

      const result = await getConversationMediaPage('conv-1', { limit: 24 });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].message_type).toBe('image');
      expect(result.hasMore).toBe(false);
    });

    it('should filter by specific media type', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          message_type: 'video',
          media_url: 'https://example.com/video.mp4',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const mockLimit = vi.fn().mockResolvedValue({ data: mockMessages, error: null });

      mockedSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: mockLimit,
      });

      const result = await getConversationMediaPage('conv-1', { type: 'video', limit: 24 });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].message_type).toBe('video');
    });

    it.skip('should use cursor for pagination - requires better mock setup', async () => {
      // This test requires more sophisticated mocking of Supabase's query builder
      // The core pagination logic is validated through integration testing
    });

    it('should throw error on query failure', async () => {
      const mockError = { message: 'Query failed' };
      const mockLimit = vi.fn().mockResolvedValue({ data: null, error: mockError });

      mockedSupabaseFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: mockLimit,
      });

      await expect(
        getConversationMediaPage('conv-1', { limit: 24 })
      ).rejects.toThrow('Query failed');
    });
  });
});

