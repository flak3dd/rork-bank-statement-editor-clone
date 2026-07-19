import { formatMoneyDisplay, formatPrintDate } from "@/lib/statement-gen/format";
import { paginateLedger } from "@/lib/statement-gen/paginate";
import type { GenerationResult } from "@/lib/statement-gen/types";
import { cn } from "@/lib/utils";

interface StatementPrintViewProps {
  result: GenerationResult;
  className?: string;
}

export function StatementPrintView({ result, className }: StatementPrintViewProps) {
  const pages = paginateLedger(result.rows);
  const { config, summary, periodEnd } = result;
  const totalPages = pages.length;

  return (
    <div className={cn("space-y-6 print:space-y-0", className)}>
      {pages.map((page) => (
        <article
          key={page.pageIndex}
          className={cn(
            "mx-auto bg-white text-neutral-900 shadow-md border border-border/60",
            "print:shadow-none print:border-0 print:break-after-page",
          )}
          style={{
            width: "min(100%, 794px)",
            minHeight: 600,
          }}
        >
          <div className="px-8 pt-8 pb-6 flex flex-col min-h-[600px]">
            {page.isFirst ? (
              <header className="space-y-4 mb-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-bold tracking-tight">
                      {config.account.brandLabel}
                    </p>
                    <p className="text-sm text-neutral-600">
                      {config.account.accountName || config.account.productName}
                    </p>
                    <p className="text-[11px] uppercase tracking-wider text-neutral-500 mt-1">
                      Electronic statement
                    </p>
                  </div>
                  <div className="text-right text-xs text-neutral-600 space-y-0.5">
                    <p>
                      Period{" "}
                      <strong>
                        {formatPrintDate(config.periodStart)} –{" "}
                        {formatPrintDate(periodEnd)}
                      </strong>
                    </p>
                    <p>Customer {config.account.customerId}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded border border-neutral-200 p-3 space-y-1">
                    <p className="font-semibold">
                      {config.account.holderName || config.account.accountHolder}
                    </p>
                    {(config.address.addressLine1 ||
                      config.address.addressStreet) && (
                      <p className="text-neutral-600">
                        {config.address.addressLine1 ||
                          config.address.addressStreet}
                        {config.address.addressLine2
                          ? `, ${config.address.addressLine2}`
                          : ""}
                      </p>
                    )}
                    {config.address.addressCity && (
                      <p className="text-neutral-600">
                        {config.address.addressCity}
                      </p>
                    )}
                    <p>
                      BSB {config.account.bsb || config.account.bsbCode}
                    </p>
                    <p>Account {config.account.accountNumber}</p>
                    {config.account.branch && (
                      <p className="text-neutral-500">
                        Branch {config.account.branch}
                      </p>
                    )}
                    {(config.account.bonusAccount ||
                      config.account.everydayAccount) && (
                      <p className="text-[10px] text-neutral-500 pt-1">
                        {config.account.everydayAccount && (
                          <span>
                            Everyday {config.account.everydayBsb}{" "}
                            {config.account.everydayAccount}
                          </span>
                        )}
                        {config.account.bonusAccount && (
                          <span className="block">
                            Bonus {config.account.bonusBsb}{" "}
                            {config.account.bonusAccount}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <SummaryCell
                      label="Opening"
                      value={formatMoneyDisplay(summary.openingBalance)}
                    />
                    <SummaryCell
                      label="Credits"
                      value={formatMoneyDisplay(summary.totalCredits)}
                    />
                    <SummaryCell
                      label="Debits"
                      value={formatMoneyDisplay(summary.totalDebits)}
                    />
                    <SummaryCell
                      label="Closing"
                      value={formatMoneyDisplay(summary.closingBalance)}
                    />
                  </div>
                </div>

                <p className="text-[10px] text-neutral-500">
                  Interest rate{" "}
                  {(
                    config.account.interestRate ??
                    config.account.interestRatePct
                  ).toFixed(2)}
                  % p.a. (indicative)
                  {config.account.timezone
                    ? ` · ${config.account.timezone}`
                    : ""}
                  .{" "}
                  {config.entity.entityName
                    ? `${config.entity.entityName}`
                    : "Demonstration issuer"}
                  {config.entity.entityCity
                    ? ` · ${config.entity.entityCity}${config.entity.entityState ? ` ${config.entity.entityState}` : ""}`
                    : ""}
                  . Not an official bank document.
                </p>
              </header>
            ) : (
              <header className="flex items-center justify-between mb-3 pb-2 border-b border-neutral-200">
                <p className="text-sm font-bold">{config.account.brandLabel}</p>
                <p className="text-[10px] text-neutral-500">Continued</p>
              </header>
            )}

            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-neutral-300 text-left text-neutral-600">
                  <th className="py-1.5 pr-2 font-semibold w-[72px]">Date</th>
                  <th className="py-1.5 pr-2 font-semibold">Description</th>
                  <th className="py-1.5 pr-2 font-semibold w-[72px]">Effective</th>
                  <th className="py-1.5 pr-2 font-semibold text-right w-[72px]">
                    Debit
                  </th>
                  <th className="py-1.5 pr-2 font-semibold text-right w-[72px]">
                    Credit
                  </th>
                  <th className="py-1.5 font-semibold text-right w-[80px]">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-neutral-100 align-top"
                  >
                    <td className="py-1 pr-2 tabular-nums whitespace-nowrap">
                      {formatPrintDate(r.date)}
                    </td>
                    <td className="py-1 pr-2">
                      <span className="font-medium">{r.description}</span>
                      {r.secondaryDescription && (
                        <span className="block text-neutral-500 text-[10px]">
                          {r.secondaryDescription}
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-2 tabular-nums text-neutral-600">
                      {formatPrintDate(r.effectiveDate)}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {r.amount < 0 ? formatMoneyDisplay(-r.amount) : ""}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {r.amount > 0 ? formatMoneyDisplay(r.amount) : ""}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {formatMoneyDisplay(r.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-auto pt-4">
              {page.isLast && (
                <p className="text-[9px] text-neutral-500 leading-relaxed mb-3 border-t border-neutral-200 pt-3">
                  Please check this statement carefully. Generated data is for
                  software demonstration only and does not constitute a real
                  financial product disclosure. Errors and omissions excepted.
                  Contact support for genuine account enquiries through your
                  financial institution.
                </p>
              )}
              <footer className="flex items-center justify-between text-[9px] text-neutral-500 border-t border-neutral-200 pt-2">
                <span>
                  {config.account.brandLabel} · Confidential
                </span>
                <span className="tabular-nums">
                  Page {page.pageIndex + 1} of {totalPages}
                </span>
              </footer>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="text-xs font-semibold tabular-nums">{value}</p>
    </div>
  );
}
