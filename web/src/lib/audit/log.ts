import type { AuditActor, AuditEventType, AuditLogEntry } from "./types";

function uid(): string {
  return `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Create an append-only audit entry (caller must append, never mutate prior rows). */
export function createAuditEntry(
  type: AuditEventType,
  message: string,
  options?: {
    actor?: AuditActor;
    payload?: Record<string, unknown>;
  },
): AuditLogEntry {
  return {
    id: uid(),
    ts: new Date().toISOString(),
    type,
    message,
    actor: options?.actor ?? "system",
    payload: options?.payload,
  };
}

/** Append entry — returns new array (immutable log). */
export function appendAudit(
  log: AuditLogEntry[],
  entry: AuditLogEntry,
): AuditLogEntry[] {
  return [...log, entry];
}

export function appendAuditEvent(
  log: AuditLogEntry[],
  type: AuditEventType,
  message: string,
  options?: { actor?: AuditActor; payload?: Record<string, unknown> },
): AuditLogEntry[] {
  return appendAudit(log, createAuditEntry(type, message, options));
}
