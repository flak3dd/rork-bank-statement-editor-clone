import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Transaction } from "@/lib/types";
import { formatMoney, round2 } from "@/lib/money";

const PIE_COLORS = [
  "#0f766e",
  "#14b8a6",
  "#f97316",
  "#fb7185",
  "#6366f1",
  "#84cc16",
  "#06b6d4",
  "#a855f7",
  "#eab308",
  "#64748b",
  "#ec4899",
  "#22c55e",
];

interface StatementChartsProps {
  transactions: Transaction[];
}

export function StatementCharts({ transactions }: StatementChartsProps) {
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transactions) {
      const out = t.debit ?? 0;
      if (out <= 0) continue;
      map.set(t.category, round2((map.get(t.category) ?? 0) + out));
    }
    return [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [transactions]);

  const cashflow = useMemo(() => {
    const map = new Map<string, { date: string; in: number; out: number }>();
    for (const t of transactions) {
      const key = t.date.slice(0, 10);
      const row = map.get(key) ?? { date: key, in: 0, out: 0 };
      row.in = round2(row.in + (t.credit ?? 0));
      row.out = round2(row.out + (t.debit ?? 0));
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-21);
  }, [transactions]);

  if (transactions.length === 0) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 text-sm text-muted-foreground">
        Charts appear once transactions are extracted.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
        <h3 className="text-sm font-semibold mb-3">Spending by category</h3>
        {byCategory.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outflow amounts to chart.</p>
        ) : (
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={byCategory}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={78}
                  paddingAngle={2}
                >
                  {byCategory.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, name: string) => [formatMoney(value), name]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid hsl(var(--border))",
                    background: "hsl(var(--card))",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-1 flex flex-wrap gap-2">
          {byCategory.slice(0, 6).map((c, i) => (
            <span
              key={c.name}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2 py-0.5 text-[11px]"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
              />
              {c.name}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
        <h3 className="text-sm font-semibold mb-3">Daily cashflow</h3>
        {cashflow.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dated rows for cashflow.</p>
        ) : (
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cashflow} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: string) => v.slice(5)}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={42}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatMoney(value),
                    name === "in" ? "In" : "Out",
                  ]}
                  labelFormatter={(label) => String(label)}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid hsl(var(--border))",
                    background: "hsl(var(--card))",
                  }}
                />
                <Bar dataKey="in" fill="hsl(var(--money-in))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="out" fill="hsl(var(--money-out))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
