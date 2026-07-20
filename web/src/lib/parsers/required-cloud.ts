/**
 * Product rule: every upload parse MUST call exactly one cloud engine —
 * LlamaParse XOR Google Document AI (never both).
 * Local parsers may only enrich after that single cloud success.
 */
import { googleDocAiParser } from "./google-docai";
import { llamaParseParser } from "./llamaparse";
import { structurePyMuPdfText } from "./pymupdf";
import type {
  DocumentParserId,
  ParserInput,
  ParserResult,
} from "./types";

export type CloudParserId = "llamaparse" | "google-docai";

export function isLlamaParseConfigured(): boolean {
  return llamaParseParser.isConfigured();
}

export function isGoogleDocAiConfigured(): boolean {
  return googleDocAiParser.isConfigured();
}

export function cloudParserStatus(): {
  llamaparse: boolean;
  "google-docai": boolean;
  any: boolean;
} {
  const llamaparse = isLlamaParseConfigured();
  const docai = isGoogleDocAiConfigured();
  return {
    llamaparse,
    "google-docai": docai,
    any: llamaparse || docai,
  };
}

/**
 * Pick exactly one cloud engine. Never returns both.
 * - If preferred is llamaparse or google-docai, that is the only choice.
 * - Otherwise default to llamaparse when configured, else google-docai.
 */
export function selectCloudParser(
  preferred?: DocumentParserId | null,
): CloudParserId {
  if (preferred === "google-docai") return "google-docai";
  if (preferred === "llamaparse") return "llamaparse";
  // Non-cloud UI selection (pymupdf, etc.): still one default only
  if (isLlamaParseConfigured()) return "llamaparse";
  return "google-docai";
}

/**
 * MUST call exactly one of LlamaParse or Google Document AI.
 * Does not try the other engine on failure.
 * Throws if the selected engine is not configured or fails.
 * On success, optionally re-structures text with YAML hybrid for better txns.
 */
export async function runRequiredCloudParser(
  input: ParserInput,
  preferred?: DocumentParserId | null,
): Promise<ParserResult> {
  const status = cloudParserStatus();
  if (!status.any) {
    throw new Error(
      "LlamaParse or Google Document AI is required. Configure VITE_LLAMAPARSE_API_KEY " +
        "(or VITE_LLAMA_CLOUD_API_KEY) OR VITE_GOOGLE_DOCAI_PROJECT + PROCESSOR + TOKEN " +
        "(select one engine — not both at once).",
    );
  }

  const id = selectCloudParser(preferred);
  const configured =
    id === "llamaparse" ? status.llamaparse : status["google-docai"];
  if (!configured) {
    const other: CloudParserId =
      id === "llamaparse" ? "google-docai" : "llamaparse";
    const otherOk =
      other === "llamaparse" ? status.llamaparse : status["google-docai"];
    throw new Error(
      `${id} is selected but not configured.` +
        (otherOk
          ? ` Switch the parser dropdown to ${other} (only one cloud engine is used).`
          : ` Configure ${id} credentials, or select the other cloud engine if it is set up.`),
    );
  }

  const parser = id === "llamaparse" ? llamaParseParser : googleDocAiParser;

  try {
    input.onProgress?.(0.08, `Calling ${parser.info.label} only…`);
    const result = await parser.parse(input);

    // Soft offline fallback from this engine is not a cloud success
    if (
      result.meta.fallbackFrom === id &&
      result.meta.parserId !== id
    ) {
      throw new Error(
        `${id}: fell back offline without cloud success (${result.meta.warnings.slice(0, 1).join("")})`,
      );
    }
    if (
      result.meta.fallbackUsed &&
      result.meta.parserId !== "llamaparse" &&
      result.meta.parserId !== "google-docai"
    ) {
      throw new Error(`${id}: offline result rejected (cloud required)`);
    }

    // Enrich structure with YAML hybrid if cloud returned few rows
    let transactions = result.transactions;
    let bankTemplateId = result.meta.bankTemplateId;
    let bankTemplateName = result.meta.bankTemplateName;
    const notes = [...result.meta.warnings];

    if (result.rawText.length > 40) {
      try {
        const structured = structurePyMuPdfText(result.rawText, {
          bankHint: input.fileName,
        });
        if (structured.transactions.length > transactions.length) {
          transactions = structured.transactions;
          bankTemplateId = structured.template.id;
          bankTemplateName = structured.template.name;
          notes.push(
            `YAML hybrid structured ${structured.transactions.length} rows from cloud text`,
          );
        }
      } catch {
        /* keep cloud rows */
      }
    }

    return {
      ...result,
      transactions,
      meta: {
        ...result.meta,
        parserId: id,
        parserLabel: parser.info.label,
        fallbackUsed: false,
        enginesTried: [
          ...new Set([...result.meta.enginesTried, id, "cloud-required-single"]),
        ],
        bankTemplateId,
        bankTemplateName,
        warnings: notes,
        structuredFromApi:
          result.meta.structuredFromApi || transactions.length > 0,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cloud parse failed (${id} only — other engine not tried). ${msg}`,
    );
  }
}
