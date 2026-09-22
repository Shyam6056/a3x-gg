-- Movement CARE persistence: commitments, round reports, draft debriefs.
-- Run AFTER 00_bootstrap_demo_backend.sql. Idempotent.
-- Enable Authentication > Sign In / Providers > "Allow anonymous sign-ins" in Supabase.

CREATE TABLE IF NOT EXISTS public.care_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  operator_name text,
  day date NOT NULL,
  role text NOT NULL,
  goal text NOT NULL,
  commit_count integer NOT NULL DEFAULT 0,
  support_needed text NOT NULL DEFAULT '',
  closing_property_ids text[] NOT NULL DEFAULT '{}',
  committed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

CREATE TABLE IF NOT EXISTS public.care_round_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  operator_name text,
  day date NOT NULL,
  round text NOT NULL,
  role text NOT NULL,
  goal text NOT NULL,
  actual integer NOT NULL DEFAULT 0,
  committed integer NOT NULL DEFAULT 0,
  moved text NOT NULL DEFAULT '',
  stuck text NOT NULL DEFAULT '',
  need text NOT NULL DEFAULT '',
  reported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.care_debriefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  operator_name text,
  day date NOT NULL,
  ulid text NOT NULL,
  customer_name text NOT NULL DEFAULT '',
  draft_code text NOT NULL DEFAULT '',
  goal text NOT NULL,
  done text NOT NULL DEFAULT '',
  went_well text NOT NULL DEFAULT '',
  went_badly text NOT NULL DEFAULT '',
  problems text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  sent_on_whatsapp boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS care_reports_day_idx ON public.care_round_reports (day DESC);
CREATE INDEX IF NOT EXISTS care_debriefs_day_idx ON public.care_debriefs (day DESC);
CREATE INDEX IF NOT EXISTS care_debriefs_ulid_idx ON public.care_debriefs (ulid);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['care_commitments','care_round_reports','care_debriefs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS "own insert" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "own or ops read" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "own update" ON public.%I', t);
    EXECUTE format('CREATE POLICY "own insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())', t);
    EXECUTE format('CREATE POLICY "own or ops read" ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_tower_ops(auth.uid()))', t);
    EXECUTE format('CREATE POLICY "own update" ON public.%I FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())', t);
  END LOOP;
END $$;
