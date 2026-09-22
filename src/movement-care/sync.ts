// Movement CARE -> Supabase. Every write is fire-and-forget: the local store stays the
// instant source for the UI, the database is the shared truth across devices and admin.
// Nothing here may throw into the UI.
import { supabase } from "@/integrations/supabase/client";
import { ensureSession } from "@/lib/backend/ensure-session";
import type { DailyCommitment, DraftDebrief, RoundReport } from "./store";

// New tables are not in the generated Supabase types until the types are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

type Result = { ok: boolean; error?: string };

async function run(
  label: string,
  fn: (uid: string) => Promise<{ error: { message: string } | null }>,
): Promise<Result> {
  try {
    const uid = await ensureSession();
    if (!uid) return { ok: false, error: "no session" };
    const { error } = await fn(uid);
    if (error) {
      console.warn(`[care-sync] ${label}:`, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.warn(`[care-sync] ${label}:`, e);
    return { ok: false, error: String(e) };
  }
}

export const pushCommitment = (c: DailyCommitment) =>
  run("commitment", (uid) =>
    db.from("care_commitments").upsert(
      {
        user_id: uid,
        day: c.date,
        role: c.role,
        goal: c.goal,
        commit_count: c.commitCount,
        support_needed: c.supportNeeded,
        closing_property_ids: c.closingPropertyIds,
        committed_at: c.committedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,day" },
    ),
  );

export const pushReport = (r: RoundReport) =>
  run("report", (uid) =>
    db.from("care_round_reports").upsert(
      {
        client_id: r.id,
        user_id: uid,
        day: r.date,
        round: r.round,
        role: r.role,
        goal: r.goal,
        actual: r.actual,
        committed: r.committed,
        moved: r.moved,
        stuck: r.stuck,
        need: r.need,
        reported_at: r.reportedAt,
      },
      { onConflict: "client_id" },
    ),
  );

export const pushDebrief = (d: DraftDebrief) =>
  run("debrief", (uid) =>
    db.from("care_debriefs").upsert(
      {
        client_id: d.id,
        user_id: uid,
        day: d.date,
        ulid: d.ulid,
        customer_name: d.customerName,
        draft_code: d.draftCode,
        goal: d.goal,
        done: d.done,
        went_well: d.wentWell,
        went_badly: d.wentBadly,
        problems: d.problems,
        message: d.message,
        sent_on_whatsapp: d.sentOnWhatsapp,
        created_at: d.createdAt,
      },
      { onConflict: "client_id" },
    ),
  );

export const markDebriefSentRemote = (clientId: string) =>
  run("debrief-sent", () =>
    db.from("care_debriefs").update({ sent_on_whatsapp: true }).eq("client_id", clientId),
  );

/* ---------- reads: own data for hydration, everyone's for admin (RLS decides) ---------- */

export async function fetchMine(): Promise<{
  commitment: DailyCommitment | null;
  reports: RoundReport[];
  debriefs: DraftDebrief[];
} | null> {
  try {
    const uid = await ensureSession();
    if (!uid) return null;
    const today = new Date().toISOString().slice(0, 10);
    const [c, r, d] = await Promise.all([
      db.from("care_commitments").select("*").eq("user_id", uid).eq("day", today).maybeSingle(),
      db
        .from("care_round_reports")
        .select("*")
        .eq("user_id", uid)
        .order("reported_at", { ascending: false })
        .limit(90),
      db
        .from("care_debriefs")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    if (c.error || r.error || d.error) return null;
    return {
      commitment: c.data
        ? {
            date: c.data.day,
            role: c.data.role,
            goal: c.data.goal,
            commitCount: c.data.commit_count,
            supportNeeded: c.data.support_needed,
            closingPropertyIds: c.data.closing_property_ids ?? [],
            committedAt: c.data.committed_at,
          }
        : null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reports: (r.data ?? []).map((x: any) => ({
        id: x.client_id,
        date: x.day,
        round: x.round,
        role: x.role,
        goal: x.goal,
        actual: x.actual,
        committed: x.committed,
        moved: x.moved,
        stuck: x.stuck,
        need: x.need,
        reportedAt: x.reported_at,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      debriefs: (d.data ?? []).map((x: any) => ({
        id: x.client_id,
        date: x.day,
        ulid: x.ulid,
        customerName: x.customer_name,
        draftCode: x.draft_code,
        goal: x.goal,
        done: x.done,
        wentWell: x.went_well,
        wentBadly: x.went_badly,
        problems: x.problems,
        message: x.message,
        sentOnWhatsapp: x.sent_on_whatsapp,
        createdAt: x.created_at,
      })),
    };
  } catch (e) {
    console.warn("[care-sync] fetchMine:", e);
    return null;
  }
}

/** Admin view: every operator's rows (RLS returns only what the viewer may see). */
export async function fetchTeamCare(days = 7) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const [c, r, d] = await Promise.all([
    db
      .from("care_commitments")
      .select("*")
      .gte("day", since)
      .order("committed_at", { ascending: false }),
    db
      .from("care_round_reports")
      .select("*")
      .gte("day", since)
      .order("reported_at", { ascending: false }),
    db
      .from("care_debriefs")
      .select("*")
      .gte("day", since)
      .order("created_at", { ascending: false }),
  ]);
  return { commitments: c.data ?? [], reports: r.data ?? [], debriefs: d.data ?? [] };
}
