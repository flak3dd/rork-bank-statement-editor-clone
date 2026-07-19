import { useState } from "react";
import {
  CalendarRange,
  Cloud,
  Cpu,
  FlaskConical,
  Shuffle,
  Type,
  Wand2,
} from "lucide-react";
import { cloneUint8Array } from "@/lib/bytes";
import {
  advancedGenerator,
  analyzeFonts,
  BANK_IDS,
  BANK_LABELS,
  buildFontReplicatedReplacements,
  completeFontName,
  deployProcessorVersion,
  extractWithHybridGeometry,
  fetchDocAiAdminSnapshot,
  getPageTextRunsFromBytes,
  linkRunMatches,
  pairGeneratedToMatches,
  periodBounds,
  probeRemoteEngine,
  pymupdfCliHint,
  remoteParsePdf,
  replaceStatementDataWithGeneration,
  replaceWithGenerated,
  saveEngineMode,
  saveRemoteEngineUrl,
  shiftTransactionDates,
  trainProcessorVersion,
  type BankId,
  type EngineMode,
  type GeometryRun,
} from "@/lib/tools";
import type { PdfEdit, Transaction } from "@/lib/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface AdditionalToolsPanelProps {
  transactions: Transaction[];
  pdfBytes: Uint8Array | null;
  fileName: string;
  engineMode: EngineMode;
  onEngineModeChange: (mode: EngineMode) => void;
  onReplaceTransactions: (txns: Transaction[], label: string) => void;
  onAddPdfEdits?: (edits: PdfEdit[]) => void;
  onAudit?: (type: string, message: string) => void;
}

export function AdditionalToolsPanel({
  transactions,
  pdfBytes,
  fileName,
  engineMode,
  onEngineModeChange,
  onReplaceTransactions,
  onAddPdfEdits,
  onAudit,
}: AdditionalToolsPanelProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 shadow-sm overflow-hidden">
      <div className="border-b border-border/60 px-4 py-3 flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight">Additional tools</p>
          <p className="text-[11px] text-muted-foreground">
            Generator · date shift · fonts · Doc AI · geometry · remote
            {engineMode === "remote" ? " · upload uses remote" : ""}
          </p>
        </div>
        {engineMode === "remote" && (
          <Badge variant="secondary" className="text-[10px] shrink-0">
            remote pipeline
          </Badge>
        )}
      </div>
      <Tabs defaultValue="generator" className="w-full">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1 p-2 bg-muted/30 rounded-none">
          <TabsTrigger value="generator" className="text-xs">
            Generator
          </TabsTrigger>
          <TabsTrigger value="dates" className="text-xs">
            Dates
          </TabsTrigger>
          <TabsTrigger value="fonts" className="text-xs">
            Fonts
          </TabsTrigger>
          <TabsTrigger value="docai" className="text-xs">
            Doc AI
          </TabsTrigger>
          <TabsTrigger value="geometry" className="text-xs">
            Geometry
          </TabsTrigger>
          <TabsTrigger value="remote" className="text-xs">
            Remote
          </TabsTrigger>
        </TabsList>

        <div className="p-4">
          <TabsContent value="generator" className="mt-0">
            <GeneratorTab
              transactions={transactions}
              pdfBytes={pdfBytes}
              onReplaceTransactions={onReplaceTransactions}
              onAddPdfEdits={onAddPdfEdits}
              onAudit={onAudit}
            />
          </TabsContent>
          <TabsContent value="dates" className="mt-0">
            <DatesTab
              transactions={transactions}
              onReplaceTransactions={onReplaceTransactions}
              onAudit={onAudit}
            />
          </TabsContent>
          <TabsContent value="fonts" className="mt-0">
            <FontsTab pdfBytes={pdfBytes} onAudit={onAudit} />
          </TabsContent>
          <TabsContent value="docai" className="mt-0">
            <DocAiTab onAudit={onAudit} />
          </TabsContent>
          <TabsContent value="geometry" className="mt-0">
            <GeometryTab
              pdfBytes={pdfBytes}
              onReplaceTransactions={onReplaceTransactions}
              onAudit={onAudit}
            />
          </TabsContent>
          <TabsContent value="remote" className="mt-0">
            <RemoteTab
              pdfBytes={pdfBytes}
              fileName={fileName}
              engineMode={engineMode}
              onEngineModeChange={onEngineModeChange}
              onReplaceTransactions={onReplaceTransactions}
              onAudit={onAudit}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function GeneratorTab({
  transactions,
  pdfBytes,
  onReplaceTransactions,
  onAddPdfEdits,
  onAudit,
}: {
  transactions: Transaction[];
  pdfBytes: Uint8Array | null;
  onReplaceTransactions: (txns: Transaction[], label: string) => void;
  onAddPdfEdits?: (edits: PdfEdit[]) => void;
  onAudit?: (type: string, message: string) => void;
}) {
  const bounds = periodBounds(transactions);
  const [count, setCount] = useState(12);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const [opening, setOpening] = useState(2500);
  const [start, setStart] = useState(bounds.start ?? "2026-03-01");
  const [end, setEnd] = useState(bounds.end ?? "2026-03-31");
  const [locale, setLocale] = useState<"au" | "us">("au");
  const [bank, setBank] = useState<BankId>("anz");
  const [lastSeed, setLastSeed] = useState<number | null>(null);
  const [linkStats, setLinkStats] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setLinkStats(null);
    try {
      const previous = transactions;
      const bundle = advancedGenerator({
        count: Math.max(count, previous.length || count),
        seed,
        periodStart: start,
        periodEnd: end,
        openingBalance: opening,
        locale,
        bank,
        includeIncome: true,
      });
      // Prefer same length as existing rows for 1:1 run linking
      let generated = replaceWithGenerated(bundle);
      if (previous.length > 0 && generated.length > previous.length) {
        generated = generated.slice(0, previous.length);
      }

      let edits: PdfEdit[] = [];
      if (pdfBytes && previous.length > 0) {
        const pdfCopy = cloneUint8Array(pdfBytes);
        const runs = await getPageTextRunsFromBytes(pdfCopy, 8);
        // Link PDF runs to *current* table values (what is still drawn on the PDF)
        const { matches, stats } = linkRunMatches({
          transactions: previous,
          runs,
          preferOriginal: true,
        });
        // Retarget matches onto generated row ids (same index)
        const paired = pairGeneratedToMatches({
          previous,
          generated,
          matches,
        });
        edits = buildFontReplicatedReplacements({
          transactions: generated,
          runMatches: paired,
        });
        setLinkStats(
          `Bank ${bank} · run-match: ${stats.linked}/${stats.fields} fields · ${edits.length} font edits · ${stats.runs} runs`,
        );
        onAudit?.(
          "note",
          `Run-match linking (${bank}): ${edits.length} font-replicated replacements from ${stats.linked} field matches`,
        );
      } else if (!pdfBytes) {
        setLinkStats("No PDF bytes — table replaced without font run-match.");
      } else {
        setLinkStats("No existing rows to link — generated without PDF run-match.");
      }

      onReplaceTransactions(generated, `advancedGenerator ${bank} replace`);
      setLastSeed(bundle.seed);
      if (edits.length && onAddPdfEdits) {
        onAddPdfEdits(edits);
        toast.success("Font-replicated edits linked", {
          description: `${edits.length} text-run replacement(s) queued`,
        });
      }

      onAudit?.(
        "note",
        `advancedGenerator bank=${bank}: ${generated.length} txns seed=${bundle.seed} close=${bundle.closingBalance}`,
      );
    } finally {
      setBusy(false);
    }
  };

  /** Replace original row descriptions with bank generators + geometry PdfEdits. */
  const runBankDescReplace = async () => {
    if (transactions.length === 0) {
      toast.message("No transactions", {
        description: "Parse a statement first, then replace descriptions.",
      });
      return;
    }
    setBusy(true);
    setLinkStats(null);
    try {
      const result = await replaceStatementDataWithGeneration({
        transactions,
        pdfBytes: pdfBytes ? cloneUint8Array(pdfBytes) : null,
        bank,
        replace: ["description"],
      });
      onReplaceTransactions(
        result.transactions,
        `pymupdf-replace bank=${result.bank}`,
      );
      if (result.edits.length && onAddPdfEdits) {
        onAddPdfEdits(result.edits);
      }
      setLinkStats(
        `${result.note} · ${result.linkStats.descriptionEdits} description edits · mode=${result.mode}`,
      );
      onAudit?.(
        "note",
        `pymupdf-replace bank=${result.bank}: ${result.edits.length} PdfEdits, ${result.transactions.length} rows`,
      );
      toast.success(`Replaced descriptions (${BANK_LABELS[result.bank]})`, {
        description:
          result.edits.length > 0
            ? `${result.edits.length} PDF text-run edit(s) queued — Export PDF to apply`
            : "Table updated (no geometry links)",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Replace failed";
      toast.error("Bank description replace failed", { description: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Uses <strong>transactionalDescriptionGenerator</strong> (ANZ/CBA/Westpac/…)
        for bank-authentic text, then links PDF text-run bboxes for replica
        export. Native Pro rewrite:{" "}
        <code className="text-[10px] break-all">{pymupdfCliHint(bank, seed)}</code>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Bank generator">
          <Select value={bank} onValueChange={(v) => setBank(v as BankId)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BANK_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {BANK_LABELS[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Locale">
          <Select value={locale} onValueChange={(v) => setLocale(v as "au" | "us")}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="au">AU</SelectItem>
              <SelectItem value="us">US</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Count">
          <Input
            type="number"
            min={1}
            max={200}
            className="h-9"
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
          />
        </Field>
        <Field label="Seed">
          <Input
            type="number"
            className="h-9"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Period start">
          <Input
            type="date"
            className="h-9"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="Period end">
          <Input
            type="date"
            className="h-9"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
        <Field label="Opening bal.">
          <Input
            type="number"
            className="h-9"
            value={opening}
            onChange={(e) => setOpening(Number(e.target.value) || 0)}
          />
        </Field>
      </div>
      <Button
        className="rounded-full w-full"
        disabled={busy || transactions.length === 0}
        variant="default"
        onClick={() => void runBankDescReplace()}
      >
        <Shuffle className="mr-2 h-4 w-4" />
        {busy
          ? "Replacing…"
          : `Replace original descriptions (${BANK_LABELS[bank]})`}
      </Button>
      <Button
        className="rounded-full w-full"
        disabled={busy}
        variant="secondary"
        onClick={() => void run()}
      >
        <Wand2 className="mr-2 h-4 w-4" />
        {busy ? "Linking runs…" : "Generate full ledger + font link"}
      </Button>
      {lastSeed != null && (
        <p className="text-[11px] text-muted-foreground">
          Last seed <code>{lastSeed}</code>
        </p>
      )}
      {linkStats && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {linkStats}
        </p>
      )}
    </div>
  );
}

function DatesTab({
  transactions,
  onReplaceTransactions,
  onAudit,
}: {
  transactions: Transaction[];
  onReplaceTransactions: (txns: Transaction[], label: string) => void;
  onAudit?: (type: string, message: string) => void;
}) {
  const [days, setDays] = useState(30);
  const bounds = periodBounds(transactions);

  const apply = (delta: number) => {
    const { transactions: next, shifted, skipped } = shiftTransactionDates(
      transactions,
      delta,
    );
    onReplaceTransactions(next, `date shift ${delta > 0 ? "+" : ""}${delta}d`);
    onAudit?.(
      "note",
      `Date period shift ${delta}d: ${shifted} shifted, ${skipped} skipped`,
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Shift all ISO dates forward or backward. Current period:{" "}
        <strong className="tabular-nums">
          {bounds.start ?? "—"} → {bounds.end ?? "—"}
        </strong>
      </p>
      <Field label="Days">
        <Input
          type="number"
          className="h-9"
          value={days}
          onChange={(e) => setDays(Number(e.target.value) || 0)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => apply(-Math.abs(days))}
          disabled={!transactions.length}
        >
          <CalendarRange className="mr-2 h-4 w-4" />
          Shift −{Math.abs(days)}d
        </Button>
        <Button
          className="rounded-full"
          onClick={() => apply(Math.abs(days))}
          disabled={!transactions.length}
        >
          <CalendarRange className="mr-2 h-4 w-4" />
          Shift +{Math.abs(days)}d
        </Button>
      </div>
    </div>
  );
}

function FontsTab({
  pdfBytes,
  onAudit,
}: {
  pdfBytes: Uint8Array | null;
  onAudit?: (type: string, message: string) => void;
}) {
  const [query, setQuery] = useState("Helvetica-Bold");
  const [report, setReport] = useState<ReturnType<typeof analyzeFonts> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const completed = completeFontName(query);

  const runAnalyze = async () => {
    if (!pdfBytes) return;
    setBusy(true);
    try {
      const runs = await getPageTextRunsFromBytes(cloneUint8Array(pdfBytes), 2);
      const r = analyzeFonts(runs);
      setReport(r);
      onAudit?.("note", `Font analysis: ${r.summary}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Font analysis / completion. CLI:{" "}
        <code className="text-[10px]">npm run font-cli -- complete Helvetica</code>
      </p>
      <Field label="Complete font name">
        <Input
          className="h-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Field>
      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs space-y-1">
        <p>
          <span className="text-muted-foreground">Donor:</span>{" "}
          <span className="font-medium">{completed.family}</span>
        </p>
        <p className="text-muted-foreground tabular-nums">
          weight {completed.weight} · {completed.style} · {completed.stretch}
        </p>
      </div>
      <Button
        variant="outline"
        className="rounded-full w-full"
        disabled={!pdfBytes || busy}
        onClick={() => void runAnalyze()}
      >
        <Type className="mr-2 h-4 w-4" />
        {busy ? "Analyzing…" : "Analyze PDF fonts"}
      </Button>
      {report && (
        <ScrollArea className="h-[160px] rounded-lg border border-border/60">
          <ul className="divide-y divide-border/40 text-xs">
            {report.samples.slice(0, 20).map((s) => (
              <li key={s.fontName} className="px-3 py-2">
                <p className="font-medium truncate">{s.fontName}</p>
                <p className="text-muted-foreground tabular-nums">
                  ×{s.count} · avg {s.avgSize.toFixed(1)}px → {s.spec.family}
                </p>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}

function DocAiTab({ onAudit }: { onAudit?: (type: string, message: string) => void }) {
  const [snap, setSnap] = useState<Awaited<
    ReturnType<typeof fetchDocAiAdminSnapshot>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [trainName, setTrainName] = useState("statement-v1");
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const s = await fetchDocAiAdminSnapshot();
      setSnap(s);
      onAudit?.("note", `Doc AI admin: ${s.versions.length} version(s)`);
    } finally {
      setBusy(false);
    }
  };

  const train = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await trainProcessorVersion({ displayName: trainName });
      setMsg(r.message);
      onAudit?.("note", r.message);
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const deploy = async (name: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await deployProcessorVersion(name);
      setMsg(r.message);
      onAudit?.("note", r.message);
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Document AI admin — list / train / deploy processor versions in-app.
        Requires Google Doc AI env credentials.
      </p>
      <Button
        variant="outline"
        className="rounded-full w-full"
        disabled={busy}
        onClick={() => void refresh()}
      >
        <Cpu className="mr-2 h-4 w-4" />
        {busy ? "Loading…" : "Refresh versions"}
      </Button>
      {snap && (
        <div className="space-y-2">
          <Badge variant={snap.configured ? "secondary" : "outline"}>
            {snap.configured ? "configured" : "needs config"}
          </Badge>
          {snap.processorPath && (
            <p className="text-[10px] text-muted-foreground break-all">
              {snap.processorPath}
            </p>
          )}
          {snap.error && (
            <p className="text-xs text-destructive">{snap.error}</p>
          )}
          <ScrollArea className="h-[120px] rounded-lg border border-border/60">
            <ul className="divide-y divide-border/40 text-xs">
              {snap.versions.map((v) => (
                <li
                  key={v.name}
                  className="px-3 py-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {v.displayName || v.name.split("/").pop()}
                    </p>
                    <p className="text-muted-foreground">{v.state ?? "—"}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px] shrink-0"
                    disabled={busy}
                    onClick={() => void deploy(v.name)}
                  >
                    Deploy
                  </Button>
                </li>
              ))}
              {snap.versions.length === 0 && !snap.error && (
                <li className="px-3 py-4 text-muted-foreground text-center">
                  No versions returned
                </li>
              )}
            </ul>
          </ScrollArea>
        </div>
      )}
      <Field label="Train display name">
        <Input
          className="h-9"
          value={trainName}
          onChange={(e) => setTrainName(e.target.value)}
        />
      </Field>
      <Button
        className="rounded-full w-full"
        disabled={busy}
        onClick={() => void train()}
      >
        Train new version
      </Button>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}

function GeometryTab({
  pdfBytes,
  onReplaceTransactions,
  onAudit,
}: {
  pdfBytes: Uint8Array | null;
  onReplaceTransactions: (txns: Transaction[], label: string) => void;
  onAudit?: (type: string, message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);

  const run = async () => {
    if (!pdfBytes) return;
    setBusy(true);
    try {
      const runs = await getPageTextRunsFromBytes(cloneUint8Array(pdfBytes), 5);
      const geoRuns: GeometryRun[] = runs.map((r) => ({
        text: r.text,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        page: r.page,
        fontName: r.fontName,
      }));
      const result = extractWithHybridGeometry(geoRuns);
      setNotes(result.notes);
      if (result.transactions.length) {
        onReplaceTransactions(
          result.transactions,
          "hybrid geometry extraction",
        );
      }
      onAudit?.(
        "note",
        `Hybrid geometry: ${result.transactions.length} rows · ${result.template.name}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Hybrid geometry extraction — cluster text runs by Y, apply bank YAML
        templates + amount heuristics.
      </p>
      <Button
        className="rounded-full w-full"
        disabled={!pdfBytes || busy}
        onClick={() => void run()}
      >
        <Shuffle className="mr-2 h-4 w-4" />
        {busy ? "Extracting…" : "Run hybrid geometry"}
      </Button>
      {notes.length > 0 && (
        <ul className="text-[11px] text-muted-foreground space-y-1">
          {notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RemoteTab({
  pdfBytes,
  fileName,
  engineMode,
  onEngineModeChange,
  onReplaceTransactions,
  onAudit,
}: {
  pdfBytes: Uint8Array | null;
  fileName: string;
  engineMode: EngineMode;
  onEngineModeChange: (mode: EngineMode) => void;
  onReplaceTransactions: (txns: Transaction[], label: string) => void;
  onAudit?: (type: string, message: string) => void;
}) {
  const [url, setUrl] = useState(
    () =>
      (typeof localStorage !== "undefined" &&
        localStorage.getItem("statement-lens.remote-engine-url")) ||
      "",
  );
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setModeAndSave = (m: EngineMode) => {
    saveEngineMode(m);
    onEngineModeChange(m);
    onAudit?.(
      "note",
      m === "remote"
        ? "Remote engine mode ON — main upload pipeline uses hosted /v1/parse"
        : "Local engine mode — main upload uses document parsers",
    );
  };

  const probe = async () => {
    if (url) saveRemoteEngineUrl(url);
    setBusy(true);
    try {
      const r = await probeRemoteEngine(url || undefined);
      setStatus(r.ok ? `✅ ${r.detail}` : `❌ ${r.detail}`);
    } finally {
      setBusy(false);
    }
  };

  const runRemote = async () => {
    if (!pdfBytes) return;
    if (url) saveRemoteEngineUrl(url);
    setBusy(true);
    setStatus(null);
    try {
      const res = await remoteParsePdf({
        fileName,
        bytes: pdfBytes,
        onProgress: (m) => setStatus(m),
      });
      if (res.transactions.length) {
        onReplaceTransactions(res.transactions, "remote engine parse");
      }
      setStatus(
        `Remote ok · ${res.transactions.length} txns · engine ${res.engine ?? "remote"}`,
      );
      onAudit?.(
        "note",
        `Remote engine: ${res.transactions.length} transactions`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Remote engine mode — thin client to hosted backend (
        <code className="text-[10px]">POST /v1/parse</code>). When{" "}
        <strong>Remote</strong> is selected, the <strong>main upload
        pipeline</strong> uses the hosted engine automatically.
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={engineMode === "local" ? "default" : "outline"}
          className="rounded-full flex-1"
          onClick={() => setModeAndSave("local")}
        >
          Local
        </Button>
        <Button
          size="sm"
          variant={engineMode === "remote" ? "default" : "outline"}
          className="rounded-full flex-1"
          onClick={() => setModeAndSave("remote")}
        >
          Remote
        </Button>
      </div>
      <Field label="Remote engine URL">
        <Input
          className="h-9"
          placeholder="https://engine.example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="rounded-full"
          disabled={busy}
          onClick={() => void probe()}
        >
          <Cloud className="mr-2 h-4 w-4" />
          Probe
        </Button>
        <Button
          className="rounded-full"
          disabled={!pdfBytes || busy}
          onClick={() => void runRemote()}
        >
          Parse remote
        </Button>
      </div>
      {status && (
        <p
          className={cn(
            "text-xs",
            status.startsWith("❌") ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {status}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
