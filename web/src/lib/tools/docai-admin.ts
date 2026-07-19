import { envFirst, toolkitBase } from "@/lib/parsers/normalize";

export interface DocAiProcessorVersion {
  name: string;
  displayName?: string;
  state?: string;
  createTime?: string;
}

export interface DocAiAdminConfig {
  project: string;
  location: string;
  processor: string;
  token: string;
}

export function getDocAiAdminConfig(): DocAiAdminConfig | null {
  const project = envFirst(
    "VITE_GOOGLE_DOCAI_PROJECT",
    "EXPO_PUBLIC_GOOGLE_DOCAI_PROJECT",
  );
  const processor = envFirst(
    "VITE_GOOGLE_DOCAI_PROCESSOR",
    "EXPO_PUBLIC_GOOGLE_DOCAI_PROCESSOR",
  );
  const token = envFirst(
    "VITE_GOOGLE_DOCAI_TOKEN",
    "VITE_GOOGLE_ACCESS_TOKEN",
    "EXPO_PUBLIC_GOOGLE_DOCAI_TOKEN",
  );
  const location =
    envFirst("VITE_GOOGLE_DOCAI_LOCATION", "EXPO_PUBLIC_GOOGLE_DOCAI_LOCATION") ??
    "us";
  if (!project || !processor || !token) return null;
  return { project, location, processor, token };
}

export function isDocAiAdminConfigured(): boolean {
  return Boolean(getDocAiAdminConfig());
}

function processorPath(cfg: DocAiAdminConfig): string {
  return `projects/${cfg.project}/locations/${cfg.location}/processors/${cfg.processor}`;
}

function apiBase(cfg: DocAiAdminConfig): string {
  const toolkit = toolkitBase();
  if (toolkit) return `${toolkit}/v2/google/documentai/v1`;
  return `https://${cfg.location}-documentai.googleapis.com/v1`;
}

async function docAiFetch(
  cfg: DocAiAdminConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${apiBase(cfg)}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/** List processor versions (deployed / training). */
export async function listProcessorVersions(): Promise<DocAiProcessorVersion[]> {
  const cfg = getDocAiAdminConfig();
  if (!cfg) throw new Error("Document AI admin not configured");

  const res = await docAiFetch(
    cfg,
    `${processorPath(cfg)}/processorVersions`,
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`List versions HTTP ${res.status}: ${t.slice(0, 160)}`);
  }
  const json = (await res.json()) as {
    processorVersions?: DocAiProcessorVersion[];
  };
  return json.processorVersions ?? [];
}

/**
 * Start training a new processor version (schema-aware custom extractor).
 * Requires training dataset URI in Document AI.
 */
export async function trainProcessorVersion(params: {
  displayName: string;
  documentSchemaUri?: string;
  trainDataUri?: string;
}): Promise<{ operationName: string; message: string }> {
  const cfg = getDocAiAdminConfig();
  if (!cfg) throw new Error("Document AI admin not configured");

  const body = {
    processorVersion: {
      displayName: params.displayName,
    },
    documentSchema: params.documentSchemaUri
      ? { entityTypes: [] }
      : undefined,
    inputData: params.trainDataUri
      ? {
          trainingDocuments: {
            gcsPrefix: { gcsUriPrefix: params.trainDataUri },
          },
        }
      : undefined,
  };

  const res = await docAiFetch(
    cfg,
    `${processorPath(cfg)}/processorVersions:train`,
    { method: "POST", body: JSON.stringify(body) },
  );

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    // Soft message when API rejects incomplete training payload
    if (res.status === 400 || res.status === 404) {
      return {
        operationName: "",
        message: `Train request not accepted (${res.status}). Ensure dataset URIs and IAM are set. ${t.slice(0, 120)}`,
      };
    }
    throw new Error(`Train HTTP ${res.status}: ${t.slice(0, 160)}`);
  }

  const json = (await res.json()) as { name?: string };
  return {
    operationName: json.name ?? "",
    message: `Training started: ${json.name ?? params.displayName}`,
  };
}

/** Deploy (set default) a processor version. */
export async function deployProcessorVersion(
  versionName: string,
): Promise<{ message: string }> {
  const cfg = getDocAiAdminConfig();
  if (!cfg) throw new Error("Document AI admin not configured");

  // versionName is full resource name
  const res = await docAiFetch(cfg, `${versionName}:deploy`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Deploy HTTP ${res.status}: ${t.slice(0, 160)}`);
  }

  return { message: `Deploy requested for ${versionName}` };
}

export interface DocAiAdminSnapshot {
  configured: boolean;
  processorPath?: string;
  versions: DocAiProcessorVersion[];
  error?: string;
  fetchedAt: string;
}

export async function fetchDocAiAdminSnapshot(): Promise<DocAiAdminSnapshot> {
  const cfg = getDocAiAdminConfig();
  if (!cfg) {
    return {
      configured: false,
      versions: [],
      fetchedAt: new Date().toISOString(),
      error: "Set VITE_GOOGLE_DOCAI_PROJECT, PROCESSOR, and TOKEN",
    };
  }
  try {
    const versions = await listProcessorVersions();
    return {
      configured: true,
      processorPath: processorPath(cfg),
      versions,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      configured: true,
      processorPath: processorPath(cfg),
      versions: [],
      error: err instanceof Error ? err.message : String(err),
      fetchedAt: new Date().toISOString(),
    };
  }
}
