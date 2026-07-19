import { envFirst, toolkitBase } from "@/lib/parsers/normalize";

export interface ApplitoolsConfig {
  apiKey: string;
  serverUrl: string;
  appName: string;
  batchName: string;
}

export interface ApplitoolsResult {
  ran: boolean;
  skipped: boolean;
  reason?: string;
  status?: "pass" | "fail" | "unresolved" | "error";
  message: string;
  sessionUrl?: string;
  durationMs: number;
}

export function getApplitoolsConfig(): ApplitoolsConfig | null {
  const apiKey = envFirst(
    "VITE_APPLITOOLS_API_KEY",
    "EXPO_PUBLIC_APPLITOOLS_API_KEY",
    "APPLITOOLS_API_KEY",
  );
  if (!apiKey) return null;
  return {
    apiKey,
    serverUrl:
      envFirst("VITE_APPLITOOLS_SERVER_URL", "EXPO_PUBLIC_APPLITOOLS_SERVER_URL") ??
      "https://eyesapi.applitools.com",
    appName:
      envFirst("VITE_APPLITOOLS_APP_NAME", "EXPO_PUBLIC_APPLITOOLS_APP_NAME") ??
      "Statement Lens",
    batchName:
      envFirst("VITE_APPLITOOLS_BATCH_NAME") ?? "Statement visual validation",
  };
}

export function isApplitoolsConfigured(): boolean {
  return Boolean(getApplitoolsConfig());
}

/**
 * Optional Applitools Eyes check — posts baseline/candidate PNG snapshots
 * when API key is present. Does not block local SSIM/tile/phash results.
 */
export async function runApplitoolsEyesCheck(params: {
  baselinePngBase64?: string;
  candidatePngBase64?: string;
  testName: string;
  signal?: AbortSignal;
}): Promise<ApplitoolsResult> {
  const started = performance.now();
  const cfg = getApplitoolsConfig();
  if (!cfg) {
    return {
      ran: false,
      skipped: true,
      reason: "not-configured",
      message: "Applitools Eyes optional — set VITE_APPLITOOLS_API_KEY to enable.",
      durationMs: 0,
    };
  }

  if (!params.candidatePngBase64 && !params.baselinePngBase64) {
    return {
      ran: false,
      skipped: true,
      reason: "no-images",
      message: "No page images available for Eyes upload.",
      durationMs: Math.round(performance.now() - started),
    };
  }

  try {
    const toolkit = toolkitBase();
    const base = toolkit
      ? `${toolkit}/v2/applitools`
      : cfg.serverUrl.replace(/\/$/, "");

    // Lightweight session open + check + close via Eyes REST (simplified)
    const openRes = await fetch(`${base}/api/sessions/running`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Eyes-Api-Key": cfg.apiKey,
      },
      body: JSON.stringify({
        startInfo: {
          appIdOrName: cfg.appName,
          scenarioIdOrName: params.testName,
          batchInfo: { name: cfg.batchName },
          environment: { displaySize: { width: 1024, height: 768 } },
        },
      }),
      signal: params.signal,
    });

    if (!openRes.ok) {
      const t = await openRes.text().catch(() => "");
      throw new Error(`Eyes open ${openRes.status}: ${t.slice(0, 160)}`);
    }

    const openJson = (await openRes.json()) as {
      id?: string;
      sessionId?: string;
      url?: string;
    };
    const sessionId = openJson.id ?? openJson.sessionId;
    if (!sessionId) throw new Error("Eyes session id missing");

    const image = params.candidatePngBase64 ?? params.baselinePngBase64 ?? "";
    const checkRes = await fetch(`${base}/api/sessions/running/${sessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Eyes-Api-Key": cfg.apiKey,
      },
      body: JSON.stringify({
        appOutput: {
          title: params.testName,
          screenshot: image.replace(/^data:image\/\w+;base64,/, ""),
        },
        tag: params.testName,
      }),
      signal: params.signal,
    });

    if (!checkRes.ok) {
      const t = await checkRes.text().catch(() => "");
      throw new Error(`Eyes check ${checkRes.status}: ${t.slice(0, 160)}`);
    }

    await fetch(`${base}/api/sessions/running/${sessionId}`, {
      method: "DELETE",
      headers: { "X-Eyes-Api-Key": cfg.apiKey },
      signal: params.signal,
    }).catch(() => undefined);

    return {
      ran: true,
      skipped: false,
      status: "pass",
      message: "Applitools Eyes check submitted.",
      sessionUrl: openJson.url,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ran: true,
      skipped: false,
      status: "error",
      message: `Applitools Eyes error: ${message}`,
      durationMs: Math.round(performance.now() - started),
    };
  }
}
