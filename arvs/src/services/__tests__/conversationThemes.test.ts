import { describe, it, expect } from 'vitest';
import { getConversationDisplayName, formatFileSize, getConversationTheme } from '../conversationThemes';
import type { Profile, ConversationPreference } from '../../types/database';

describe('conversationThemes', () => {
  describe('getConversationDisplayName', () => {
    it('should return nickname when preference has peer_nickname', () => {
      const otherUser: Profile = {
        id: 'user-1',
        username: 'johndoe',
        display_name: 'John Doe',
        avatar_url: null,
        last_seen: null,
        created_at: '2024-01-01T00:00:00Z',
      };
      const preference: ConversationPreference = {
        conversation_id: 'conv-1',
        user_id: 'user-2',
        peer_nickname: 'My Buddy John',
        theme_id: 'system',
        background_type: 'gradient',
        background_image_url: null,
        background_image_path: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      expect(getConversationDisplayName(otherUser, preference)).toBe('My Buddy John');
    });

    it('should return display_name when no nickname is set', () => {
      const otherUser: Profile = {
        id: 'user-1',
        username: 'johndoe',
        display_name: 'John Doe',
        avatar_url: null,
        last_seen: null,
        created_at: '2024-01-01T00:00:00Z',
      };

      expect(getConversationDisplayName(otherUser, null)).toBe('John Doe');
    });

    it('should return username when display_name is empty', () => {
      const otherUser: Profile = {
        id: 'user-1',
        username: 'johndoe',
        display_name: '',
        avatar_url: null,
        last_seen: null,
        created_at: '2024-01-01T00:00:00Z',
      };

      expect(getConversationDisplayName(otherUser, null)).toBe('johndoe');
    });

    it('should return "Chat" when otherUser is null', () => {
      expect(getConversationDisplayName(null, null)).toBe('Chat');
    });

    it('should trim whitespace from nickname', () => {
      const otherUser: Profile = {
        id: 'user-1',
        username: 'johndoe',
        display_name: 'John Doe',
        avatar_url: null,
        last_seen: null,
        created_at: '2024-01-01T00:00:00Z',
      };
      const preference: ConversationPreference = {
        conversation_id: 'conv-1',
        user_id: 'user-2',
        peer_nickname: '  ',
        theme_id: 'system',
        background_type: 'gradient',
        background_image_url: null,
        background_image_path: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      expect(getConversationDisplayName(otherUser, preference)).toBe('John Doe');
    });
  });

  describe('formatFileSize', () => {
    it('should return empty string for null or NaN', () => {
      expect(formatFileSize(null)).toBe('');
      expect(formatFileSize(NaN)).toBe('');
    });

    it('should format bytes correctly', () => {
      expect(formatFileSize(500)).toBe('500 B');
      expect(formatFileSize(1023)).toBe('1023 B');
    });

    it('should format kilobytes correctly', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(10240)).toBe('10.0 KB');
    });

    it('should format megabytes correctly', () => {
      expect(formatFileSize(1048576)).toBe('1.0 MB');
      expect(formatFileSize(1572864)).toBe('1.5 MB');
      expect(formatFileSize(10485760)).toBe('10.0 MB');
    });

    it('should handle edge cases', () => {
      expect(formatFileSize(0)).toBe('');
      expect(formatFileSize(1023.5)).toBe('1023.5 B');
    });
  });

  describe('getConversationTheme', () => {
    it('should return system theme regardless of themeId', () => {
      const theme1 = getConversationTheme('sunrise');
      const theme2 = getConversationTheme('ocean');
      const theme3 = getConversationTheme(null);
      const theme4 = getConversationTheme(undefined);

      expect(theme1.id).toBe('system');
      expect(theme2.id).toBe('system');
      expect(theme3.id).toBe('system');
      expect(theme4.id).toBe('system');
    });

    it('should return theme with CSS variable values', () => {
      const theme = getConversationTheme('any');

      expect(theme.gradient).toContain('var(');
      expect(theme.bubbleMine).toContain('var(');
      expect(theme.bubbleTheirs).toContain('var(');
      expect(theme.toolbarSurface).toContain('var(');
      expect(theme.inputSurface).toContain('var(');
      expect(theme.inputBorder).toContain('var(');
    });
  });
});
