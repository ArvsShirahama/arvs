import type { ConversationPreference, Profile } from '../types/database';

export interface ConversationThemeDefinition {
  id: string;
  name: string;
  gradient: string;
  bubbleMine: string;
  bubbleTheirs: string;
  bubbleTheirsText: string;
  toolbarSurface: string;
  inputSurface: string;
  inputBorder: string;
  overlay: string;
}

export const DEFAULT_CONVERSATION_THEME_ID = 'system';

const SYSTEM_CONVERSATION_THEME: ConversationThemeDefinition = {
  id: 'system',
  name: 'System',
  gradient: 'var(--conversation-page-gradient)',
  bubbleMine: 'var(--conversation-bubble-mine-color)',
  bubbleTheirs: 'var(--conversation-bubble-theirs-surface)',
  bubbleTheirsText: 'var(--conversation-bubble-theirs-text-color)',
  toolbarSurface: 'var(--conversation-toolbar-surface-color)',
  inputSurface: 'var(--conversation-input-surface-color)',
  inputBorder: 'var(--conversation-input-border-color)',
  overlay: 'var(--conversation-image-overlay)',
};

export function getConversationTheme(themeId?: string | null): ConversationThemeDefinition {
  void themeId;
  return SYSTEM_CONVERSATION_THEME;
}

export function getConversationDisplayName(
  otherUser: Profile | null,
  preference: ConversationPreference | null
): string {
  const nickname = preference?.peer_nickname?.trim();
  if (nickname) return nickname;
  return otherUser?.display_name || otherUser?.username || 'Chat';
}

export function formatFileSize(bytes: number | null): string {
  if (!bytes || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
