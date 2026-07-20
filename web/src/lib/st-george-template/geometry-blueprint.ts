/**
 * St George Complete Freedom — layered geometry blueprint.
 *
 * Derived from PDF visual layout fidelity analysis of:
 * - TEMPLATE 2 (base layer — keep as-is)
 * - TEMPLATE (placement map — {TOKEN} positions)
 * - Final #726 (structure / density target)
 *
 * See: web/docs/st-george-layer-analysis/
 */

export const ST_GEORGE_PAGE_SIZE = { width: 595, height: 842 } as const;

/** Desktop / public paths for the three-layer model. */
export const ST_GEORGE_LAYER_PATHS = {
  baseDesktop:
    "/Users/adminuser/Desktop/St George Bank TEMPLATE 2- 21.08.24 to 19.11.24.pdf",
  placementDesktop:
    "/Users/adminuser/Desktop/St George Bank TEMPLATE- 21.08.24 to 19.11.24.pdf",
  finalDesktop:
    "/Users/adminuser/Downloads/1132%20(2)/698/St George Bank Acc Statement #726 - 21.08.24 to 19.11.24.pdf",
  basePublic: "/templates/st-george-template-2-base.pdf",
  placementPublic: "/templates/st-george-template-placement-map.pdf",
} as const;

/** Default on-disk base (TEMPLATE 2). */
export const DEFAULT_ST_GEORGE_BASE_PATH = ST_GEORGE_LAYER_PATHS.baseDesktop;

/** Placement map with {TOKEN} slots. */
export const DEFAULT_ST_GEORGE_PLACEMENT_PATH =
  ST_GEORGE_LAYER_PATHS.placementDesktop;

/** Legacy alias — placement map (token shell). */
export const DEFAULT_ST_GEORGE_TEMPLATE_PATH =
  DEFAULT_ST_GEORGE_PLACEMENT_PATH;

export interface ChromeSlot {
  token: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Chrome injection slots from TEMPLATE placement map (page coords). */
export const ST_GEORGE_CHROME_SLOTS: ChromeSlot[] = [
  { token: "{FIRSTNAME LASTNAME}", page: 1, x: 70, y: 131, w: 180, h: 14 },
  { token: "{ADDRESS LINE 1}", page: 1, x: 70, y: 143, w: 180, h: 14 },
  { token: "{ADDRESS LINE 2}", page: 1, x: 70, y: 155, w: 180, h: 14 },
  { token: "{BSB}", page: 1, x: 424, y: 140, w: 40, h: 16 },
  { token: "{ACCOUNT}", page: 1, x: 459, y: 140, w: 90, h: 16 },
  { token: "{ACCOUNT}", page: 2, x: 471, y: 89, w: 90, h: 16 },
  { token: "{DATE}", page: 1, x: 467, y: 164, w: 80, h: 16 },
  { token: "{NUMBER OF DAYS}", page: 1, x: 205, y: 205, w: 40, h: 14 },
  { token: "{FROM DATE}", page: 1, x: 400, y: 206, w: 80, h: 14 },
  { token: "{TO DATE}", page: 1, x: 482, y: 206, w: 70, h: 14 },
  { token: "{CURRENT BALANCE}", page: 1, x: 153, y: 229, w: 110, h: 16 },
  { token: "{DATE CREATE}", page: 1, x: 132, y: 800, w: 70, h: 14 },
  { token: "{TIME}", page: 1, x: 208, y: 800, w: 70, h: 14 },
  { token: "{DATE CREATE}", page: 2, x: 132, y: 800, w: 70, h: 14 },
  { token: "{TIME}", page: 2, x: 208, y: 800, w: 70, h: 14 },
  { token: "{PAGE}", page: 1, x: 498, y: 800, w: 14, h: 14 },
  { token: "{PAGE_TOTAL}", page: 1, x: 522, y: 800, w: 18, h: 14 },
  { token: "{PAGE}", page: 2, x: 498, y: 800, w: 14, h: 14 },
  { token: "{PAGE_TOTAL}", page: 2, x: 522, y: 800, w: 18, h: 14 },
];

export const ST_GEORGE_TXN_COLUMNS = {
  dateX: 70,
  dateW: 48,
  descX: 115,
  descW: 250,
  amountX: 385,
  amountW: 80,
  balanceX: 474,
  balanceW: 80,
  rowH: 16,
  secondaryOffset: 12,
} as const;

/** #726 measured row pitch (~36–37 pt between date anchors). */
export const ST_GEORGE_ROW_PITCH = 36.6;

export const ST_GEORGE_TXN_GRID = {
  page1: {
    firstRowY: 287,
    pitch: ST_GEORGE_ROW_PITCH,
    /** Matches #726 density before footer. */
    maxRows: 13,
    yMax: 740,
  },
  page2plus: {
    firstRowY: 155,
    pitch: ST_GEORGE_ROW_PITCH,
    maxRows: 16,
    yMax: 740,
  },
} as const;

/**
 * Visual fidelity snapshot (page 1 @ 1× RGB).
 * TEMPLATE 2 vs TEMPLATE ~1.4% pixels differ — same chrome.
 * Body band is where final data lives.
 */
export const ST_GEORGE_FIDELITY_SNAPSHOT = {
  pageSize: "595×842",
  template2VsTemplatePctDiff: 1.38,
  template2VsFinalPctDiff: 5.18,
  headerBandPctDiff: 2.34,
  bodyBandPctDiff: 6.52,
  footerBandPctDiff: 1.09,
  anchorsExact: [
    "Complete Freedom @ (225,74)",
    "Transaction Listing @ (223,97)",
    "period line @ (70,205)",
  ],
} as const;
