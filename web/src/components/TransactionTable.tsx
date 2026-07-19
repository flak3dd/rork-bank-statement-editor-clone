import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  RotateCcw,
  Pencil,
} from "lucide-react";
import type {
  EditableField,
  SortDir,
  SortKey,
  Transaction,
  TransactionCategory,
} from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import {
  applyFieldEdit,
  dirtyFields,
  formatFieldValue,
  isRowDirty,
  revertRow,
} from "@/lib/edit-utils";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TransactionTableProps {
  transactions: Transaction[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onCategoryChange: (id: string, category: TransactionCategory) => void;
  onTransactionChange?: (next: Transaction) => void;
  highlightId?: string | null;
  /** Enable inline edit for Date/Description/Debit/Credit/Balance. */
  editable?: boolean;
  /** Highlight mismatched balance rows (yellow overlay). */
  mismatchIds?: Set<string> | string[];
  /** Expected balance by transaction id (shown under stated when mismatched). */
  expectedBalances?: Record<string, number | null>;
  readOnly?: boolean;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />;
  return dir === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5" />
  );
}

function EditableCell({
  value,
  field,
  dirty,
  disabled,
  align,
  className,
  onCommit,
}: {
  value: string;
  field: EditableField;
  dirty: boolean;
  disabled?: boolean;
  align?: "left" | "right";
  className?: string;
  onCommit: (raw: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  if (disabled || !editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setEditing(true)}
        className={cn(
          "w-full rounded-md px-1.5 py-1 text-sm transition-colors",
          align === "right" && "text-right tabular-nums",
          !disabled && "hover:bg-muted/60 cursor-text",
          dirty && "cell-dirty",
          disabled && "cursor-default",
          className,
        )}
        title={disabled ? undefined : "Click to edit"}
      >
        {field === "description" ? (
          <span className="font-medium leading-snug line-clamp-2 text-left block">
            {value || "—"}
          </span>
        ) : (
          <span>{value || "—"}</span>
        )}
      </button>
    );
  }

  return (
    <Input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={cn(
        "h-8 text-sm",
        align === "right" && "text-right tabular-nums",
        dirty && "border-amber-500/50",
        className,
      )}
    />
  );
}

export function TransactionTable({
  transactions,
  sortKey,
  sortDir,
  onSort,
  onCategoryChange,
  onTransactionChange,
  highlightId,
  editable = false,
  mismatchIds,
  expectedBalances,
  readOnly = false,
}: TransactionTableProps) {
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const mismatchSet = useMemo(() => {
    if (!mismatchIds) return new Set<string>();
    return mismatchIds instanceof Set ? mismatchIds : new Set(mismatchIds);
  }, [mismatchIds]);

  useEffect(() => {
    if (!highlightId) return;
    const el = rowRefs.current.get(highlightId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId]);

  const headers = useMemo(
    () =>
      [
        { key: "date" as const, label: "Date", className: "w-[118px]" },
        { key: "description" as const, label: "Description", className: "min-w-[200px]" },
        { key: "debit" as const, label: "Debit", className: "w-[110px] text-right" },
        { key: "credit" as const, label: "Credit", className: "w-[110px] text-right" },
        { key: "balance" as const, label: "Balance", className: "w-[130px] text-right" },
        { key: "category" as const, label: "Category", className: "w-[150px]" },
        ...(editable
          ? [{ key: "actions" as const, label: "", className: "w-[52px]" }]
          : []),
      ] as const,
    [editable],
  );

  if (transactions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/80 bg-card/50 p-10 text-center text-sm text-muted-foreground">
        No transactions match your filters.
      </div>
    );
  }

  const canEdit = editable && !readOnly && Boolean(onTransactionChange);

  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 shadow-sm overflow-hidden">
      {editable && (
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5 bg-muted/20">
          <Pencil className="h-3.5 w-3.5 text-primary" />
          <p className="text-xs text-muted-foreground">
            Click any Date, Description, Debit, Credit, or Balance cell to edit.
            Use revert to restore the original parse for that row.
          </p>
        </div>
      )}
      <ScrollArea className="h-[min(62vh,640px)]">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
            <TableRow className="hover:bg-transparent">
              {headers.map((h) => (
                <TableHead key={h.key} className={h.className}>
                  {h.key === "actions" ? null : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 font-semibold text-foreground"
                      onClick={() => onSort(h.key as SortKey)}
                    >
                      {h.label}
                      <SortIcon active={sortKey === h.key} dir={sortDir} />
                    </button>
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((t) => {
              const dirty = isRowDirty(t);
              const changed = dirtyFields(t);
              const mismatched = mismatchSet.has(t.id);
              const expected = expectedBalances?.[t.id];

              return (
                <TableRow
                  key={t.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(t.id, el);
                    else rowRefs.current.delete(t.id);
                  }}
                  className={cn(
                    t.flags.length > 0 && "bg-amber-500/5",
                    dirty && "row-dirty",
                    mismatched && "row-balance-mismatch",
                    highlightId === t.id && "bg-primary/10 ring-1 ring-inset ring-primary/30",
                  )}
                >
                  <TableCell className="p-1.5">
                    {canEdit ? (
                      <EditableCell
                        field="date"
                        value={formatFieldValue(t, "date")}
                        dirty={changed.includes("date")}
                        onCommit={(raw) =>
                          onTransactionChange!(applyFieldEdit(t, "date", raw))
                        }
                      />
                    ) : (
                      <span className="tabular-nums text-xs sm:text-sm whitespace-nowrap px-1.5">
                        {t.date}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="p-1.5">
                    <div className="space-y-1">
                      {canEdit ? (
                        <EditableCell
                          field="description"
                          value={formatFieldValue(t, "description")}
                          dirty={changed.includes("description")}
                          onCommit={(raw) =>
                            onTransactionChange!(
                              applyFieldEdit(t, "description", raw),
                            )
                          }
                        />
                      ) : (
                        <p className="text-sm font-medium leading-snug px-1.5">
                          {t.description}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1 px-1.5">
                        {t.flags.map((f) => (
                          <Badge key={f} variant="outline" className="text-[10px] font-normal">
                            {f}
                          </Badge>
                        ))}
                        {dirty && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-normal bg-amber-500/15 text-amber-900 dark:text-amber-100"
                          >
                            edited
                          </Badge>
                        )}
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
                        {mismatched && (
                          <Badge
                            variant="outline"
                            className="text-[10px] font-normal border-amber-500/50 text-amber-800 dark:text-amber-200"
                          >
                            bal Δ
                          </Badge>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="p-1.5">
                    {canEdit ? (
                      <EditableCell
                        field="debit"
                        value={formatFieldValue(t, "debit")}
                        dirty={changed.includes("debit")}
                        align="right"
                        className="money-out"
                        onCommit={(raw) =>
                          onTransactionChange!(applyFieldEdit(t, "debit", raw))
                        }
                      />
                    ) : (
                      <span className="block text-right tabular-nums text-sm money-out px-1.5">
                        {t.debit != null ? formatMoney(t.debit) : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="p-1.5">
                    {canEdit ? (
                      <EditableCell
                        field="credit"
                        value={formatFieldValue(t, "credit")}
                        dirty={changed.includes("credit")}
                        align="right"
                        className="money-in"
                        onCommit={(raw) =>
                          onTransactionChange!(applyFieldEdit(t, "credit", raw))
                        }
                      />
                    ) : (
                      <span className="block text-right tabular-nums text-sm money-in px-1.5">
                        {t.credit != null ? formatMoney(t.credit) : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="p-1.5">
                    <div className="space-y-0.5">
                      {canEdit ? (
                        <EditableCell
                          field="balance"
                          value={formatFieldValue(t, "balance")}
                          dirty={changed.includes("balance") || mismatched}
                          align="right"
                          className={cn(
                            "text-muted-foreground",
                            mismatched && "cell-balance-mismatch",
                          )}
                          onCommit={(raw) =>
                            onTransactionChange!(applyFieldEdit(t, "balance", raw))
                          }
                        />
                      ) : (
                        <span
                          className={cn(
                            "block text-right tabular-nums text-sm text-muted-foreground px-1.5 rounded-md",
                            mismatched && "cell-balance-mismatch",
                          )}
                        >
                          {t.balance != null ? formatMoney(t.balance) : "—"}
                        </span>
                      )}
                      {mismatched && expected != null && (
                        <p className="text-[10px] text-right text-amber-700 dark:text-amber-300 tabular-nums px-1.5">
                          exp {formatMoney(expected)}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="p-1.5">
                    <Select
                      value={t.category}
                      disabled={readOnly}
                      onValueChange={(v) =>
                        onCategoryChange(t.id, v as TransactionCategory)
                      }
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
                  {editable && (
                    <TableCell className="p-1.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            disabled={!dirty || readOnly}
                            onClick={() =>
                              onTransactionChange?.(revertRow(t))
                            }
                            aria-label="Revert row to original"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Revert row to original parse</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
