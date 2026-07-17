import { EXPLORER_OUTPUT_URL } from "@/constant";
import { OutputInfo, SendInputItem } from "@/utils/api/types";
import { amount_to_positive_fixed } from "@/utils/math-util";
import { buildOutputGroups, normalizeOutput } from "@/utils/tx-output";
import { ActionIcon, Flex, NumberFormatter, Text, Tooltip } from "@mantine/core";
import { IconArrowBackUp, IconArrowUpRight, IconExternalLink } from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import CopyedIcon from "./copyed-icon";
import MonoText from "./mono-text";

function OutputAmount({ amount }: { amount?: string }) {
  if (!amount) return null;
  return (
    <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
      <NumberFormatter value={amount_to_positive_fixed(amount)} thousandSeparator suffix=" NPT" />
    </Text>
  );
}

function OutputCommitment({ commitment, amount }: { commitment: string; amount?: string }) {
  return (
    <Flex gap={8} align="center" justify="flex-end" wrap="wrap">
      <OutputAmount amount={amount} />
      {amount && (
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          ·
        </Text>
      )}
      <MonoText value={commitment} copy={false} size="xs" c="dimmed" chars={8} />
      <Tooltip label="View on explorer" withArrow>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label="View output on block explorer"
          onClick={() => openUrl(`${EXPLORER_OUTPUT_URL}${commitment}`)}
        >
          <IconExternalLink size={14} />
        </ActionIcon>
      </Tooltip>
      <CopyedIcon size={16} value={commitment} tooltipLable="Copy output commitment" />
    </Flex>
  );
}

export default function TxOutputs({
  outputs,
  batchOutput,
}: {
  outputs: (OutputInfo | string)[];
  batchOutput?: SendInputItem[];
}) {
  const groups = buildOutputGroups(outputs);

  if (groups) {
    return (
      <Flex direction="column" gap={14} w="100%">
        {groups.map((group) => (
          <Flex key={group.key} direction="column" gap={4} align="end" w="100%">
            {group.isChange ? (
              <Flex gap={6} align="center">
                <IconArrowBackUp size={14} color="var(--mantine-color-gray-6)" />
                <Text size="sm" fw={600}>
                  Change{" "}
                  <Text span size="sm" fw={400} c="dimmed">
                    · back to your account
                  </Text>
                </Text>
              </Flex>
            ) : (
              <Flex gap={6} align="center">
                <IconArrowUpRight size={14} color="var(--mantine-color-blue-6)" />
                <Text size="sm" fw={600}>
                  To
                </Text>
                {group.address ? (
                  <MonoText value={group.address} copyLabel="Copy address" />
                ) : (
                  <Text size="sm" c="dimmed">
                    recipient
                  </Text>
                )}
              </Flex>
            )}
            {group.items.map((item, index) => (
              <OutputCommitment key={index} commitment={item.commitment} amount={item.amount} />
            ))}
          </Flex>
        ))}
      </Flex>
    );
  }

  const commitments = (outputs ?? []).map(normalizeOutput);
  return (
    <Flex direction="column" gap={8} align="end" w="100%">
      {batchOutput?.map((recipient, index) => (
        <MonoText key={`to-${index}`} value={recipient.toAddress} copyLabel="Copy address" />
      ))}
      {commitments.map((output, index) => (
        <OutputCommitment key={`out-${index}`} commitment={output.commitment} />
      ))}
    </Flex>
  );
}
