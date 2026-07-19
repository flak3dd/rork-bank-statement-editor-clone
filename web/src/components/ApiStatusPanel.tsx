import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
  Shield,
} from "lucide-react";
import {
  detectApiAvailability,
  type ApiStatusItem,
  type ApiStatusReport,
} from "@/lib/api-status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const GROUP_LABEL: Record<ApiStatusItem["group"], string> = {
  renderer: "Verification renderer",
  visual: "Visual validation (always on)",
  parsers: "Document parsers",
  optional: "Optional cloud",
};

interface ApiStatusPanelProps {
  compact?: boolean;
  className?: string;
  onReport?: (report: ApiStatusReport) => void;
}

export function ApiStatusPanel({
  compact,
  className,
  onReport,
}: ApiStatusPanelProps) {
  const [report, setReport] = useState<ApiStatusReport | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await detectApiAvailability();
      setReport(next);
      onReport?.(next);
    } finally {
      setLoading(false);
    }
  }, [onReport]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groups = (["renderer", "visual", "parsers", "optional"] as const).map(
    (g) => ({
      id: g,
      label: GROUP_LABEL[g],
      items: report?.items.filter((i) => i.group === g) ?? [],
    }),
  );

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-card/80 shadow-sm overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight">API status</p>
            <p className="text-[11px] text-muted-foreground">
              Boot-time availability · Pdfium + SSIM/tile/pHash always local
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {report && (
            <Badge variant="secondary" className="tabular-nums text-[10px]">
              {report.readyCount}/{report.totalCount}
            </Badge>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh API status"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {loading && !report && (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Probing APIs…
        </div>
      )}

      {report && (
        <div className={cn("divide-y divide-border/60", compact && "max-h-[320px] overflow-y-auto")}>
          {groups.map((g) =>
            g.items.length === 0 ? null : (
              <div key={g.id} className="px-4 py-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </p>
                <ul className="space-y-2">
                  {g.items.map((item) => (
                    <StatusRow key={item.id} item={item} compact={compact} />
                  ))}
                </ul>
              </div>
            ),
          )}
          <p className="px-4 py-2 text-[10px] text-muted-foreground">
            Checked {new Date(report.checkedAt).toLocaleTimeString()}
          </p>
        </div>
      )}
    </div>
  );
}

function StatusRow({
  item,
  compact,
}: {
  item: ApiStatusItem;
  compact?: boolean;
}) {
  return (
    <li className="flex items-start gap-2.5">
      {item.ok ? (
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium leading-snug">{item.label}</span>
          <span className="text-[10px] tabular-nums">
            {item.ok ? "✅" : "❌"}
          </span>
        </div>
        {!compact && (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {item.detail}
          </p>
        )}
        {!item.ok && item.signupUrl && (
          <a
            href={item.signupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
          >
            Sign up
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {item.docsUrl && !compact && (
          <a
            href={item.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
          >
            Docs
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </li>
  );
}

/** Compact header strip of ✅/❌ icons for critical services. */
export function ApiStatusStrip({ report }: { report: ApiStatusReport | null }) {
  if (!report) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        API check…
      </span>
    );
  }

  const critical = report.items.filter((i) =>
    ["pdfium", "ssim", "tile-max", "phash", "applitools", "mindee"].includes(
      i.id,
    ),
  );

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      {critical.map((i) => (
        <span
          key={i.id}
          title={`${i.label}: ${i.detail}`}
          className={cn(
            "inline-flex items-center gap-0.5",
            i.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
          )}
        >
          <span aria-hidden>{i.ok ? "✅" : "❌"}</span>
          <span className="hidden lg:inline text-muted-foreground">
            {i.id === "tile-max" ? "tile" : i.id === "phash" ? "pHash" : i.id}
          </span>
        </span>
      ))}
    </div>
  );
}
