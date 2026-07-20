import { envFirst } from "@/lib/parsers/normalize";
import { attachOriginals } from "@/lib/edit-utils";
import { lineItemsToTransactions } from "@/lib/parsers/normalize";
import type { Transaction } from "@/lib/types";

export type EngineMode = "local" | "remote";

export interface RemoteEngineConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

export interface RemoteParseRequest {
  fileName: string;
  bytesBase64: string;
  parserHint?: string;
  options?: Record<string, unknown>;
}

export interface RemoteParseResponse {
  transactions: Transaction[];
  rawText?: string;
  pageCount?: number;
  engine?: string;
  warnings?: string[];
}

const MODE_KEY = "statement-lens.engine-mode";
const URL_KEY = "statement-lens.remote-engine-url";

export function getRemoteEngineConfig(): RemoteEngineConfig | null {
  const base =
    envFirst("VITE_REMOTE_ENGINE_URL", "EXPO_PUBLIC_REMOTE_ENGINE_URL") ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem(URL_KEY) ?? undefined
      : undefined);
  if (!base) return null;
  return {
    baseUrl: base.replace(/\/$/, ""),
    apiKey: envFirst("VITE_REMOTE_ENGINE_API_KEY", "EXPO_PUBLIC_REMOTE_ENGINE_API_KEY"),
    timeoutMs: 120_000,
  };
}

export function isRemoteEngineConfigured(): boolean {
  return Boolean(getRemoteEngineConfig());
}

export function loadEngineMode(): EngineMode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === "remote" || m === "local") return m;
  } catch {
    // ignore
  }
  return "local";
}

export function saveEngineMode(mode: EngineMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // ignore
  }
}

export function saveRemoteEngineUrl(url: string): void {
  try {
    localStorage.setItem(URL_KEY, url.replace(/\/$/, ""));
  } catch {
    // ignore
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Thin client: POST PDF to hosted backend, receive structured transactions.
 * Endpoint: POST {base}/v1/parse  JSON { fileName, bytesBase64, parserHint }
 */
export async function remoteParsePdf(params: {
  fileName: string;
  bytes: Uint8Array;
  parserHint?: string;
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
}): Promise<RemoteParseResponse> {
  const cfg = getRemoteEngineConfig();
  if (!cfg) {
    throw new Error(
      "Remote engine not configured. Set VITE_REMOTE_ENGINE_URL or save a URL in tools.",
    );
  }

  params.onProgress?.("Uploading to remote engine…");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const signal = params.signal ?? controller.signal;

  try {
    const res = await fetch(`${cfg.baseUrl}/v1/parse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        fileName: params.fileName,
        bytesBase64: bytesToBase64(params.bytes),
        parserHint: params.parserHint,
      } satisfies RemoteParseRequest),
      signal,
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Remote engine HTTP ${res.status}: ${t.slice(0, 200)}`);
    }

    params.onProgress?.("Parsing remote response…");
    const json = (await res.json()) as {
      transactions?: unknown[];
      items?: unknown[];
      rawText?: string;
      pageCount?: number;
      engine?: string;
      warnings?: string[];
    };

    let transactions: Transaction[] = [];
    if (Array.isArray(json.transactions) && json.transactions.length) {
      // Assume already shaped or line-item-like
      const first = json.transactions[0] as Record<string, unknown>;
      if (first && ("debit" in first || "credit" in first || "description" in first)) {
        transactions = attachOriginals(
          json.transactions.map((raw, i) => {
            const t = raw as Partial<Transaction>;
            return {
              id: t.id ?? `remote-${i}`,
              date: String(t.date ?? ""),
              description: String(t.description ?? "Transaction"),
              debit: (t.debit as number | null) ?? null,
              credit: (t.credit as number | null) ?? null,
              balance: (t.balance as number | null) ?? null,
              category: (t.category as Transaction["category"]) ?? "Other",
              categorySource: "heuristic" as const,
              categoryConfidence: t.categoryConfidence ?? 0.5,
              flags: [...(t.flags ?? []), "remote-engine"],
            };
          }),
        );
      }
    }
    if (transactions.length === 0 && Array.isArray(json.items)) {
      transactions = lineItemsToTransactions(
        json.items as Parameters<typeof lineItemsToTransactions>[0],
      ).map((t) => ({
        ...t,
        flags: [...t.flags, "remote-engine"],
      }));
    }

    return {
      transactions,
      rawText: json.rawText,
      pageCount: json.pageCount,
      engine: json.engine ?? "remote",
      warnings: json.warnings,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Health check for remote backend. */
export async function probeRemoteEngine(
  baseUrl?: string,
): Promise<{ ok: boolean; detail: string }> {
  const url = (baseUrl || getRemoteEngineConfig()?.baseUrl)?.replace(/\/$/, "");
  if (!url) return { ok: false, detail: "No remote URL configured" };
  try {
    const res = await fetch(`${url}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true, detail: `Reachable ${url}` };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "Probe failed",
    };
  }
}

export interface RemoteReplaceRequest {
  fileName?: string;
  bytesBase64: string;
  replacements: Array<{
    page: number;
    bbox: { x: number; y: number; width: number; height: number };
    replacement: string;
    burn?: boolean;
  }>;
  /** Prefer native PyMuPDF burn+insert when server supports it. */
  engine?: "pymupdf" | "auto";
}

export interface RemoteReplaceResponse {
  bytesBase64: string;
  engine?: string;
  applied?: number;
  notes?: string[];
}

/**
 * POST PDF + geometry replacements to hosted backend (native PyMuPDF Pro).
 * Endpoint: POST {base}/v1/replace
 */
export async function remoteReplacePdf(params: {
  fileName?: string;
  bytes: Uint8Array;
  replacements: RemoteReplaceRequest["replacements"];
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
}): Promise<{ pdf: Uint8Array; engine: string; notes: string[] }> {
  const cfg = getRemoteEngineConfig();
  if (!cfg) {
    throw new Error(
      "Remote engine not configured. Set VITE_REMOTE_ENGINE_URL for native PyMuPDF writes.",
    );
  }

  params.onProgress?.("Uploading to remote PDF engine (PyMuPDF)…");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const signal = params.signal ?? controller.signal;

  try {
    const res = await fetch(`${cfg.baseUrl}/v1/replace`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        fileName: params.fileName ?? "statement.pdf",
        bytesBase64: bytesToBase64(params.bytes),
        replacements: params.replacements,
        engine: "pymupdf",
      } satisfies RemoteReplaceRequest),
      signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Remote replace HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    params.onProgress?.("Decoding remote PDF…");
    const json = (await res.json()) as RemoteReplaceResponse;
    if (!json.bytesBase64) {
      throw new Error("Remote replace returned no PDF bytes");
    }
    const binary = atob(json.bytesBase64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return {
      pdf: out,
      engine: json.engine ?? "remote-pymupdf",
      notes: json.notes ?? [`Remote applied ${json.applied ?? params.replacements.length}`],
    };
  } finally {
    clearTimeout(timer);
  }
}
