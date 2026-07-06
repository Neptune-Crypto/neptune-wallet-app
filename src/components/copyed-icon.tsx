import { notify } from "@/utils/notify";
import { ActionIcon, Tooltip } from "@mantine/core";
import { IconCircleCheck, IconCopy } from "@tabler/icons-react";
import { useState } from "react";

export default function CopyedIcon({
  value,
  size = 18,
  tooltipLable = "Copy value",
}: {
  value: string;
  size?: number;
  tooltipLable?: string;
}) {
  const [copyed, setCopyed] = useState(false);
  return (
    <>
      {copyed ? (
        <IconCircleCheck color="green" size={size} />
      ) : (
        <Tooltip label={tooltipLable} withArrow>
          {/* A real button so the copy action is keyboard-focusable and labelled. */}
          <ActionIcon
            variant="subtle"
            color="gray"
            size={size + 6}
            aria-label={tooltipLable}
            onClick={() => {
              navigator.clipboard.writeText(value);
              setCopyed(true);
              notify.success("Copied to clipboard");
              setTimeout(() => {
                setCopyed(false);
              }, 2000);
            }}
          >
            <IconCopy size={size} />
          </ActionIcon>
        </Tooltip>
      )}
    </>
  );
}
