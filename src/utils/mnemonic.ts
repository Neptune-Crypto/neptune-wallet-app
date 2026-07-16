// Normalizes seed-phrase input: strips "1." style numbering from pasted backup
// lists and collapses all whitespace (newlines, runs of spaces) to single
// spaces. Run this on paste and at submit — never per keystroke: in a
// controlled field, trimming on change writes the value back without the
// just-typed trailing space, making it impossible to type a phrase by hand.
export function normalizeMnemonic(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*\d+\.\s*/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
