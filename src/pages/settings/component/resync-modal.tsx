import { resetToHeight } from "@/commands/wallet";
import { notify } from "@/utils/notify";
import { Alert, Button, Flex, FocusTrap, Modal, NumberInput } from "@mantine/core";
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
      notify.success("Resync Block Height Successfully!");
      close();
    } catch (error: any) {
      notify.error(error, "Resync Block Height Failed!");
    }
    setLoading(false);
  }
  return (
    <Modal opened={opened} onClose={close} title="Resync block" centered>
      <FocusTrap.InitialFocus />
      <Flex direction="column" gap={16}>
        <Alert variant="light" color="yellow">
          Reset all historical records of the current account and resync the height.
        </Alert>
        <NumberInput
          label="Resync start height"
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
