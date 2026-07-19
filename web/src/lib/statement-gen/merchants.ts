import type { MerchantProfile } from "./types";

/** Weighted merchant pool — generic brands, not a real bank. */
export const MERCHANT_POOL: MerchantProfile[] = [
  { name: "FRESH MARKET", min: 18, max: 140, weight: 12, category: "Groceries", card: true, cardSuffix: "4532", location: "CITY" },
  { name: "CORNER GROCER", min: 12, max: 85, weight: 8, category: "Groceries", card: true, cardSuffix: "4532", location: "SUBURB" },
  { name: "CAFE DAILY", min: 6, max: 28, weight: 10, category: "Dining", card: true, cardSuffix: "8821", location: "CBD" },
  { name: "QUICK BITES", min: 9, max: 35, weight: 7, category: "Dining", card: true, cardSuffix: "8821", location: "MALL" },
  { name: "BOTTLE SHOP", min: 15, max: 90, weight: 3, category: "Alcohol", card: true, cardSuffix: "4532", location: "LOCAL" },
  { name: "ONLINE MARKETPLACE", min: 20, max: 220, weight: 9, category: "OnlineShopping", card: true, cardSuffix: "9910", location: "WEB" },
  { name: "RIDESHARE TRIP", min: 12, max: 55, weight: 8, category: "Transport", card: true, cardSuffix: "7712", location: "METRO" },
  { name: "TRANSIT TAP", min: 2.5, max: 18, weight: 6, category: "Transport", card: false },
  { name: "FUEL STOP", min: 35, max: 95, weight: 7, category: "Fuel", card: true, cardSuffix: "4532", location: "HWY" },
  { name: "PHARMACY PLUS", min: 8, max: 65, weight: 4, category: "Health", card: true, cardSuffix: "4532", location: "LOCAL" },
  { name: "HARDWARE DEPOT", min: 15, max: 180, weight: 4, category: "HomeImprovement", card: true, cardSuffix: "4532", location: "RETAIL" },
  { name: "DEPARTMENT STORE", min: 25, max: 250, weight: 5, category: "Retail", card: true, cardSuffix: "8821", location: "MALL" },
  { name: "CINEMA TIX", min: 18, max: 48, weight: 3, category: "Entertainment", card: true, cardSuffix: "7712", location: "CITY" },
  { name: "STREAMING TOPUP", min: 9.99, max: 22.99, weight: 2, category: "Entertainment", card: true, cardSuffix: "9910", location: "WEB" },
  { name: "OFFICE SUPPLIES", min: 12, max: 75, weight: 3, category: "Retail", card: false },
];
