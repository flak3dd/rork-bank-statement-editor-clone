import type { Transaction, WorkflowStep } from "@/lib/types";
import type { UndoSnapshot } from "./types";

const MAX_STACK = 50;

function uid(): string {
  return `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function cloneTxns(txns: Transaction[]): Transaction[] {
  return txns.map((t) => ({
    ...t,
    flags: [...t.flags],
    original: t.original ? { ...t.original } : undefined,
  }));
}

export interface UndoRedoState {
  past: UndoSnapshot[];
  future: UndoSnapshot[];
}

export function emptyUndoState(): UndoRedoState {
  return { past: [], future: [] };
}

export function pushSnapshot(
  state: UndoRedoState,
  label: string,
  transactions: Transaction[],
  workflowStep: WorkflowStep,
): UndoRedoState {
  const snap: UndoSnapshot = {
    id: uid(),
    ts: new Date().toISOString(),
    label,
    transactions: cloneTxns(transactions),
    workflowStep,
  };
  const past = [...state.past, snap].slice(-MAX_STACK);
  return { past, future: [] };
}

export function undo(
  state: UndoRedoState,
  current: { transactions: Transaction[]; workflowStep: WorkflowStep },
): {
  state: UndoRedoState;
  restored: UndoSnapshot | null;
} {
  if (state.past.length === 0) return { state, restored: null };
  const past = [...state.past];
  const prev = past.pop()!;
  const currentSnap: UndoSnapshot = {
    id: uid(),
    ts: new Date().toISOString(),
    label: "before-undo",
    transactions: cloneTxns(current.transactions),
    workflowStep: current.workflowStep,
  };
  return {
    state: { past, future: [currentSnap, ...state.future].slice(0, MAX_STACK) },
    restored: prev,
  };
}

export function redo(
  state: UndoRedoState,
  current: { transactions: Transaction[]; workflowStep: WorkflowStep },
): {
  state: UndoRedoState;
  restored: UndoSnapshot | null;
} {
  if (state.future.length === 0) return { state, restored: null };
  const future = [...state.future];
  const next = future.shift()!;
  const currentSnap: UndoSnapshot = {
    id: uid(),
    ts: new Date().toISOString(),
    label: "before-redo",
    transactions: cloneTxns(current.transactions),
    workflowStep: current.workflowStep,
  };
  return {
    state: {
      past: [...state.past, currentSnap].slice(-MAX_STACK),
      future,
    },
    restored: next,
  };
}

export function canUndo(state: UndoRedoState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: UndoRedoState): boolean {
  return state.future.length > 0;
}
