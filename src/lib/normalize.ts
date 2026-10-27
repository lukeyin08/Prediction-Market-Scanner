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
  [/\b(?:uefa )?champions league\b|\bucl\b/g, " championsleague "],
  [/\bstanley cup\b/g, " stanleycup "],
  [/\bbasis points?\b|\bbps\b|\bbp\b/g, " bps "],
  [/\binterest rates?\b/g, " rate "],
  [/\bprime minister\b/g, " primeminister "],
  [/\bhead of (?:state|government)\b/g, " leader "],
  [/\bleague of legends\b|\blol\b/g, " "],
  [/\bpresidential election\b/g, " president election "],
  [/\belectoral college\b/g, " electoralcollege "],
  [/\bpopular vote\b/g, " popularvote "],
  [/\bhouse of representatives\b/g, " house "],
  [/\bno change\b|\bhold(?:s)? rates?\b|\bunchanged\b|\bpause\b|\bmaintains?\b/g, " hold "],
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
  race: "election",
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
  "has", "his", "her", "their", "market", "yes", "no", "least", "more", "most", "into",
  "up", "down", "over", "under", "between", "per", "via", "through", "about", "if", "then",
  "meeting", "game", "match", "et", "est", "edt", "pt", "pst", "pdt", "utc", "am", "pm", "not", "none", "nobody",
  "without", "officially", "official",
]);

/**
 * Words that define what a contract resolves on. If one side has one and the
 * other doesn't, they are different contracts however similar the rest is
 * ("best coding model" vs "best AI model", "most votes" vs "most seats").
 */
const CRITICAL = new Set([
  "nomination", "vote", "popularvote", "electoralcollege", "seat", "coding", "half", "quarter", "margin",
  "turnout", "finalist", "mention", "runoff", "primary", "approval", "debate", "q1", "q2", "q3", "q4", "h1", "h2",
  "pardon", "indict", "impeach", "resign", "fired", "arrest",
]);

// Kept out of STOPWORDS on purpose: direction words ("over"/"under") are
// stripped above for token similarity but captured as a feature here, so
// "over 4%" and "under 4%" never match.
const DIRECTION_WORDS = new Set(["over", "under"]);

export interface Features {
  tokens: string[];
  /** Numeric thresholds such as 4.25 (percent), 100000 (dollars), 25 (bps). */
  numbers: number[];
  /**
   * Numbers that carry an inequality, e.g. ">25bps" -> "gt:25", "50+ bps" -> "gte:50",
   * "$100k or more" -> "gte:100000". "Cut >25bps" and "cut 25bps" are different contracts.
   */
  bounds: string[];
  years: number[];
  months: string[];
  /** Calendar dates as MM-DD, normalized so "before Nov 1" and "by Oct 31" agree. */
  dates: string[];
  /** Party mentions in order ("D Senate, R House" -> democratic, republican). */
  parties: string[];
  /** The contract is about something NOT happening ("no Supreme Leader"). */
  negated: boolean;
  /** Resolution-defining words present (see CRITICAL). */
  critical: string[];
  direction: "over" | "under" | null;
  /** How the contract resolves, independent of wording. Pairs must agree on all three. */
  shape: Shape;
}

export interface Shape {
  /** Bucketed outcome, e.g. "$90,000 to $94,999.99". */
  range: boolean;
  /** "touch": hits a level at any time before a deadline. "terminal": measured at one moment. */
  path: "touch" | "terminal" | null;
  /** Relative race among outcomes: "next leader out", "hit $50k before $100k", "50,000 first". */
  race: boolean;
  /** Resolves on an announcement ("announce an IPO") rather than the event itself ("IPO"). */
  announce: boolean;
}

const RANGE_RE = /\d[\d,.]*\s*(?:k|m|%|bps)?\s*(?:to|-|–|through)\s*\$?\d|\bbetween\s+\$?\d/;
const TOUCH_RE =
  /\b(?:reach|reaches|reached|hit|hits|dip|dips|touch|touches|cross|crosses|at any (?:point|time)|all[- ]time high|ath|how high|how low|max(?:imum)?|min(?:imum)?)\b/;
// Threshold language followed by a deadline ("above $150k by Dec 31", "above X before Dec 31") is a touch contract.
const DEADLINE_THRESHOLD_RE = /\b(?:above|below|over|under|greater|less)\b[^|?]*\b(?:by|before)\b/;
const TERMINAL_RE =
  /\b(?:at the end of|end of|year[- ]end|on (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d|close[sd]? (?:at|above|below|over|under)|closing|settle[sd]?|final (?:price|value))\b/;

function isRace(t: string): boolean {
  // "next leader out", "first to", "X first", or a price race "hit $50k before $100k".
  if (/\bnext\b[^|?]*\b(?:out|leave|leaves|exit|removed|to go)\b/.test(t)) return true;
  if (/\bfirst\s*(?:\?|$|\||to\b)/.test(t)) return true;
  const m = t.match(/\bbefore \$?(\d[\d,.]*)\s*(k|m)?\b/);
  if (m) {
    const n = Number(m[1].replace(/,/g, ""));
    const isYear = !m[2] && !m[0].includes("$") && n >= 1900 && n <= 2100;
    if (!isYear) return true;
  }
  return false;
}

export function detectShape(normalizedText: string): Shape {
  const t = normalizedText.toLowerCase();
  // "by the end of October" is a deadline (touch), not a measurement at the end.
  const terminalText = t.replace(/\bby (?:the )?end of\b/g, " by ");
  const touch = TOUCH_RE.test(t) || DEADLINE_THRESHOLD_RE.test(terminalText);
  const terminal = TERMINAL_RE.test(terminalText);
  return {
    range: RANGE_RE.test(t),
    path: touch && !terminal ? "touch" : terminal && !touch ? "terminal" : null,
    race: isRace(t),
    announce: /\bannounc(?:e|es|ed|ing|ement)\b/.test(t),
  };
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const DATE_RE =
  /\b(before|by|on|through|until|after)?\s*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*((?:19|20)\d\d)\b)?/g;

/**
 * Pull calendar dates out of the text. "before Nov 1, 2027" is the same
 * deadline as "by Oct 31, 2026", so "before D" is stored as D minus one day.
 */
function extractDates(text: string): { dates: string[]; months: string[]; years: number[]; rest: string } {
  const dates: string[] = [];
  const months: string[] = [];
  const years: number[] = [];
  const rest = text.replace(DATE_RE, (_full, prep: string | undefined, mon: string, day: string, year: string | undefined) => {
    const d = new Date(Date.UTC(year ? Number(year) : 2001, MONTH_INDEX[mon] - 1, Number(day)));
    if (prep === "before") d.setUTCDate(d.getUTCDate() - 1);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    dates.push(`${mm}-${dd}`);
    months.push(MONTH_NAMES[d.getUTCMonth()]);
    if (year) years.push(d.getUTCFullYear());
    return ` ${prep ?? ""} `;
  });
  return { dates, months, years, rest };
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
];

// No letter or digit right before the number, so "Q3", "H2", "G2" stay tokens.
const NUMBER_RE =
  /(?<![a-z0-9.])(\$)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|k\b|m\b|mm\b|b\b|bn\b|million\b|billion\b|thousand\b|trillion\b|t\b)?/gi;

const PREFIX_BOUNDS: [RegExp, string][] = [
  [/(?:>=|≥|at least|no less than|minimum of)\s*\$?\s*$/, "gte"],
  [/(?:<=|≤|at most|no more than|maximum of)\s*\$?\s*$/, "lte"],
  [/(?:>|more than|greater than|higher than)\s*\$?\s*$/, "gt"],
  [/(?:<|less than|fewer than|lower than)\s*\$?\s*$/, "lt"],
];
const SUFFIX_BOUNDS: [RegExp, string][] = [
  [/^\s*(?:\+|or (?:more|above|higher|greater|over))/, "gte"],
  [/^\s*(?:or (?:less|below|lower|fewer|under))/, "lte"],
];

function parseNumbers(text: string): { numbers: number[]; bounds: string[]; years: number[]; rest: string } {
  const numbers: number[] = [];
  const bounds: string[] = [];
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
    // "31 December" (day before month): a date, not a threshold.
    if (!dollar && !frac && !u && base >= 1 && base <= 31) {
      const after = whole.slice(offset + full.length, offset + full.length + 12);
      if (/^\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.test(after)) return " ";
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
    // "$99,999.99" is a bucket edge for $100,000.
    const snapped = frac && /^\.99+$/.test(frac) ? Math.ceil(base) : base;
    const value = roundSig(snapped * mult);
    numbers.push(value);
    const before = whole.slice(Math.max(0, offset - 20), offset);
    const after = whole.slice(offset + full.length, offset + full.length + 16);
    const op =
      PREFIX_BOUNDS.find(([re]) => re.test(before))?.[1] ?? SUFFIX_BOUNDS.find(([re]) => re.test(after))?.[1];
    if (op) bounds.push(`${op}:${value}`);
    return " ";
  });
  return { numbers, bounds, years, rest };
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
  // Clock times are never thresholds ("11:59 PM ET").
  t = t.replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b/g, " ");
  // Season labels ("2026-27") are years, not a numeric range.
  t = t.replace(/\b((?:19|20)\d\d)\s*[-–/]\s*(\d\d)\b/g, (_m, y1: string, y2: string) => ` ${y1} ${y1.slice(0, 2)}${y2} `);
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);
  // Single-letter party labels in political contexts ("D Senate, R House").
  if (/\b(?:house|senate|congress|governor|president|election|power|sweep|trifecta|control)\b/.test(t)) {
    t = t.replace(/(^|[\s,(|:/-])d(?=[\s,)|:/+-]|$)/g, "$1 democratic ").replace(/(^|[\s,(|:/-])r(?=[\s,)|:/+-]|$)/g, "$1 republican ");
  }

  const shape = detectShape(t);
  const negated = /\b(?:no|not|none|nobody|no one|without|fails? to)\b/.test(t);
  const parties = [...t.matchAll(/\b(democrat(?:ic|s)?|dems?|republicans?|gop)\b/g)].map((m) =>
    m[1].startsWith("d") ? "democratic" : "republican",
  );

  const dated = extractDates(t);
  const { numbers, bounds, years, rest } = parseNumbers(dated.rest);

  const months: string[] = [...dated.months];
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
    bounds: [...new Set(bounds)].sort(),
    years: [...new Set([...years, ...dated.years])].sort(),
    months: [...new Set(months)],
    dates: [...new Set(dated.dates)].sort(),
    parties,
    negated,
    critical: [...new Set(tokens.filter((x) => CRITICAL.has(x)))].sort(),
    direction,
    shape,
  };
}
