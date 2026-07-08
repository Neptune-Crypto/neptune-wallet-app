// Truncation mark for the omitted middle: three ASCII dots (the conventional
// "content omitted" mark) — reads clearly and copy-pastes safely, unlike the
// single "…" glyph (too narrow) or the old six-dot run (excessive).
const ELLIPSIS = "...";

// Canonical address rendering: first 15 + ... + last 15 (33 chars max). Both ends
// always visible — the start identifies the address type/prefix, the end is what
// users compare against the recipient's copy. Never layer CSS truncation (Mantine
// `truncate`) on top: it re-cuts the tail and silently destroys the end part.
export function ellipsis(value?: string): string {
  return ellipsisFormatLen(value, 15);
}

// Same shape with a custom head/tail length — for non-address digests (tx ids,
// UTXO hashes, output commitments) where a column wants a tighter fit.
export function ellipsisFormatLen(value?: string, formatLen?: number): string {
  if (!value) {
    return "";
  }
  const len = formatLen ?? 15;
  // Only truncate when doing so is actually shorter than showing the whole thing.
  if (value.length > 2 * len + ELLIPSIS.length) {
    return `${value.substring(0, len)}${ELLIPSIS}${value.substring(value.length - len)}`;
  }
  return value;
}
