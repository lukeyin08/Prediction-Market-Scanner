/**
 * Bump whenever matching OR pricing (fees, book walk) changes. Persistence
 * analysis only compares snapshots from the same scanner version, so a rule
 * change never mixes old results into new statistics.
 *
 * 1: initial text-similarity matcher (many false matches)
 * 2: resolution-shape, bounds, label and topic constraints
 * 3: whole-contract book walk, best rounded-fee prefix, conservative fee lookups
 * 4: date/negation/party/critical-word constraints, stricter numbers and paths
 * 5: reject dated vs undated pairs; gentler Kalshi book fetching
 */
export const SCANNER_VERSION = 5;
