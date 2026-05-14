# send-chat-push

Supabase Edge Function for Firebase Cloud Messaging delivery.

## Required secrets

Set these in your Supabase project before deploying:

- `SERVICE_ROLE_KEY` (your Supabase service_role key)
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided automatically by Supabase Functions.

## Deploy

```bash
supabase functions deploy send-chat-push
```

## Client behavior

The mobile app invokes this function after a message insert so receivers get FCM notifications while the app is in foreground, background, or terminated.

## Recommended hardening

For server-triggered reliability, add a database webhook on `public.messages` INSERT events that targets this function after deployment.
