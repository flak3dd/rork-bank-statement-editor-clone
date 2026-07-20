import { envFirst, toolkitBase } from "./normalize";
import { runOfflineHeuristicParse } from "./offline-heuristic";
import { parseTransactionsHybrid } from "@/lib/parse-transactions";
import { attachOriginals } from "@/lib/edit-utils";
import type { DocumentParser, ParserInput, ParserResult } from "./types";

function llamaKey(): string | undefined {
  return envFirst(
    "VITE_LLAMAPARSE_API_KEY",
    "VITE_LLAMA_CLOUD_API_KEY",
    "EXPO_PUBLIC_LLAMAPARSE_API_KEY",
    "EXPO_PUBLIC_LLAMA_CLOUD_API_KEY",
  );
}

async function sleep(ms: number, signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

function llamaBaseUrls(): { uploadUrl: string; statusBase: string } {
  const toolkit = toolkitBase();
  if (toolkit) {
    return {
      uploadUrl: `${toolkit}/v2/llamaparse/upload`,
      statusBase: `${toolkit}/v2/llamaparse`,
    };
  }
  // Browser: Vite dev proxy avoids CORS NetworkError
  if (typeof window !== "undefined") {
    return {
      uploadUrl: "/api/llamaparse/upload",
      statusBase: "/api/llamaparse",
    };
  }
  return {
    uploadUrl: "https://api.cloud.llamaindex.ai/api/v1/parsing/upload",
    statusBase: "https://api.cloud.llamaindex.ai/api/v1/parsing",
  };
}

function friendlyLlamaError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/NetworkError|Failed to fetch|Load failed|network/i.test(msg)) {
    return (
      "LlamaParse network/CORS error. Restart Vite (dev proxy /api/llamaparse) " +
      "or set VITE_TOOLKIT_BASE if using a backend proxy. Original: " +
      msg
    );
  }
  return msg;
}

async function callLlamaParse(input: ParserInput): Promise<{ rawText: string; pageCount: number }> {
  const key = llamaKey();
  if (!key) throw new Error("LlamaParse API key not configured");

  const { uploadUrl, statusBase } = llamaBaseUrls();

  const form = new FormData();
  // BlobPart typing: copy into a fresh ArrayBuffer-backed Uint8Array
  const ab = new ArrayBuffer(input.bytes.byteLength);
  new Uint8Array(ab).set(input.bytes);
  form.append(
    "file",
    new Blob([ab], { type: "application/pdf" }),
    input.fileName,
  );

  input.onProgress?.(0.2, "Uploading to LlamaParse…");
  let up: Response;
  try {
    up = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: input.signal,
    });
  } catch (err) {
    throw new Error(friendlyLlamaError(err));
  }
  if (!up.ok) {
    const t = await up.text().catch(() => "");
    throw new Error(`LlamaParse upload ${up.status}: ${t.slice(0, 180)}`);
  }
  const upJson = (await up.json()) as { id?: string; job_id?: string };
  const jobId = upJson.id ?? upJson.job_id;
  if (!jobId) throw new Error("LlamaParse did not return a job id");

  // Poll for completion
  let rawText = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    input.onProgress?.(0.3 + Math.min(0.5, attempt * 0.02), "LlamaParse processing…");
    await sleep(1500, input.signal);
    const st = await fetch(`${statusBase}/job/${jobId}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: input.signal,
    });
    if (!st.ok) continue;
    const body = (await st.json()) as {
      status?: string;
      result?: { markdown?: string; text?: string };
      markdown?: string;
      text?: string;
    };
    const status = String(body.status ?? "").toLowerCase();
    if (status === "success" || status === "completed") {
      // fetch result
      const res = await fetch(`${statusBase}/job/${jobId}/result/markdown`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: input.signal,
      }).catch(() => null);
      if (res?.ok) {
        const md = await res.text();
        rawText = md;
      } else {
        rawText =
          body.result?.markdown ??
          body.result?.text ??
          body.markdown ??
          body.text ??
          "";
      }
      break;
    }
    if (status === "error" || status === "failed") {
      throw new Error("LlamaParse job failed");
    }
  }

  if (!rawText) throw new Error("LlamaParse returned empty text");
  const pageCount = Math.max(1, (rawText.match(/\f|---\s*page/gi) ?? []).length || 1);
  return { rawText, pageCount };
}

export const llamaParseParser: DocumentParser = {
  info: {
    id: "llamaparse",
    label: "LlamaParse",
    shortLabel: "LlamaParse",
    description:
      "LlamaCloud document parser — high-quality markdown/text extraction, then local hybrid transaction structure.",
    availability: llamaKey() ? "ready" : "needs-config",
    cloud: true,
    envHints: ["VITE_LLAMAPARSE_API_KEY", "VITE_LLAMA_CLOUD_API_KEY"],
  },

  isConfigured() {
    return Boolean(llamaKey());
  },

  async parse(input: ParserInput): Promise<ParserResult> {
    const started = performance.now();
    const enginesTried = ["llamaparse"];

    if (!this.isConfigured()) {
      const offline = await runOfflineHeuristicParse(input, {
        enginesTried,
        fallbackFrom: "llamaparse",
      });
      offline.meta.warnings.push("LlamaParse API key missing — offline fallback.");
      return offline;
    }

    try {
      const { rawText, pageCount } = await callLlamaParse(input);
      enginesTried.push("hybrid-structure");
      const hybrid = parseTransactionsHybrid(rawText);
      input.onProgress?.(1, "LlamaParse complete");
      return {
        rawText,
        pageCount,
        pageTexts: rawText.split(/\f/),
        transactions: attachOriginals(hybrid.transactions),
        meta: {
          parserId: "llamaparse",
          parserLabel: this.info.label,
          durationMs: Math.round(performance.now() - started),
          fallbackUsed: false,
          enginesTried,
          warnings: hybrid.transactions.length === 0 ? ["No transactions structured from LlamaParse text."] : [],
          pageCount,
          rawTextLength: rawText.length,
          structuredFromApi: false,
        },
      };
    } catch (err) {
      const message = friendlyLlamaError(err);
      // Re-throw for required-cloud path (do not mask as silent offline success)
      const offline = await runOfflineHeuristicParse(input, {
        enginesTried,
        fallbackFrom: "llamaparse",
      });
      offline.meta.durationMs = Math.round(performance.now() - started);
      offline.meta.warnings.push(`LlamaParse error: ${message}`);
      return offline;
    }
  },
};
