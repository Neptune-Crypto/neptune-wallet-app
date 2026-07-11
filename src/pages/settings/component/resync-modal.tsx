import { resetToHeight } from "@/commands/wallet";
import { notify } from "@/utils/notify";
import { Alert, Button, Flex, FocusTrap, Modal, NumberInput, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";

export default function ResyncModal({ opened, close }: { opened: boolean; close: () => void }) {
  const [height, setHeight] = useState("0");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setHeight("0");
    setLoading(false);
  }, [opened]);

  async function resyncHeight() {
    setLoading(true);
    try {
      await resetToHeight(Number(height));
      // The rollback is done; the forward re-scan continues in the background
      // (progress shows on the sidebar sync card).
      notify.success(`Re-scanning the chain from block ${height}.`, "Resync started");
      close();
    } catch (error: any) {
      // Sticky: a failed resync is an outcome the user must see, and they may
      // have walked away expecting a long rebuild.
      notify.error(error, "Please try again.", "Couldn't resync account", { sticky: true });
    }
    setLoading(false);
  }
  return (
    <Modal opened={opened} onClose={close} title="Resync account history" centered>
      <FocusTrap.InitialFocus />
      <Flex direction="column" gap={16}>
        {/* Education, not just a warning: when to use it, what it does, and that
            it is safe (a local-only rebuild: rollback + forward re-scan). */}
        <Alert variant="light" color="yellow">
          <Stack gap={8}>
            <Text size="sm">
              <b>When to use this:</b> if the active account's balance or history looks wrong or
              incomplete — for example after importing with a too-recent start height, or if a
              transaction seems to be missing.
            </Text>
            <Text size="sm">
              Resyncing rolls the active account's local records back to the chosen height and
              re-scans the blockchain forward to rebuild them. <b>Your coins are never affected</b>{" "}
              — this only rebuilds this app's local view. It can take a while, like the original
              sync.
            </Text>
          </Stack>
        </Alert>
        <NumberInput
          label="Resync start height"
          description="Use a height at or before the active account's first transaction. 0 re-scans the whole chain — slowest, but always correct."
          placeholder="Enter height"
          thousandSeparator=","
          rightSection={null}
          value={height}
          allowDecimal={false}
          allowNegative={false}
          hideControls
          onChange={(value) => setHeight(value.toString())}
          min={0}
        />
        <Button
          loading={loading}
          variant={"light"}
          disabled={!height}
          onClick={() => resyncHeight()}
        >
          Resync
        </Button>
      </Flex>
    </Modal>
  );
}
