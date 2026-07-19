import {
  DEFAULT_PAGE_LAYOUT,
  type LedgerRow,
  type PageLayout,
  type PaginatedPage,
} from "./types";

function rowHeight(row: LedgerRow, layout: PageLayout): number {
  return row.secondaryDescription
    ? layout.dualRowHeight
    : layout.singleRowHeight;
}

/**
 * Greedy A4 pagination (concepts §7).
 * First page body shrinks for large header; last page reserves disclaimer space.
 */
export function paginateLedger(
  rows: LedgerRow[],
  layout: PageLayout = DEFAULT_PAGE_LAYOUT,
): PaginatedPage[] {
  if (rows.length === 0) {
    return [
      {
        pageIndex: 0,
        isFirst: true,
        isLast: true,
        rows: [],
      },
    ];
  }

  const bodyFirst =
    layout.pageHeight -
    layout.paddingTop -
    layout.paddingBottom -
    layout.footerHeight -
    layout.firstPageHeaderHeight;

  const bodyCont =
    layout.pageHeight -
    layout.paddingTop -
    layout.paddingBottom -
    layout.footerHeight -
    layout.continuationHeaderHeight;

  const pages: PaginatedPage[] = [];
  let pageRows: LedgerRow[] = [];
  let used = 0;
  let pageIndex = 0;
  let bodyLimit = bodyFirst;

  const flush = (isLast: boolean) => {
    pages.push({
      pageIndex,
      isFirst: pageIndex === 0,
      isLast,
      rows: pageRows,
    });
    pageIndex += 1;
    pageRows = [];
    used = 0;
    bodyLimit = bodyCont;
  };

  for (const row of rows) {
    const h = rowHeight(row, layout);
    if (used + h > bodyLimit && pageRows.length > 0) {
      flush(false);
    }
    pageRows.push(row);
    used += h;
  }
  if (pageRows.length) flush(true);
  else if (pages.length === 0) {
    pages.push({ pageIndex: 0, isFirst: true, isLast: true, rows: [] });
  } else {
    pages[pages.length - 1].isLast = true;
  }

  // Reserve disclaimer on last page — split if needed
  const last = pages[pages.length - 1];
  const lastBody = last.isFirst ? bodyFirst : bodyCont;
  let lastUsed = last.rows.reduce((s, r) => s + rowHeight(r, layout), 0);
  if (lastUsed + layout.disclaimerHeight > lastBody && last.rows.length > 1) {
    const keep: LedgerRow[] = [];
    const spill: LedgerRow[] = [];
    let u = 0;
    const limit = lastBody - layout.disclaimerHeight;
    for (const r of last.rows) {
      const h = rowHeight(r, layout);
      if (u + h <= limit || keep.length === 0) {
        keep.push(r);
        u += h;
      } else {
        spill.push(r);
      }
    }
    if (spill.length) {
      last.rows = keep;
      last.isLast = false;
      pages.push({
        pageIndex: pages.length,
        isFirst: false,
        isLast: true,
        rows: spill,
      });
    }
  }

  // renumber
  pages.forEach((p, i) => {
    p.pageIndex = i;
    p.isFirst = i === 0;
    p.isLast = i === pages.length - 1;
  });

  return pages;
}
