import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? '';
const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') ?? '';
const FIREBASE_CLIENT_EMAIL = Deno.env.get('FIREBASE_CLIENT_EMAIL') ?? '';
const FIREBASE_PRIVATE_KEY = (Deno.env.get('FIREBASE_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n');

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function encodeBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createSignedJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const unsignedToken = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(JSON.stringify(payload))}`;

  const pkcs8 = FIREBASE_PRIVATE_KEY
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const keyBytes = Uint8Array.from(atob(pkcs8), (char) => char.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes.buffer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureString = Array.from(new Uint8Array(signature), (byte) => String.fromCharCode(byte)).join('');
  const encodedSignature = btoa(signatureString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  return `${unsignedToken}.${encodedSignature}`;
}

async function getFirebaseAccessToken(): Promise<string> {
  const assertion = await createSignedJwt();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Failed to obtain Firebase access token: ${JSON.stringify(data)}`);
  }

  return data.access_token as string;
}

function buildMessageBody(message: { message_type: string; content: string; media_name: string | null }): string {
  if (message.message_type === 'image') {
    return message.content?.trim() ? `Photo: ${message.content}` : 'Sent a photo';
  }

  if (message.message_type === 'video') {
    return message.content?.trim() ? `Video: ${message.content}` : 'Sent a video';
  }

  if (message.message_type === 'file') {
    if (message.media_name?.trim()) {
      return `File: ${message.media_name}`;
    }
    return message.content?.trim() ? `File: ${message.content}` : 'Sent a file';
  }

  return message.content?.trim() || 'New message';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Supabase environment variables are missing.' }, 500);
  }

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    return jsonResponse({ error: 'Firebase service account secrets are missing.' }, 500);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header.' }, 401);
    }

    const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await authedClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ error: 'Unauthorized.' }, 401);
    }

    const { messageId } = await req.json();
    if (!messageId || typeof messageId !== 'string') {
      return jsonResponse({ error: 'messageId is required.' }, 400);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: message, error: messageError } = await adminClient
      .from('messages')
      .select('id, conversation_id, sender_id, content, message_type, media_name')
      .eq('id', messageId)
      .single();

    if (messageError || !message) {
      return jsonResponse({ error: 'Message not found.' }, 404);
    }

    if (message.sender_id !== user.id) {
      return jsonResponse({ error: 'You can only notify for your own messages.' }, 403);
    }

    const [{ data: participants }, { data: senderProfile }] = await Promise.all([
      adminClient
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', message.conversation_id)
        .neq('user_id', user.id),
      adminClient
        .from('profiles')
        .select('display_name, username')
        .eq('id', user.id)
        .single(),
    ]);

    const recipientIds = participants?.map((item) => item.user_id) ?? [];
    if (recipientIds.length === 0) {
      return jsonResponse({ delivered: 0, skipped: 'No recipients found.' });
    }

    const { data: tokens } = await adminClient
      .from('push_tokens')
      .select('token, user_id')
      .in('user_id', recipientIds);

    if (!tokens?.length) {
      return jsonResponse({ delivered: 0, skipped: 'No registered recipient devices.' });
    }

    const accessToken = await getFirebaseAccessToken();
    const senderName = senderProfile?.display_name || senderProfile?.username || 'New message';
    const body = buildMessageBody(message);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`;

    const results = await Promise.all(tokens.map(async ({ token }) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title: senderName,
              body,
            },
            data: {
              conversationId: message.conversation_id,
              messageId: message.id,
              route: `/chat/${message.conversation_id}`,
              senderId: message.sender_id,
            },
            android: {
              priority: 'high',
              notification: {
                channelId: 'chat-messages',
                clickAction: 'OPEN_CHAT',
                tag: message.conversation_id,
                defaultSound: true,
              },
            },
          },
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        const payloadString = JSON.stringify(payload);
        if (payloadString.includes('UNREGISTERED') || payloadString.includes('registration-token-not-registered')) {
          await adminClient.from('push_tokens').delete().eq('token', token);
        }
        return { ok: false, token, payload };
      }

      return { ok: true, token, payload };
    }));

    const delivered = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => !item.ok);

    return jsonResponse({
      delivered,
      failed,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error.' }, 500);
  }
});
