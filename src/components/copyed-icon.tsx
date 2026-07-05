import { notify } from "@/utils/notify";
import { Tooltip } from "@mantine/core";
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
          <IconCopy
            style={{ cursor: "pointer" }}
            size={size}
            onClick={() => {
              navigator.clipboard.writeText(value);
              setCopyed(true);
              notify.success("Copied to clipboard");
              setTimeout(() => {
                setCopyed(false);
              }, 2000);
            }}
          />
        </Tooltip>
      )}
    </>
  );
}
