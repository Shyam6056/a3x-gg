import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CareGoal, CareRole, CareRound } from "./playbooks";
import { fetchMine, markDebriefSentRemote, pushCommitment, pushDebrief, pushReport } from "./sync";

export interface DailyCommitment {
  date: string;
  role: CareRole;
  goal: CareGoal;
  /** How many accepted results the person is committing to today. */
  commitCount: number;
  supportNeeded: string;
  closingPropertyIds: string[];
  committedAt: string;
}

export interface RoundReport {
  id: string;
  date: string;
  round: CareRound;
  role: CareRole;
  goal: CareGoal;
  actual: number;
  committed: number;
  moved: string;
  stuck: string;
  need: string;
  reportedAt: string;
}

export interface DraftDebrief {
  id: string;
  date: string;
  ulid: string;
  customerName: string;
  draftCode: string;
  goal: CareGoal;
  done: string;
  wentWell: string;
  wentBadly: string;
  problems: string;
  message: string;
  sentOnWhatsapp: boolean;
  createdAt: string;
}

interface MovementCareStore {
  commitment: DailyCommitment | null;
  reports: RoundReport[];
  debriefs: DraftDebrief[];
  /** When on, the person picks every customer in the draft by hand. */
  manualMode: boolean;
  /** How many customers the hand-picked draft should hold (30 by default). */
  manualSize: number;
  /** Hand-picked customers, in the order the person wants to work them. */
  manualList: string[];
  /** When the rolling draft clock was started. Empty rows get filled while working. */
  draftStartedAt: string | null;
  startRollingDraft: (size: number) => void;
  stopDraftClock: () => void;
  commit: (input: Omit<DailyCommitment, "date" | "committedAt">) => DailyCommitment;
  setClosingProperties: (ids: string[]) => void;
  report: (input: Omit<RoundReport, "id" | "date" | "reportedAt">) => RoundReport;
  saveDebrief: (input: Omit<DraftDebrief, "id" | "date" | "createdAt" | "sentOnWhatsapp">) => DraftDebrief;
  markDebriefSent: (id: string) => void;
  setManualMode: (on: boolean) => void;
  setManualSize: (size: number) => void;
  setManualList: (ulids: string[]) => void;
  addToManual: (ulid: string) => void;
  removeFromManual: (ulid: string) => void;
  replaceInManual: (outUlid: string, inUlid: string) => void;
  clearManual: () => void;
  clearCommitment: () => void;
}

const dayKey = () => new Date().toISOString().slice(0, 10);

export const useMovementCare = create<MovementCareStore>()(
  persist(
    (set, get) => ({
      commitment: null,
      reports: [],
      debriefs: [],
      manualMode: false,
      manualSize: 30,
      manualList: [],
      draftStartedAt: null,
      startRollingDraft: (size) =>
        set({
          manualMode: true,
          manualSize: 30,
          manualList: [],
          draftStartedAt: new Date().toISOString(),
        }),
      stopDraftClock: () => set({ draftStartedAt: null }),
      commit: (input) => {
        const commitment: DailyCommitment = {
          ...input,
          date: dayKey(),
          committedAt: new Date().toISOString(),
        };
        set({ commitment });
        void pushCommitment(commitment);
        return commitment;
      },
      report: (input) => {
        const report: RoundReport = {
          ...input,
          id: `care-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          date: dayKey(),
          reportedAt: new Date().toISOString(),
        };
        set((state) => ({ reports: [report, ...state.reports].slice(0, 90) }));
        void pushReport(report);
        return report;
      },
      saveDebrief: (input) => {
        const debrief: DraftDebrief = {
          ...input,
          id: `debrief-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          date: dayKey(),
          sentOnWhatsapp: false,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({ debriefs: [debrief, ...state.debriefs].slice(0, 200) }));
        void pushDebrief(debrief);
        return debrief;
      },
      markDebriefSent: (id) => {
        set((state) => ({
          debriefs: state.debriefs.map((item) => (item.id === id ? { ...item, sentOnWhatsapp: true } : item)),
        }));
        void markDebriefSentRemote(id);
      },
      setClosingProperties: (ids) => {
        set((state) => ({ commitment: state.commitment ? { ...state.commitment, closingPropertyIds: ids } : null }));
        const c = get().commitment;
        if (c) void pushCommitment(c);
      },
      setManualMode: (on) => set({ manualMode: on }),
      setManualSize: (size) => set({ manualSize: Math.max(1, Math.min(200, Math.round(size) || 1)) }),
      setManualList: (ulids) => set({ manualList: Array.from(new Set(ulids)) }),
      addToManual: (ulid) =>
        set((state) => (state.manualList.includes(ulid) ? state : { manualList: [...state.manualList, ulid] })),
      removeFromManual: (ulid) =>
        set((state) => ({ manualList: state.manualList.filter((item) => item !== ulid) })),
      replaceInManual: (outUlid, inUlid) =>
        set((state) => ({
          manualList: state.manualList.includes(inUlid)
            ? state.manualList.filter((item) => item !== outUlid)
            : state.manualList.map((item) => (item === outUlid ? inUlid : item)),
        })),
      clearManual: () => set({ manualList: [] }),
      clearCommitment: () => set({ commitment: null }),
    }),
    {
      name: "gharpayy.movement-care.v3",
      // After the local copy loads, pull the server copy so a second device / cleared
      // browser shows the same commitment, reports and debriefs.
      onRehydrateStorage: () => () => {
        if (typeof window !== "undefined") queueMicrotask(() => void hydrateFromServer());
      },
    },
  ),
);

export function todaysCommitment(commitment: DailyCommitment | null) {
  return commitment?.date === dayKey() ? commitment : null;
}

/** Merge server rows into the local store (union by id; newest commitment wins). */
export async function hydrateFromServer() {
  const remote = await fetchMine();
  if (!remote) return;
  useMovementCare.setState((state) => {
    const byId = <T extends { id: string }>(local: T[], incoming: T[], stamp: (x: T) => string, cap: number) => {
      const map = new Map<string, T>();
      for (const x of [...incoming, ...local]) map.set(x.id, { ...map.get(x.id), ...x } as T);
      return [...map.values()].sort((a, b) => stamp(b).localeCompare(stamp(a))).slice(0, cap);
    };
    const local = todaysCommitment(state.commitment);
    const useRemote = remote.commitment && (!local || remote.commitment.committedAt > local.committedAt);
    return {
      commitment: useRemote ? remote.commitment : state.commitment,
      reports: byId(state.reports, remote.reports, (x) => x.reportedAt, 90),
      debriefs: byId(state.debriefs, remote.debriefs, (x) => x.createdAt, 200),
    };
  });
}
