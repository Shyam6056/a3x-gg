-- RUN THIS FIRST on a fresh Supabase project (SQL Editor).
-- The repo's migrations reference objects that were created outside the repo
-- (public.is_tower_ops, public.user_roles). This recreates the minimum needed.
-- Order: 00_bootstrap (this) -> drizzle/migrations/0002_create_call_records.sql -> 01_movement_care.sql
-- (Skip drizzle 0000 and 0001: they seed/alter tables this minimal backend does not create.)

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM
    ('admin','manager','operator','sales','control_tower','founder_admin','zone_manager');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

CREATE OR REPLACE FUNCTION public.is_tower_ops(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('admin','founder_admin','control_tower','manager')
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_tower_ops(uuid) TO authenticated;

-- To make yourself the admin viewer (after you open the app once so an anonymous
-- or real user exists), run:
--   INSERT INTO public.user_roles (user_id, role) VALUES ('<your auth.users id>', 'admin');
