import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * send-call-push
 *
 * Sends a high-priority "incoming call" push notification to the other
 * participant(s) of a conversation so their device rings / wakes even when the
 * app is backgrounded or closed.
 *
 * Request body: { conversationId: string, callId: string, video?: boolean }
 *
 * Mirrors send-chat-push for auth + FCM access-token handling, but emits a
 * call-specific data payload (type: "incoming_call") on the "calls" channel.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
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
      console.error('[send-call-push] Missing authorization header.');
      return jsonResponse({ error: 'Missing authorization header.' }, 401);
    }

    const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await authedClient.auth.getUser();

    if (authError || !user) {
      console.error('[send-call-push] Auth error or user not found:', authError);
      return jsonResponse({ error: 'Unauthorized.' }, 401);
    }

    const { conversationId, callId, video } = await req.json();
    console.log(`[send-call-push] Request from ${user.id} for conversation ${conversationId}, call ${callId}`);

    if (!conversationId || typeof conversationId !== 'string') {
      return jsonResponse({ error: 'conversationId is required.' }, 400);
    }
    if (!callId || typeof callId !== 'string') {
      return jsonResponse({ error: 'callId is required.' }, 400);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Verify the caller is actually a participant of this conversation
    const { data: callerMembership, error: membershipError } = await adminClient
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (membershipError || !callerMembership) {
      console.error('[send-call-push] Caller is not a participant of the conversation.');
      return jsonResponse({ error: 'You are not a participant in this conversation.' }, 403);
    }

    const [{ data: participants }, { data: callerProfile }] = await Promise.all([
      adminClient
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', user.id),
      adminClient
        .from('profiles')
        .select('display_name, username, avatar_url')
        .eq('id', user.id)
        .single(),
    ]);

    const recipientIds = participants?.map((item) => item.user_id) ?? [];
    if (recipientIds.length === 0) {
      console.log('[send-call-push] No recipients found.');
      return jsonResponse({ delivered: 0, skipped: 'No recipients found.' });
    }

    const { data: tokens } = await adminClient
      .from('push_tokens')
      .select('token, user_id')
      .in('user_id', recipientIds);

    if (!tokens?.length) {
      console.log('[send-call-push] No registered recipient devices.');
      return jsonResponse({ delivered: 0, skipped: 'No registered recipient devices.' });
    }

    const accessToken = await getFirebaseAccessToken();
    const callerName = callerProfile?.display_name || callerProfile?.username || 'Someone';
    const isVideo = video !== false; // default to video call
    const body = isVideo ? 'Incoming video call' : 'Incoming voice call';
    const endpoint = `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`;

    const results = await Promise.all(tokens.map(async ({ token, user_id }) => {
      console.log(`[send-call-push] Sending call push to user ${user_id} token: ${token.substring(0, 15)}...`);
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
              title: callerName,
              body,
            },
            data: {
              type: 'incoming_call',
              conversationId,
              callId,
              callerId: user.id,
              callerName,
              callerAvatarUrl: callerProfile?.avatar_url ?? '',
              video: String(isVideo),
              route: `/chat/${conversationId}`,
            },
            android: {
              // Highest priority so the device wakes for a ringing call
              priority: 'high',
              ttl: '30s',
              notification: {
                channelId: 'incoming-calls',
                tag: `call-${conversationId}`,
                defaultSound: true,
                notificationPriority: 'PRIORITY_MAX',
                visibility: 'PUBLIC',
              },
            },
          },
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        console.error(`[send-call-push] FCM error for token ${token.substring(0, 15)}...`, payload);
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

    console.log(`[send-call-push] Done. Delivered: ${delivered}, Failed: ${failed.length}`);
    return jsonResponse({ delivered, failed });
  } catch (error) {
    console.error('[send-call-push] Unexpected exception:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error.' }, 500);
  }
});
