import { envFirst, toolkitBase } from "@/lib/parsers/normalize";
import { isApplitoolsConfigured } from "@/lib/verification/applitools";
import { isPdfiumAvailable } from "@/lib/verification/pdfium-renderer";

export type ApiStatusKind = "ready" | "missing" | "error" | "local-always";

export interface ApiStatusItem {
  id: string;
  label: string;
  kind: ApiStatusKind;
  /** true = green check */
  ok: boolean;
  detail: string;
  signupUrl?: string;
  docsUrl?: string;
  envHints?: string[];
  group: "renderer" | "visual" | "parsers" | "optional";
}

export interface ApiStatusReport {
  checkedAt: string;
  items: ApiStatusItem[];
  readyCount: number;
  totalCount: number;
}

function hasEnv(...keys: string[]): boolean {
  return keys.some((k) => Boolean(envFirst(k)));
}

/**
 * Boot-time (and on-demand) availability detection for verification + cloud APIs.
 * Local metrics (SSIM / tile / pHash) and Pdfium are always attempted.
 */
export async function detectApiAvailability(): Promise<ApiStatusReport> {
  const items: ApiStatusItem[] = [];

  // --- Verification renderer: Pdfium always ---
  let pdfiumOk = false;
  let pdfiumDetail = "Local Pdfium WASM";
  try {
    pdfiumOk = await isPdfiumAvailable();
    pdfiumDetail = pdfiumOk
      ? "Local Pdfium WASM ready (verification renderer)"
      : "Pdfium WASM failed to initialize";
  } catch (err) {
    pdfiumDetail = err instanceof Error ? err.message : "Pdfium probe failed";
  }

  items.push({
    id: "pdfium",
    label: "Local Pdfium (verification renderer)",
    kind: pdfiumOk ? "local-always" : "error",
    ok: pdfiumOk,
    detail: pdfiumDetail,
    docsUrl: "https://pdfium.js.org/docs/intro",
    group: "renderer",
  });

  // --- Always-on visual metrics (pure JS — always ready) ---
  items.push({
    id: "ssim",
    label: "SSIM",
    kind: "local-always",
    ok: true,
    detail: "Structural similarity — always on",
    group: "visual",
  });
  items.push({
    id: "tile-max",
    label: "Tile-max diff",
    kind: "local-always",
    ok: true,
    detail: "Per-tile max mean-abs difference — always on",
    group: "visual",
  });
  items.push({
    id: "phash",
    label: "Perceptual Hash",
    kind: "local-always",
    ok: true,
    detail: "64-bit pHash / Hamming distance — always on",
    group: "visual",
  });

  // --- Optional Applitools ---
  const eyesConfigured = isApplitoolsConfigured();
  items.push({
    id: "applitools",
    label: "Applitools Eyes",
    kind: eyesConfigured ? "ready" : "missing",
    ok: eyesConfigured,
    detail: eyesConfigured
      ? "API key detected — optional Eyes checks enabled"
      : "Optional — add VITE_APPLITOOLS_API_KEY to enable",
    signupUrl: "https://applitools.com/users/register/",
    docsUrl: "https://applitools.com/docs/",
    envHints: ["VITE_APPLITOOLS_API_KEY"],
    group: "optional",
  });

  // --- Cloud document parsers ---
  items.push({
    id: "mindee",
    label: "Mindee Financial",
    kind: hasEnv("VITE_MINDEE_API_KEY", "EXPO_PUBLIC_MINDEE_API_KEY")
      ? "ready"
      : "missing",
    ok: hasEnv("VITE_MINDEE_API_KEY", "EXPO_PUBLIC_MINDEE_API_KEY"),
    detail: hasEnv("VITE_MINDEE_API_KEY", "EXPO_PUBLIC_MINDEE_API_KEY")
      ? "API key present"
      : "Falls back to offline heuristic without key",
    signupUrl: "https://platform.mindee.com/sign-up",
    docsUrl: "https://developers.mindee.com/",
    envHints: ["VITE_MINDEE_API_KEY"],
    group: "parsers",
  });

  items.push({
    id: "llamaparse",
    label: "LlamaParse",
    kind: hasEnv(
      "VITE_LLAMAPARSE_API_KEY",
      "VITE_LLAMA_CLOUD_API_KEY",
      "EXPO_PUBLIC_LLAMAPARSE_API_KEY",
    )
      ? "ready"
      : "missing",
    ok: hasEnv(
      "VITE_LLAMAPARSE_API_KEY",
      "VITE_LLAMA_CLOUD_API_KEY",
      "EXPO_PUBLIC_LLAMAPARSE_API_KEY",
    ),
    detail: hasEnv("VITE_LLAMAPARSE_API_KEY", "VITE_LLAMA_CLOUD_API_KEY")
      ? "API key present"
      : "Falls back to offline heuristic without key",
    signupUrl: "https://cloud.llamaindex.ai/",
    docsUrl: "https://docs.cloud.llamaindex.ai/llamaparse/",
    envHints: ["VITE_LLAMAPARSE_API_KEY"],
    group: "parsers",
  });

  const docAiOk = hasEnv(
    "VITE_GOOGLE_DOCAI_PROJECT",
    "EXPO_PUBLIC_GOOGLE_DOCAI_PROJECT",
  ) &&
    hasEnv("VITE_GOOGLE_DOCAI_PROCESSOR", "EXPO_PUBLIC_GOOGLE_DOCAI_PROCESSOR") &&
    hasEnv(
      "VITE_GOOGLE_DOCAI_TOKEN",
      "VITE_GOOGLE_ACCESS_TOKEN",
      "EXPO_PUBLIC_GOOGLE_DOCAI_TOKEN",
    );

  items.push({
    id: "google-docai",
    label: "Google Document AI",
    kind: docAiOk ? "ready" : "missing",
    ok: docAiOk,
    detail: docAiOk
      ? "Project + processor + token present"
      : "Requires project, processor, and access token",
    signupUrl: "https://console.cloud.google.com/ai/document-ai",
    docsUrl: "https://cloud.google.com/document-ai/docs",
    envHints: [
      "VITE_GOOGLE_DOCAI_PROJECT",
      "VITE_GOOGLE_DOCAI_PROCESSOR",
      "VITE_GOOGLE_DOCAI_TOKEN",
    ],
    group: "parsers",
  });

  items.push({
    id: "toolkit",
    label: "AI / Toolkit proxy",
    kind: toolkitBase() ? "ready" : "missing",
    ok: Boolean(toolkitBase()),
    detail: toolkitBase()
      ? `Proxy ${toolkitBase()}`
      : "Optional VITE_TOOLKIT_URL for AI categorize + API proxies",
    envHints: ["VITE_TOOLKIT_URL"],
    group: "optional",
  });

  items.push({
    id: "offline",
    label: "Offline heuristic + YAML",
    kind: "local-always",
    ok: true,
    detail: "Always available — bank templates bundled",
    group: "parsers",
  });

  const readyCount = items.filter((i) => i.ok).length;
  return {
    checkedAt: new Date().toISOString(),
    items,
    readyCount,
    totalCount: items.length,
  };
}
