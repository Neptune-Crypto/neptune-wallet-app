import { TimeClock } from "@/components/TimeClock";
import { Alert, Flex, Loader, Text } from "@mantine/core";
import { IconCircle, IconCircleCheck, IconInfoCircle } from "@tabler/icons-react";
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
  { label: "Done" },
];

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

  return (
    <Alert variant="light" color="blue" title="Sending transaction" icon={<IconInfoCircle />}>
      <Flex direction="column" gap={10} mt={4} mb={6}>
        {PHASES.map((phase, index) => {
          const done = index < current;
          const active = index === current;
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
              {active && phase.description && (
                <Text size="xs" c="dimmed" ml={26}>
                  {phase.description}
                </Text>
              )}
            </Flex>
          );
        })}
      </Flex>
    </Alert>
  );
}
