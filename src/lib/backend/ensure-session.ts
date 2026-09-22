// The database rules only allow `authenticated` users. This app has no login screen,
// so every browser gets a Supabase anonymous session on first write. Data is then
// owned by that user_id and shows to admins (is_tower_ops) from any device.
// Requires: Supabase > Authentication > Sign In / Providers > Allow anonymous sign-ins.
import { supabase } from "@/integrations/supabase/client";

let pending: Promise<string | null> | null = null;

export function ensureSession(): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (pending) return pending;
  pending = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) return data.session.user.id;
      const { data: anon, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.warn("[backend] anonymous sign-in failed:", error.message);
        return null;
      }
      return anon.user?.id ?? null;
    } catch (e) {
      console.warn("[backend] session error:", e);
      return null;
    } finally {
      // allow a retry on the next write if we failed
      setTimeout(() => {
        pending = null;
      }, 0);
    }
  })();
  return pending;
}
