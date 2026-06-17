  -- =============================================================================
  -- Social Profile Fields Migration
  -- Run after the base Supabase setup.
  -- =============================================================================

  ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '' NOT NULL;

  ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status_message TEXT DEFAULT '' NOT NULL;

  ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

  UPDATE public.profiles
  SET
    bio = COALESCE(bio, ''),
    status_message = COALESCE(status_message, ''),
    updated_at = COALESCE(updated_at, created_at, now());

  CREATE OR REPLACE FUNCTION public.set_profiles_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
  CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_profiles_updated_at();
