import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  Upload,
  AlertTriangle,
  XCircle,
  ChevronDown,
  FlaskConical,
  ShieldCheck,
  Shuffle,
} from "lucide-react";
import {
  analyzeGenerationQuality,
  BILL_CATEGORY_OPTIONS,
  categoryDistribution,
  defaultStatementConfig,
  downloadLedgerCsv,
  formatCapHint,
  generateStatement,
  largestTransactions,
  ledgerToAppTransactions,
  normalizeStatementConfig,
  overridesFromConfig,
  setVariableKeys,
  type Frequency,
  type GenCategory,
  type GenerationQualityReport,
  type GenerationResult,
  type StatementConfig,
} from "@/lib/statement-gen";
import {
  formatDashboardDate,
  formatMoneyDisplay,
} from "@/lib/statement-gen/format";
import { unredactStatementVariables } from "@/lib/tools/chrome-unredact";
import { StatementPrintView } from "@/components/StatementPrintView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { PdfEdit, Transaction } from "@/lib/types";
import { toast } from "sonner";

interface StatementGeneratorDashboardProps {
  onApplyToWorkspace: (
    txns: Transaction[],
    label: string,
    extras?: { pdfEdits?: PdfEdit[]; config?: StatementConfig },
  ) => void;
  onAudit?: (message: string) => void;
  /** Notified whenever live generation quality changes (Test Lab). */
  onQualityChange?: (report: GenerationQualityReport) => void;
  /** After apply — continue Test Lab path. */
  onAppliedAndContinue?: () => void;
  /** Optional bank-desc replace (when PDF present). */
  onBankReplaceRequest?: () => void;
  hasPdfBytes?: boolean;
  pdfEditCount?: number;
  /** Original PDF for Unredacter chrome injection. */
  pdfBytes?: Uint8Array | null;
}

const FREQ: Frequency[] = ["none", "weekly", "fortnightly", "monthly"];

export function StatementGeneratorDashboard({
  onApplyToWorkspace,
  onAudit,
  onQualityChange,
  onAppliedAndContinue,
  onBankReplaceRequest,
  hasPdfBytes,
  pdfEditCount = 0,
  pdfBytes = null,
}: StatementGeneratorDashboardProps) {
  const [config, setConfig] = useState<StatementConfig>(() =>
    defaultStatementConfig(),
  );
  const [showPrint, setShowPrint] = useState(false);
  const [showQualityDetail, setShowQualityDetail] = useState(true);
  const [applyBusy, setApplyBusy] = useState(false);

  const result: GenerationResult = useMemo(
    () => generateStatement(config),
    [config],
  );

  const quality = useMemo(
    () => analyzeGenerationQuality(result, config),
    [result, config],
  );

  useEffect(() => {
    onQualityChange?.(quality);
  }, [quality, onQualityChange]);

  const cats = useMemo(
    () => categoryDistribution(result.rows).slice(0, 8),
    [result.rows],
  );

  const largest = useMemo(
    () => largestTransactions(result.rows, 5),
    [result.rows],
  );

  /** Patch top-level cfg and re-normalize aliases/shares. */
  const patch = (partial: Partial<StatementConfig>) => {
    setConfig((c) => normalizeStatementConfig({ ...c, ...partial }));
  };

  const patchAccount = (partial: Partial<StatementConfig["account"]>) => {
    setConfig((c) =>
      normalizeStatementConfig({
        ...c,
        account: { ...c.account, ...partial },
      }),
    );
  };

  const patchAddress = (partial: Partial<StatementConfig["address"]>) => {
    setConfig((c) =>
      normalizeStatementConfig({
        ...c,
        address: { ...c.address, ...partial },
      }),
    );
  };

  const patchEntity = (partial: Partial<StatementConfig["entity"]>) => {
    setConfig((c) =>
      normalizeStatementConfig({
        ...c,
        entity: { ...c.entity, ...partial },
      }),
    );
  };

  const toggleBillCategory = (cat: GenCategory) => {
    setConfig((c) => {
      const set = new Set(c.selectedBillCategories);
      if (set.has(cat)) set.delete(cat);
      else set.add(cat);
      return normalizeStatementConfig({
        ...c,
        selectedBillCategories: Array.from(set),
      });
    });
  };

  const applyToWorkspace = async (andContinue: boolean) => {
    if (applyBusy) return;
    setApplyBusy(true);
    try {
      const txns = ledgerToAppTransactions(result.rows);
      let pdfEdits: PdfEdit[] = [];
      // Unredacter: optional variables that are set → PDF chrome text insert (NEVER blank redaction)
      if (pdfBytes && pdfBytes.byteLength > 0) {
        const overrides = overridesFromConfig(config);
        const setKeys = setVariableKeys(overrides);
        if (setKeys.length > 0) {
          const un = await unredactStatementVariables({
            pdfBytes,
            overrides,
          });
          pdfEdits = un.edits;
          onAudit?.(
            `Unredacter: ${un.edits.length} chrome edit(s) · ${un.appliedKeys.join(", ") || "none linked"} · ${un.notes.slice(-1)[0] ?? ""}`,
          );
          if (un.edits.length > 0) {
            toast.success("Unredacter queued", {
              description: `${un.edits.length} identity/address field(s) — replace with text, never blank redaction`,
            });
          } else if (un.unmatchedKeys.length > 0) {
            toast.message("Variables set on ledger", {
              description: `Chrome unmatched on PDF: ${un.unmatchedKeys.join(", ")} — salary/savings/mortgage still in generated rows`,
            });
          }
        }
      }
      onApplyToWorkspace(txns, "Apply generated statement", {
        pdfEdits,
        config,
      });
      onAudit?.(
        `Applied generated statement: ${txns.length} rows · quality ${quality.grade} ${quality.score}/100 · unredactEdits=${pdfEdits.length}`,
      );
      if (andContinue) onAppliedAndContinue?.();
    } finally {
      setApplyBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-primary" />
              Statement generation · Test Lab
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
              Optional variables (identity, address, salary, savings, mortgage)
              — if set, they drive the generated ledger and Unredacter PDF
              inject (replace with text, never blank redaction). Leave defaults
              or clear a field to skip override.
            </p>
            <p className="text-[10px] text-muted-foreground mt-1 font-mono">
              {formatCapHint(config)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => {
                downloadLedgerCsv(
                  result.rows,
                  `statement-${config.periodStart}.csv`,
                );
                onAudit?.("Exported statement generation CSV");
              }}
            >
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
              CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => setShowPrint((v) => !v)}
            >
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              {showPrint ? "Hide print" : "Print view"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              disabled={!quality.ok || applyBusy}
              onClick={() => void applyToWorkspace(false)}
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              {applyBusy ? "Applying…" : "Apply to table"}
            </Button>
            <Button
              size="sm"
              className="rounded-full"
              disabled={!quality.ok || applyBusy}
              onClick={() => void applyToWorkspace(true)}
            >
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              {applyBusy ? "Applying…" : "Apply & continue test"}
            </Button>
          </div>
        </div>
      </div>

      {/* Quality scoreboard */}
      <div
        className={cn(
          "rounded-2xl border p-4 space-y-3",
          quality.ok
            ? "border-emerald-500/35 bg-emerald-500/8"
            : "border-destructive/40 bg-destructive/5",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {quality.ok ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <XCircle className="h-5 w-5 text-destructive" />
            )}
            <div>
              <p className="text-sm font-semibold">
                Perfect generation: {quality.ok ? "PASS" : "FAIL"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Grade {quality.grade} · {quality.score}/100 ·{" "}
                {quality.checks.filter((c) => c.severity === "pass").length}/
                {quality.checks.length} checks · chrono{" "}
                {quality.validation.chronological ? "✓" : "✗"} · balances{" "}
                {quality.validation.balanceConsistent ? "✓" : "✗"} · dupes{" "}
                {quality.validation.noSameDayDupes ? "✓" : "✗"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={quality.ok ? "default" : "destructive"}>
              {quality.grade} {quality.score}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px]"
              onClick={() => setShowQualityDetail((v) => !v)}
            >
              {showQualityDetail ? "Hide checks" : "Show checks"}
            </Button>
          </div>
        </div>
        {showQualityDetail && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {quality.checks.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-[10px]",
                  c.severity === "pass" &&
                    "border-emerald-500/25 bg-emerald-500/5",
                  c.severity === "warning" &&
                    "border-amber-500/30 bg-amber-500/5",
                  c.severity === "error" &&
                    "border-destructive/30 bg-destructive/5",
                )}
              >
                <p className="font-semibold flex items-center gap-1">
                  {c.severity === "pass" ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  ) : c.severity === "error" ? (
                    <XCircle className="h-3 w-3 text-destructive" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                  )}
                  {c.label}
                </p>
                <p className="text-muted-foreground mt-0.5 leading-snug">
                  {c.detail}
                </p>
              </div>
            ))}
          </div>
        )}
        {hasPdfBytes && onBankReplaceRequest && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full text-xs"
              onClick={onBankReplaceRequest}
            >
              <Shuffle className="mr-1.5 h-3.5 w-3.5" />
              Bank-desc replace + font link
              {pdfEditCount > 0 ? ` (${pdfEditCount} edits)` : ""}
            </Button>
            <span className="text-[10px] text-muted-foreground">
              Rewrites descriptions with ANZ/CBA/… generators and queues PdfEdits
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Card
          label="Credits"
          value={formatMoneyDisplay(result.summary.totalCredits)}
          tone="in"
        />
        <Card
          label="Debits"
          value={formatMoneyDisplay(result.summary.totalDebits)}
          tone="out"
        />
        <Card
          label="Closing"
          value={formatMoneyDisplay(result.summary.closingBalance)}
        />
        <Card
          label="Transactions"
          value={String(result.summary.transactionCount)}
        />
      </div>

      <div className="grid lg:grid-cols-[360px_1fr] gap-4">
        {/* ── Config panel ───────────────────────────────────────── */}
        <div className="rounded-2xl border border-border/70 bg-card/80 p-3 shadow-sm h-fit space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Configuration
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px]"
              onClick={() => setConfig(defaultStatementConfig())}
            >
              <RefreshCw className="mr-1 h-3 w-3" />
              Reset
            </Button>
          </div>

          <ScrollArea className="h-[min(70vh,720px)] pr-2">
            <div className="space-y-2 pb-2">
              {/* Period & balances */}
              <CfgSection title="Period & balances" defaultOpen>
                <Field label="startDate">
                  <Input
                    type="date"
                    className="h-9"
                    value={config.periodStart}
                    onChange={(e) => patch({ periodStart: e.target.value })}
                  />
                </Field>
                <Field label="durationDays">
                  <Input
                    type="number"
                    min={7}
                    max={92}
                    className="h-9"
                    value={config.periodDays}
                    onChange={(e) =>
                      patch({
                        periodDays: Math.max(7, Number(e.target.value) || 30),
                      })
                    }
                  />
                </Field>
                <Field label="openingBalance">
                  <Input
                    type="number"
                    step="0.01"
                    className="h-9"
                    value={config.openingBalance}
                    onChange={(e) =>
                      patch({ openingBalance: Number(e.target.value) || 0 })
                    }
                  />
                </Field>
                <Field label="savingsOpeningBalance">
                  <Input
                    type="number"
                    step="0.01"
                    className="h-9"
                    value={config.savingsOpeningBalance}
                    onChange={(e) =>
                      patch({
                        savingsOpeningBalance: Number(e.target.value) || 0,
                      })
                    }
                  />
                </Field>
                <Field label="interestRate (% p.a.)">
                  <Input
                    type="number"
                    step="0.01"
                    className="h-9"
                    value={config.account.interestRate}
                    onChange={(e) =>
                      patchAccount({
                        interestRate: Number(e.target.value) || 0,
                      })
                    }
                  />
                </Field>
                <Field label="seed">
                  <Input
                    type="number"
                    className="h-9"
                    value={config.seed}
                    onChange={(e) =>
                      patch({ seed: Number(e.target.value) || 0 })
                    }
                  />
                </Field>
              </CfgSection>

              {/* Account / identity — optional Unredacter chrome */}
              <CfgSection title="Account / identity (optional · Unredacter)" defaultOpen>
                <p className="text-[10px] text-muted-foreground col-span-full leading-snug px-0.5">
                  If set, values appear on the generated statement and are
                  written onto the PDF as text inserts (never blank redaction).
                </p>
                <Field label="holderName">
                  <Input
                    className="h-9"
                    value={config.account.holderName}
                    placeholder="Optional"
                    onChange={(e) =>
                      patchAccount({ holderName: e.target.value })
                    }
                  />
                </Field>
                <Field label="accountName">
                  <Input
                    className="h-9"
                    value={config.account.accountName}
                    placeholder="Optional"
                    onChange={(e) =>
                      patchAccount({ accountName: e.target.value })
                    }
                  />
                </Field>
                <Field label="brandLabel">
                  <Input
                    className="h-9"
                    value={config.account.brandLabel}
                    onChange={(e) =>
                      patchAccount({ brandLabel: e.target.value })
                    }
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="bsb">
                    <Input
                      className="h-9"
                      value={config.account.bsb}
                      placeholder="062-000"
                      onChange={(e) =>
                        patchAccount({
                          bsb: e.target.value,
                          bsbCode: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="bsbCode">
                    <Input
                      className="h-9"
                      value={config.account.bsbCode}
                      placeholder="alias of bsb"
                      onChange={(e) =>
                        patchAccount({
                          bsbCode: e.target.value,
                          bsb: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="accountNumber">
                    <Input
                      className="h-9"
                      value={config.account.accountNumber}
                      placeholder="Optional"
                      onChange={(e) =>
                        patchAccount({ accountNumber: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <Field label="customerID / customerNumber">
                  <Input
                    className="h-9"
                    value={config.account.customerID}
                    onChange={(e) =>
                      patchAccount({ customerID: e.target.value })
                    }
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="everydayBsb">
                    <Input
                      className="h-9"
                      value={config.account.everydayBsb}
                      onChange={(e) =>
                        patchAccount({ everydayBsb: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="everydayAccount">
                    <Input
                      className="h-9"
                      value={config.account.everydayAccount}
                      onChange={(e) =>
                        patchAccount({ everydayAccount: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="bonusBsb">
                    <Input
                      className="h-9"
                      value={config.account.bonusBsb}
                      onChange={(e) =>
                        patchAccount({ bonusBsb: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="bonusAccount">
                    <Input
                      className="h-9"
                      value={config.account.bonusAccount}
                      onChange={(e) =>
                        patchAccount({ bonusAccount: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <Field label="branch">
                  <Input
                    className="h-9"
                    value={config.account.branch}
                    onChange={(e) =>
                      patchAccount({ branch: e.target.value })
                    }
                  />
                </Field>
                <Field label="timezone">
                  <Input
                    className="h-9"
                    value={config.account.timezone}
                    onChange={(e) =>
                      patchAccount({ timezone: e.target.value })
                    }
                    placeholder="Australia/Sydney"
                  />
                </Field>
              </CfgSection>

              {/* Address / location — optional Unredacter */}
              <CfgSection title="Address / location (optional · Unredacter)">
                <Field label="addressLine1">
                  <Input
                    className="h-9"
                    value={config.address.addressLine1}
                    placeholder="Optional street"
                    onChange={(e) =>
                      patchAddress({ addressLine1: e.target.value })
                    }
                  />
                </Field>
                <Field label="addressLine2">
                  <Input
                    className="h-9"
                    value={config.address.addressLine2}
                    placeholder="Optional suburb / city"
                    onChange={(e) =>
                      patchAddress({ addressLine2: e.target.value })
                    }
                  />
                </Field>
                <Field label="addressStreet">
                  <Input
                    className="h-9"
                    value={config.address.addressStreet}
                    onChange={(e) =>
                      patchAddress({ addressStreet: e.target.value })
                    }
                  />
                </Field>
                <Field label="addressCity">
                  <Input
                    className="h-9"
                    value={config.address.addressCity}
                    onChange={(e) =>
                      patchAddress({ addressCity: e.target.value })
                    }
                  />
                </Field>
                <Field label="entityName">
                  <Input
                    className="h-9"
                    value={config.entity.entityName}
                    onChange={(e) =>
                      patchEntity({ entityName: e.target.value })
                    }
                  />
                </Field>
                <Field label="entityAddress">
                  <Input
                    className="h-9"
                    value={config.entity.entityAddress}
                    onChange={(e) =>
                      patchEntity({ entityAddress: e.target.value })
                    }
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="entityCity">
                    <Input
                      className="h-9"
                      value={config.entity.entityCity}
                      onChange={(e) =>
                        patchEntity({ entityCity: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="entityState">
                    <Input
                      className="h-9"
                      value={config.entity.entityState}
                      onChange={(e) =>
                        patchEntity({ entityState: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <Field label="entityCountry">
                  <Input
                    className="h-9"
                    value={config.entity.entityCountry}
                    onChange={(e) =>
                      patchEntity({ entityCountry: e.target.value })
                    }
                  />
                </Field>
              </CfgSection>

              {/* Salary / income — optional; if set, rows use these values */}
              <CfgSection title="Salary / income (optional · generator)" defaultOpen>
                <Field label="salaryDescription">
                  <Input
                    className="h-9"
                    value={config.salaryDescription}
                    placeholder="If set → salary rows"
                    onChange={(e) =>
                      patch({ salaryDescription: e.target.value })
                    }
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="salaryAmount">
                    <Input
                      type="number"
                      step="0.01"
                      className="h-9"
                      value={config.salaryAmount}
                      onChange={(e) =>
                        patch({ salaryAmount: Number(e.target.value) || 0 })
                      }
                    />
                  </Field>
                  <Field label="salaryFrequency">
                    <FreqSelect
                      value={config.salaryFrequency}
                      onChange={(f) => patch({ salaryFrequency: f })}
                    />
                  </Field>
                </div>
                <Field label="salaryAccount">
                  <Input
                    className="h-9"
                    value={config.salaryAccount}
                    onChange={(e) =>
                      patch({ salaryAccount: e.target.value })
                    }
                  />
                </Field>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <Label className="text-xs">hasRentalIncome</Label>
                  <Switch
                    checked={config.hasRentalIncome}
                    onCheckedChange={(v) => patch({ hasRentalIncome: v })}
                  />
                </div>
                {config.hasRentalIncome && (
                  <>
                    <Field label="rentalDescription">
                      <Input
                        className="h-9"
                        value={config.rentalDescription}
                        onChange={(e) =>
                          patch({ rentalDescription: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="rentalAmount">
                      <Input
                        type="number"
                        step="0.01"
                        className="h-9"
                        value={config.rentalAmount}
                        onChange={(e) =>
                          patch({
                            rentalAmount: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </Field>
                  </>
                )}
              </CfgSection>

              {/* Savings — optional */}
              <CfgSection title="Savings (optional · generator)">
                <Field label="savingsDescription">
                  <Input
                    className="h-9"
                    value={config.savingsDescription}
                    placeholder="If set → savings rows"
                    onChange={(e) =>
                      patch({ savingsDescription: e.target.value })
                    }
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="savingsAmount">
                    <Input
                      type="number"
                      step="0.01"
                      className="h-9"
                      value={config.savingsAmount}
                      onChange={(e) =>
                        patch({ savingsAmount: Number(e.target.value) || 0 })
                      }
                    />
                  </Field>
                  <Field label="savingsFrequency">
                    <FreqSelect
                      value={config.savingsFrequency}
                      onChange={(f) => patch({ savingsFrequency: f })}
                    />
                  </Field>
                </div>
                <Field label="savingsAccount">
                  <Input
                    className="h-9"
                    value={config.savingsAccount}
                    onChange={(e) =>
                      patch({ savingsAccount: e.target.value })
                    }
                  />
                </Field>
              </CfgSection>

              {/* Mortgage / rent — optional */}
              <CfgSection title="Mortgage / rent (optional · generator)">
                <Field label="mortgageDescription">
                  <Input
                    className="h-9"
                    value={config.mortgageDescription}
                    placeholder="If set → mortgage rows"
                    onChange={(e) =>
                      patch({ mortgageDescription: e.target.value })
                    }
                  />
                </Field>
                <Field label="mortgageLender">
                  <Input
                    className="h-9"
                    value={config.mortgageLender}
                    placeholder="Optional lender"
                    onChange={(e) =>
                      patch({ mortgageLender: e.target.value })
                    }
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="mortgageAmount">
                    <Input
                      type="number"
                      step="0.01"
                      className="h-9"
                      value={config.mortgageAmount}
                      onChange={(e) =>
                        patch({
                          mortgageAmount: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </Field>
                  <Field label="mortgageFrequency">
                    <FreqSelect
                      value={config.mortgageFrequency}
                      onChange={(f) => patch({ mortgageFrequency: f })}
                    />
                  </Field>
                </div>
                <Field label="loanReference">
                  <Input
                    className="h-9"
                    value={config.loanReference}
                    onChange={(e) =>
                      patch({ loanReference: e.target.value })
                    }
                  />
                </Field>
              </CfgSection>

              {/* Card & spending */}
              <CfgSection title="Card & spending controls" defaultOpen>
                <Field label="cardLast4">
                  <Input
                    className="h-9"
                    maxLength={4}
                    value={config.cardLast4}
                    onChange={(e) =>
                      patch({
                        cardLast4: e.target.value.replace(/\D/g, "").slice(0, 4),
                      })
                    }
                  />
                </Field>
                <Field label="cardSpendPct (% of income)">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="h-9"
                    value={config.cardSpendPct}
                    onChange={(e) =>
                      patch({
                        cardSpendPct: Math.min(
                          100,
                          Math.max(0, Number(e.target.value) || 0),
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="billsSubsPct (% of income)">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="h-9"
                    value={config.billsSubsPct}
                    onChange={(e) =>
                      patch({
                        billsSubsPct: Math.min(
                          100,
                          Math.max(0, Number(e.target.value) || 0),
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="billSpendMultiplier">
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    step={0.05}
                    className="h-9"
                    value={config.billSpendMultiplier}
                    onChange={(e) =>
                      patch({
                        billSpendMultiplier: Math.max(
                          0,
                          Number(e.target.value) || 1,
                        ),
                      })
                    }
                  />
                </Field>
              </CfgSection>

              {/* Direct debits / bills */}
              <CfgSection title="Direct debits / bills" defaultOpen>
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">hasDirectDebits</Label>
                  <Switch
                    checked={config.hasDirectDebits}
                    onCheckedChange={(v) => patch({ hasDirectDebits: v })}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">hasSubscriptions</Label>
                  <Switch
                    checked={config.hasSubscriptions}
                    onCheckedChange={(v) => patch({ hasSubscriptions: v })}
                  />
                </div>
                <div className="space-y-1.5 pt-1">
                  <Label className="text-[11px] text-muted-foreground">
                    selectedBillCategories
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {BILL_CATEGORY_OPTIONS.map((cat) => {
                      const on = config.selectedBillCategories.includes(cat);
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => toggleBillCategory(cat)}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                            on
                              ? "border-primary bg-primary/15 text-foreground"
                              : "border-border/60 text-muted-foreground hover:bg-muted/40",
                          )}
                        >
                          {cat}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </CfgSection>
            </div>
          </ScrollArea>
        </div>

        {/* Live ledger + side stats */}
        <div className="space-y-3 min-w-0">
          <div className="rounded-2xl border border-border/70 bg-card/80 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/60 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold">
                Live ledger · {formatDashboardDate(config.periodStart)} –{" "}
                {formatDashboardDate(result.periodEnd)}
              </p>
              <Badge variant="secondary" className="text-[10px] tabular-nums">
                expected income{" "}
                {formatMoneyDisplay(result.summary.expectedIncome)}
              </Badge>
            </div>
            <ScrollArea className="h-[min(52vh,520px)]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card/95 backdrop-blur z-10">
                  <tr className="text-left text-muted-foreground border-b border-border/60">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium text-right">Amount</th>
                    <th className="px-3 py-2 font-medium text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border/40 hover:bg-muted/30"
                    >
                      <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">
                        {formatDashboardDate(r.date)}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="font-medium">{r.description}</span>
                        {r.secondaryDescription && (
                          <span className="block text-[10px] text-muted-foreground">
                            {r.secondaryDescription}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge
                          variant="outline"
                          className="text-[9px] font-normal"
                        >
                          {r.category}
                        </Badge>
                      </td>
                      <td
                        className={cn(
                          "px-3 py-1.5 text-right tabular-nums",
                          r.amount > 0 && "money-in",
                          r.amount < 0 && "money-out",
                        )}
                      >
                        {r.amount === 0
                          ? "—"
                          : formatMoneyDisplay(r.amount)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {formatMoneyDisplay(r.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-border/60 bg-card/70 p-3">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">
                Categories
              </p>
              <ul className="space-y-1 text-xs">
                {cats.map((c) => (
                  <li
                    key={c.category}
                    className="flex justify-between gap-2 tabular-nums"
                  >
                    <span className="truncate">{c.category}</span>
                    <span className="text-muted-foreground">
                      {c.count} · {formatMoneyDisplay(c.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/70 p-3">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">
                Largest
              </p>
              <ul className="space-y-1 text-xs">
                {largest.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <span className="truncate">{r.description}</span>
                    <span
                      className={cn(
                        "tabular-nums shrink-0",
                        r.amount > 0 ? "money-in" : "money-out",
                      )}
                    >
                      {formatMoneyDisplay(r.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {showPrint && (
        <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">Paginated print preview (A4)</p>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => window.print()}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Print / PDF
            </Button>
          </div>
          <StatementPrintView result={result} />
        </div>
      )}
    </div>
  );
}

function CfgSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-xl border border-border/60 bg-background/40 overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/30"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 border-t border-border/50 px-3 py-2.5">
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "in" | "out";
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 p-3 shadow-sm">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums mt-0.5",
          tone === "in" && "money-in",
          tone === "out" && "money-out",
        )}
      >
        {value}
      </p>
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
      <Label className="text-[11px] text-muted-foreground font-mono">
        {label}
      </Label>
      {children}
    </div>
  );
}

function FreqSelect({
  value,
  onChange,
}: {
  value: Frequency;
  onChange: (f: Frequency) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Frequency)}>
      <SelectTrigger className="h-9 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FREQ.map((f) => (
          <SelectItem key={f} value={f} className="text-xs">
            {f}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
