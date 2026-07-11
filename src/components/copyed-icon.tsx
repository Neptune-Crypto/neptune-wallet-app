import { notify } from "@/utils/notify";
import { ActionIcon, Tooltip } from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";

export default function CopyedIcon({
  value,
  size = 18,
  tooltipLable = "Copy value",
}: {
  value: string;
  size?: number;
  tooltipLable?: string;
}) {
  // The success toast is the copy feedback. The icon deliberately does NOT swap
  // to a checkmark: swapping would change its footprint and shift right-aligned
  // inline text (e.g. addresses in a confirm modal), and the toast already confirms it.
  return (
    <Tooltip label={tooltipLable} withArrow>
      {/* A real button so the copy action is keyboard-focusable and labelled. */}
      <ActionIcon
        variant="subtle"
        color="gray"
        size={size + 6}
        aria-label={tooltipLable}
        onClick={(e) => {
          // Copying must never also trigger a click-to-act ancestor (e.g. the
          // accounts table row, where a row click switches the active account).
          e.stopPropagation();
          navigator.clipboard.writeText(value);
          notify.success("Copied to clipboard");
        }}
      >
        <IconCopy size={size} />
      </ActionIcon>
    </Tooltip>
  );
}
