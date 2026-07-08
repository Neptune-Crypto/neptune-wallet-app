import { ellipsisFormatLen } from "@/utils/ellipsis-format";
import { Flex, Text } from "@mantine/core";
import CopyedIcon from "./copyed-icon";

// One place to render any machine string — address, transaction id, UTXO hash,
// output commitment. Monospace so every fixed-length (N...N) abbreviation is the
// same pixel width (copy icons line up across table rows) and equal-width glyphs
// make character-by-character verification easier. Pairs the text with a copy
// button unless `copy={false}` (e.g. a read-only line in a confirm modal).
interface MonoTextProps {
  value: string;
  /** Head/tail length of the abbreviation. Ignored when `full`. */
  chars?: number;
  /** Render the whole value (wrapping) instead of abbreviating. */
  full?: boolean;
  /** Show the copy button (default true). */
  copy?: boolean;
  copyLabel?: string;
  size?: string;
  c?: string;
  fw?: number;
  ta?: "left" | "center" | "right";
}

export default function MonoText({
  value,
  chars = 15,
  full = false,
  copy = true,
  copyLabel = "Copy",
  size,
  c,
  fw,
  ta,
}: MonoTextProps) {
  const text = (
    <Text
      ff="monospace"
      size={size}
      c={c}
      fw={fw}
      ta={ta}
      style={full ? { wordBreak: "break-all" } : { whiteSpace: "nowrap" }}
    >
      {full ? value : ellipsisFormatLen(value, chars)}
    </Text>
  );

  if (!copy) return text;
  return (
    <Flex direction="row" gap={8} align="center">
      {text}
      <CopyedIcon size={16} value={value} tooltipLable={copyLabel} />
    </Flex>
  );
}
