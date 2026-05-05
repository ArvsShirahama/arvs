import { useState } from 'react';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonSearchbar,
  IonList,
  IonItem,
  IonLabel,
  IonButton,
  IonButtons,
  IonSpinner,
  IonText,
} from '@ionic/react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../supabaseClient';
import type { Profile } from '../types/database';
import Avatar from './Avatar';
import './NewChatModal.css';

interface NewChatModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  onConversationCreated: (conversationId: string) => void;
}

export default function NewChatModal({ isOpen, onDismiss, onConversationCreated }: NewChatModalProps) {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleSearch = async (value: string) => {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }

    setSearching(true);
    const searchTerm = `%${value.trim()}%`;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .neq('id', user?.id)
      .or(`username.ilike.${searchTerm},display_name.ilike.${searchTerm}`)
      .limit(20);

    setResults((data as Profile[]) ?? []);
    setSearching(false);
  };

  const startConversation = async (otherUser: Profile) => {
    if (!user || creating) return;
    setCreating(true);

    // Check if a conversation already exists between these two users
    const { data: myConvos } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', user.id);

    const { data: theirConvos } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', otherUser.id);

    const myIds = new Set(myConvos?.map((r) => r.conversation_id));
    const existingId = theirConvos?.find((r) => myIds.has(r.conversation_id))?.conversation_id;

    if (existingId) {
      setCreating(false);
      setQuery('');
      setResults([]);
      onConversationCreated(existingId);
      return;
    }

    // Create new conversation (generate ID client-side to avoid RLS select issue)
    const conversationId = crypto.randomUUID();
    const { error: convoError } = await supabase
      .from('conversations')
      .insert({ id: conversationId });

    if (convoError) {
      setCreating(false);
      return;
    }

    await supabase.from('conversation_participants').insert([
      { conversation_id: conversationId, user_id: user.id },
      { conversation_id: conversationId, user_id: otherUser.id },
    ]);

    setCreating(false);
    setQuery('');
    setResults([]);
    onConversationCreated(conversationId);
  };

  const handleDismiss = () => {
    setQuery('');
    setResults([]);
    onDismiss();
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={handleDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={handleDismiss}>Cancel</IonButton>
          </IonButtons>
          <IonTitle>New Chat</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="new-chat-modal">
        <IonSearchbar
          value={query}
          onIonInput={(e) => handleSearch(e.detail.value ?? '')}
          placeholder="Search by username or name"
          debounce={300}
          className="new-chat-search"
        />

        {searching && (
          <div className="new-chat-spinner">
            <IonSpinner name="crescent" />
          </div>
        )}

        {!searching && query.trim().length >= 2 && results.length === 0 && (
          <div className="new-chat-empty">
            <IonText color="medium"><p>No users found</p></IonText>
          </div>
        )}

        <IonList lines="none" className="new-chat-list">
          {results.map((profile) => (
            <IonItem
              key={profile.id}
              button
              onClick={() => startConversation(profile)}
              disabled={creating}
              className="new-chat-item"
            >
              <Avatar
                src={profile.avatar_url}
                name={profile.display_name || profile.username}
                size="medium"
              />
              <IonLabel className="new-chat-item-label">
                <h2>{profile.display_name}</h2>
                <p>@{profile.username}</p>
              </IonLabel>
            </IonItem>
          ))}
        </IonList>

        {creating && (
          <div className="new-chat-spinner">
            <IonSpinner name="crescent" />
          </div>
        )}
      </IonContent>
    </IonModal>
  );
}
