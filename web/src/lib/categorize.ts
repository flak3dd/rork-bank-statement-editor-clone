import type { Transaction, TransactionCategory } from "./types";

interface Rule {
  category: TransactionCategory;
  patterns: RegExp[];
  confidence: number;
}

const RULES: Rule[] = [
  {
    category: "Income",
    confidence: 0.85,
    patterns: [
      /\b(salary|payroll|direct\s*deposit|wages|paycheque|paycheck|employer)\b/i,
      /\b(interest\s*credit|dividend|refund|tax\s*refund|cashback)\b/i,
      /\b(deposit|credit\s*transfer|incoming)\b/i,
    ],
  },
  {
    category: "Transfer",
    confidence: 0.8,
    patterns: [
      /\b(transfer|tfr|xfer|venmo|zelle|paypal|wise|revolut)\b/i,
      /\b(internal\s*transfer|own\s*account|savings)\b/i,
      /\b(bp\s*pay|bill\s*pay|payment\s*to)\b/i,
    ],
  },
  {
    category: "Groceries",
    confidence: 0.88,
    patterns: [
      /\b(woolworths|coles|aldi|iga|costco|trader\s*joe|whole\s*foods|safeway|kroger|tesco|sainsbury|lidl|spar)\b/i,
      /\b(grocery|supermarket|market\s*fresh|fresh\s*food)\b/i,
    ],
  },
  {
    category: "Dining",
    confidence: 0.85,
    patterns: [
      /\b(restaurant|cafe|café|coffee|starbucks|mcdonald|uber\s*eats|doordash|menulog|grubhub|deliveroo)\b/i,
      /\b(dining|takeaway|take\s*out|pizza|sushi|bakery|bar\s*&?\s*grill)\b/i,
    ],
  },
  {
    category: "Transport",
    confidence: 0.86,
    patterns: [
      /\b(uber|lyft|taxi|transit|metro|opal|myki|shell|bp\s|caltex|chevron|exxon|petrol|gas\s*station|fuel)\b/i,
      /\b(parking|toll|airline|qantas|virgin|delta|united|flight)\b/i,
    ],
  },
  {
    category: "Housing",
    confidence: 0.9,
    patterns: [
      /\b(rent|mortgage|landlord|lease|body\s*corp|strata|real\s*estate)\b/i,
      /\b(home\s*loan|property\s*mgmt)\b/i,
    ],
  },
  {
    category: "Utilities",
    confidence: 0.88,
    patterns: [
      /\b(electric|electricity|gas\s*bill|water\s*bill|utility|utilities|energy)\b/i,
      /\b(internet|broadband|telstra|optus|vodafone|comcast|verizon|at&t|origin\s*energy|agl)\b/i,
      /\b(phone\s*bill|mobile\s*plan)\b/i,
    ],
  },
  {
    category: "Shopping",
    confidence: 0.8,
    patterns: [
      /\b(amazon|ebay|etsy|target|walmart|kmart|big\s*w|myer|david\s*jones|ikea|apple\.com|best\s*buy)\b/i,
      /\b(shop|store|retail|online\s*order)\b/i,
    ],
  },
  {
    category: "Health",
    confidence: 0.86,
    patterns: [
      /\b(pharmacy|chemist|cvs|walgreens|doctor|medical|dental|hospital|clinic|medicare|bupa|medibank)\b/i,
      /\b(health|physio|optometrist|insurance\s*health)\b/i,
    ],
  },
  {
    category: "Entertainment",
    confidence: 0.84,
    patterns: [
      /\b(netflix|spotify|disney|hulu|youtube|steam|playstation|xbox|cinema|movie|ticketmaster|eventbrite)\b/i,
      /\b(subscription|gaming|concert|theatre|theater)\b/i,
    ],
  },
  {
    category: "Fees",
    confidence: 0.9,
    patterns: [
      /\b(fee|charge|overdraft|interest\s*debit|service\s*charge|atm\s*fee|monthly\s*fee|penalty)\b/i,
    ],
  },
];

/** Assign a category from merchant/description text using local rules. */
export function categorizeDescription(
  description: string,
  credit: number | null,
  debit: number | null,
): { category: TransactionCategory; confidence: number } {
  const text = description.trim();
  if (!text) return { category: "Other", confidence: 0.2 };

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return { category: rule.category, confidence: rule.confidence };
      }
    }
  }

  if (credit != null && credit > 0 && (debit == null || debit === 0)) {
    return { category: "Income", confidence: 0.45 };
  }

  return { category: "Other", confidence: 0.35 };
}

export function applyHeuristicCategories(txns: Transaction[]): Transaction[] {
  return txns.map((t) => {
    if (t.categorySource === "manual" || t.categorySource === "ai") return t;
    const { category, confidence } = categorizeDescription(
      t.description,
      t.credit,
      t.debit,
    );
    return {
      ...t,
      category,
      categoryConfidence: confidence,
      categorySource: "heuristic" as const,
    };
  });
}
