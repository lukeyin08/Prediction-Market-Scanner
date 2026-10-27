/**
 * Text normalization for cross-venue contract matching.
 *
 * Kalshi and Polymarket phrase the same contract differently
 * ("Fed decreases rates by 25 bps" vs "Cut 25bps"), so before comparing we
 * canonicalize phrases and synonyms, strip filler words, and pull numeric
 * thresholds and years out as structured features. Numbers matter more than
 * words: "BTC above $100k" and "BTC above $110k" share every token but are
 * different contracts.
 */

const PHRASES: [RegExp, string][] = [
  [/\bunited states\b|\bu\.s\.a?\.?(?=\s|$)|\bus\b/g, " usa "],
  [/\bfederal reserve\b|\bfomc\b/g, " fed "],
  [/\bnew york city\b/g, " nyc "],
  [/\bsuper bowl\b/g, " superbowl "],
  [/\bworld series\b/g, " worldseries "],
  [/\bnba finals\b/g, " nba champion "],
  [/\bstanley cup\b/g, " stanleycup "],
  [/\bbasis points?\b|\bbps\b|\bbp\b/g, " bps "],
  [/\binterest rates?\b/g, " rate "],
  [/\bprime minister\b/g, " primeminister "],
  [/\bpresidential election\b/g, " president election "],
  [/\belectoral college\b/g, " electoralcollege "],
  [/\bpopular vote\b/g, " popularvote "],
  [/\bhouse of representatives\b/g, " house "],
  [/\bno change\b|\bhold(?:s)? rates?\b|\bunchanged\b|\bpause\b/g, " hold "],
];

const SYNONYMS: Record<string, string> = {
  decrease: "cut",
  decreases: "cut",
  lower: "cut",
  lowers: "cut",
  reduce: "cut",
  reduces: "cut",
  cuts: "cut",
  increase: "hike",
  increases: "hike",
  raise: "hike",
  raises: "hike",
  hikes: "hike",
  democrat: "democratic",
  democrats: "democratic",
  dem: "democratic",
  dems: "democratic",
  gop: "republican",
  republicans: "republican",
  rep: "republican",
  presidential: "president",
  wins: "win",
  winner: "win",
  won: "win",
  winning: "win",
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  above: "over",
  exceed: "over",
  exceeds: "over",
  greater: "over",
  higher: "over",
  below: "under",
  less: "under",
  championship: "win",
  champions: "win",
  champion: "win",
  bp: "bps",
  nominee: "nomination",
  nominated: "nomination",
  elected: "election",
  elects: "election",
};

const MONTHS: Record<string, string> = {
  jan: "january", january: "january",
  feb: "february", february: "february",
  mar: "march", march: "march",
  apr: "april", april: "april",
  may: "may",
  jun: "june", june: "june",
  jul: "july", july: "july",
  aug: "august", august: "august",
  sep: "september", sept: "september", september: "september",
  oct: "october", october: "october",
  nov: "november", november: "november",
  dec: "december", december: "december",
};

const STOPWORDS = new Set([
  "a", "an", "the", "will", "be", "is", "are", "was", "to", "of", "in", "on", "at", "by", "for",
  "and", "or", "as", "with", "from", "this", "that", "it", "its", "before", "after", "during",
  "end", "than", "any", "which", "who", "what", "when", "how", "does", "do", "did", "get", "have",
  "has", "his", "her", "their", "next", "market", "yes", "no", "least", "more", "most", "into",
  "out", "up", "down", "over", "under", "between", "per", "via", "through", "about", "if", "then",
  "meeting", "game", "match",
]);

// Kept out of STOPWORDS on purpose: direction words ("over"/"under") are
// stripped above for token similarity but captured as a feature here, so
// "over 4%" and "under 4%" never match.
const DIRECTION_WORDS = new Set(["over", "under"]);

export interface Features {
  tokens: string[];
  /** Numeric thresholds such as 4.25 (percent), 100000 (dollars), 25 (bps). */
  numbers: number[];
  years: number[];
  months: string[];
  direction: "over" | "under" | null;
}

const NUMBER_RE =
  /(\$)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|k\b|m\b|mm\b|b\b|bn\b|million\b|billion\b|thousand\b|trillion\b|t\b)?/gi;

function parseNumbers(text: string, months: Set<string>): { numbers: number[]; years: number[]; rest: string } {
  const numbers: number[] = [];
  const years: number[] = [];
  const rest = text.replace(NUMBER_RE, (full, dollar, intPart, frac, unit, offset: number, whole: string) => {
    const base = Number(String(intPart).replace(/,/g, "") + (frac ?? ""));
    if (!Number.isFinite(base)) return " ";
    const u = (unit ?? "").toLowerCase();

    // A bare 4-digit integer between 1900 and 2100 is a year, not a threshold.
    if (!dollar && !frac && !u && base >= 1900 && base <= 2100 && String(intPart).length === 4) {
      years.push(base);
      return " ";
    }
    // "December 31" / "31 December": day-of-month, not a threshold.
    if (!dollar && !frac && !u && base >= 1 && base <= 31) {
      const before = whole.slice(Math.max(0, offset - 12), offset).toLowerCase();
      const after = whole.slice(offset + full.length, offset + full.length + 12).toLowerCase();
      const monthNear = [...months].some((m) => before.includes(m) || after.trimStart().startsWith(m));
      if (monthNear) return " ";
    }

    const mult =
      u === "k" || u === "thousand"
        ? 1e3
        : u === "m" || u === "mm" || u === "million"
          ? 1e6
          : u === "b" || u === "bn" || u === "billion"
            ? 1e9
            : u === "t" || u === "trillion"
              ? 1e12
              : 1;
    numbers.push(roundSig(base * mult));
    return " ";
  });
  return { numbers, years, rest };
}

function roundSig(x: number): number {
  return Number(x.toPrecision(10));
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss") && !token.endsWith("us")) {
    return token.slice(0, -1);
  }
  return token;
}

export function extractFeatures(text: string): Features {
  let t = ` ${text.toLowerCase()} `;
  t = t.replace(/[’']/g, "");
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);

  const monthNames = new Set(Object.keys(MONTHS));
  const { numbers, years, rest } = parseNumbers(t, monthNames);

  const months: string[] = [];
  const tokens: string[] = [];
  let direction: Features["direction"] = null;

  for (const raw of rest.split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    if (MONTHS[raw]) {
      months.push(MONTHS[raw]);
      continue;
    }
    let tok = SYNONYMS[raw] ?? raw;
    if (DIRECTION_WORDS.has(tok)) {
      direction = direction ?? (tok as "over" | "under");
      continue;
    }
    if (STOPWORDS.has(tok) || tok.length < 2 || /^\d+$/.test(tok)) continue;
    tok = stem(tok);
    tok = SYNONYMS[tok] ?? tok;
    tokens.push(tok);
  }

  return {
    tokens,
    numbers: [...new Set(numbers)].sort((a, b) => a - b),
    years: [...new Set(years)].sort(),
    months: [...new Set(months)],
    direction,
  };
}
