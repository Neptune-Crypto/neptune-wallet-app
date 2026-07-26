import { TimeClock } from "@/components/TimeClock";
import { Card, Flex, Loader, Text } from "@mantine/core";
import { IconCircle, IconCircleCheck } from "@tabler/icons-react";
import { useState } from "react";

// The backend emits six technical steps ("stmi: step N. ..." in spend.rs), but
// five of them are sub-second bookkeeping around one minutes-long proving step.
// Collapse to three phases a non-expert can follow; never show the raw strings.
const PHASES = [
  {
    label: "Creating your transaction",
    description:
      "Your transaction is being proven privately on this device — this can take up to a minute or two.",
  },
  { label: "Broadcasting to the network" },
  { label: "Awaiting confirmation" },
];

// A block arriving during proving forces a rebuild, sending the panel back to
// phase 0. Say why, or it reads as a stall.
const REBUILD_DESCRIPTION =
  "A new block arrived while your transaction was being proven, so it has to be " +
  "proven again against the new block, which restarts the wait.";

function phaseFromStatus(status: string): number {
  const match = status.match(/step (\d+)/);
  const step = match ? Number(match[1]) : 1;
  // Steps 1-4: transaction/proof construction. Steps 5-6: broadcast + bookkeeping.
  return step >= 5 ? 1 : 0;
}

export default function SendProgress({ status }: { status: string }) {
  // The panel mounts when a send starts; anchor the elapsed timer to that moment.
  const [startedAt] = useState(() => Math.floor(Date.now() / 1000));
  const current = phaseFromStatus(status);
  const rebuilding = status.includes("rebuild");

  return (
    <Card withBorder radius="md" padding="md">
      <Text fw={600} fz={16}>
        Sending transaction
      </Text>
      <Flex direction="column" gap={10} mt={10} mb={6}>
        {PHASES.map((phase, index) => {
          const done = index < current;
          const active = index === current;
          const description = index === 0 && rebuilding ? REBUILD_DESCRIPTION : phase.description;
          return (
            <Flex key={phase.label} direction="column" gap={2}>
              <Flex direction="row" gap={8} align="center">
                {done ? (
                  <IconCircleCheck size={18} color="var(--color-positive)" />
                ) : active ? (
                  <Loader size="xs" color="blue" />
                ) : (
                  <IconCircle size={18} color="var(--mantine-color-gray-4)" />
                )}
                <Text size="sm" fw={active ? 600 : 400} c={active || done ? undefined : "dimmed"}>
                  {phase.label}
                </Text>
                {/* A ticking elapsed timer proves liveness while proving runs. */}
                {active && index === 0 && (
                  <TimeClock
                    timeStamp={startedAt}
                    style={{ fontSize: 12, color: "var(--mantine-color-dimmed)" }}
                  />
                )}
              </Flex>
              {active && description && (
                <Text size="xs" c="dimmed" ml={26}>
                  {description}
                </Text>
              )}
            </Flex>
          );
        })}
      </Flex>
    </Card>
  );
}
