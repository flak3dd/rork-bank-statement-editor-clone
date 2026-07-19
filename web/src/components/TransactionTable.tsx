import { useMemo, useRef, useEffect } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortDir, SortKey, Transaction, TransactionCategory } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TransactionTableProps {
  transactions: Transaction[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onCategoryChange: (id: string, category: TransactionCategory) => void;
  highlightId?: string | null;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />;
  return dir === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5" />
  );
}

export function TransactionTable({
  transactions,
  sortKey,
  sortDir,
  onSort,
  onCategoryChange,
  highlightId,
}: TransactionTableProps) {
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  useEffect(() => {
    if (!highlightId) return;
    const el = rowRefs.current.get(highlightId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId]);

  const headers = useMemo(
    () =>
      [
        { key: "date" as const, label: "Date", className: "w-[110px]" },
        { key: "description" as const, label: "Description", className: "min-w-[200px]" },
        { key: "debit" as const, label: "Out", className: "w-[110px] text-right" },
        { key: "credit" as const, label: "In", className: "w-[110px] text-right" },
        { key: "balance" as const, label: "Balance", className: "w-[120px] text-right" },
        { key: "category" as const, label: "Category", className: "w-[160px]" },
      ] as const,
    [],
  );

  if (transactions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/80 bg-card/50 p-10 text-center text-sm text-muted-foreground">
        No transactions match your filters.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 shadow-sm overflow-hidden">
      <ScrollArea className="h-[min(62vh,640px)]">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
            <TableRow className="hover:bg-transparent">
              {headers.map((h) => (
                <TableHead key={h.key} className={h.className}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 font-semibold text-foreground"
                    onClick={() => onSort(h.key)}
                  >
                    {h.label}
                    <SortIcon active={sortKey === h.key} dir={sortDir} />
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((t) => {
              const odd = t.flags.length > 0;
              return (
                <TableRow
                  key={t.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(t.id, el);
                    else rowRefs.current.delete(t.id);
                  }}
                  className={cn(
                    odd && "bg-amber-500/5",
                    highlightId === t.id && "bg-primary/10 ring-1 ring-inset ring-primary/30",
                  )}
                >
                  <TableCell className="tabular-nums text-xs sm:text-sm whitespace-nowrap">
                    {t.date}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-snug">{t.description}</p>
                      <div className="flex flex-wrap gap-1">
                        {t.flags.map((f) => (
                          <Badge key={f} variant="outline" className="text-[10px] font-normal">
                            {f}
                          </Badge>
                        ))}
                        {t.categorySource === "ai" && (
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            AI {(t.categoryConfidence * 100).toFixed(0)}%
                          </Badge>
                        )}
                        {t.categorySource === "manual" && (
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            Manual
                          </Badge>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm money-out">
                    {t.debit != null ? formatMoney(t.debit) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm money-in">
                    {t.credit != null ? formatMoney(t.credit) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {t.balance != null ? formatMoney(t.balance) : "—"}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={t.category}
                      onValueChange={(v) => onCategoryChange(t.id, v as TransactionCategory)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c} className="text-xs">
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
