import { ExportWallet } from "@/commands/wallet";
import { notify } from "@/utils/notify";
import {
  Box,
  Button,
  Center,
  Flex,
  LoadingOverlay,
  Modal,
  PasswordInput,
  Text,
  Textarea,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
} from "@tabler/icons-react";
import { useSeedHideTimer } from "@/utils/use-seed-hide-timer";
import { useEffect, useState } from "react";

interface Props {
  id: number;
  opened: boolean;
  closeModal: () => void;
}
export default function ExportWalletModal(props: Props) {
  const { opened, closeModal: close, id } = props;
  const [value, setValue] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [copyed, setCopyed] = useState(false);
  // Shared 60s auto-hide (see use-seed-hide-timer.ts): reveal restarts the
  // full window, never stacks; manual hide retires the timer.
  const {
    visible: showMnemonic,
    reveal: clickShowMnemonic,
    hide: hideMnemonic,
  } = useSeedHideTimer();

  useEffect(() => {
    if (opened) {
      clearData();
    }
  }, [opened]);

  function clearData() {
    setValue("");
    setMnemonic("");
    hideMnemonic();
    setCopyed(false);
  }

  async function exportWallet() {
    try {
      let mnemonicWordList = await ExportWallet(value, id);
      setMnemonic(mnemonicWordList.join(" "));
    } catch (error: any) {
      notify.error(error, "Please try again.", "Couldn't show seed phrase");
    }
  }
  return (
    <Modal opened={opened} onClose={close} title="View seed phrase">
      <Flex direction={"column"} gap={16} w={"100%"}>
        {/* Confidentiality/anti-phishing warning — the message the reveal cover
            does NOT carry (the cover handles shoulder-surfing). This modal is
            where scam victims get directed ("support" asking for the seed), so
            the "nobody legitimate will ever ask" line lives here. Styling
            matches the send confirm modal's warning (icon orange-6; text tone
            is AA-checked there — no stock Mantine orange clears 4.5:1 at this
            size on white). */}
        <Flex align="flex-start" gap={6}>
          <IconAlertTriangle
            size={14}
            color="var(--mantine-color-orange-6)"
            style={{ flexShrink: 0, marginTop: 2 }}
          />
          <Text size="xs" c="#c2410c" fw={500}>
            Never share your seed phrase. Anyone who has it can spend this account's funds — and
            no legitimate support will ever ask for it.
          </Text>
        </Flex>
        {mnemonic ? (
          <Flex direction={"column"} gap={16}>
            <Box pos="relative">
              <LoadingOverlay
                visible={!showMnemonic}
                overlayProps={{
                  radius: "sm",
                  blur: 20,
                  color: "#eee",
                  backgroundOpacity: 0.98,
                }}
                loaderProps={{
                  children: (
                    <Center style={{ cursor: "pointer" }} onClick={() => clickShowMnemonic()}>
                      <Flex direction={"column"} align={"center"}>
                        <IconEye />
                        <Text>Make sure nobody is looking</Text>
                      </Flex>
                    </Center>
                  ),
                }}
              />
              <Textarea
                label="Seed phrase"
                placeholder="Seed phrase"
                value={mnemonic}
                readOnly
                autosize
                minRows={3}
                maxRows={3}
              />
            </Box>
            <Flex direction={"row"} px={"lg"} justify={"space-between"} align={"center"} w={"100%"}>
              <Flex
                direction={"row"}
                align={"center"}
                gap={8}
                style={{ cursor: "pointer", caretColor: "transparent" }}
                onClick={() => {
                  if (showMnemonic) {
                    hideMnemonic();
                  } else {
                    clickShowMnemonic();
                  }
                }}
              >
                {showMnemonic ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                <Text fz={14} fw={500}>
                  {showMnemonic ? "Hide seed phrase" : "Reveal seed phrase"}
                </Text>
              </Flex>
              <Flex
                direction={"row"}
                align={"center"}
                gap={8}
                style={{ cursor: "pointer", caretColor: "transparent" }}
                onClick={() => {
                  if (copyed) {
                    return;
                  }
                  navigator.clipboard.writeText(mnemonic);
                  setCopyed(true);
                  setTimeout(() => {
                    setCopyed(false);
                  }, 2000);
                }}
              >
                {copyed ? (
                  <IconCircleCheck size={14} color="var(--color-positive)" />
                ) : (
                  <IconCopy size={14} />
                )}
                <Text fz={14} fw={500}>
                  {copyed ? "Copied" : "Copy to clipboard"}
                </Text>
              </Flex>
            </Flex>
          </Flex>
        ) : (
          <PasswordInput
            // Single-purpose modal: focus the one input so typing can start
            // immediately (lock screen / rename modal convention).
            data-autofocus
            label="Enter password to continue"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              // Enter submits — same gate as the Confirm button (the lock
              // screen and rename modal already follow this convention).
              if (event.key === "Enter" && value) {
                exportWallet();
              }
            }}
          />
        )}
        <Flex
          direction={"row"}
          align={"center"}
          justify={"center"}
          gap={8}
          style={{
            cursor: "pointer",
            caretColor: "transparent",
            marginTop: "16px",
          }}
          w={"100%"}
        >
          {mnemonic ? (
            <Flex direction={"row"} gap={16} w={"100%"}>
              <Button variant="default" fullWidth disabled={!value} onClick={close}>
                Close
              </Button>
            </Flex>
          ) : (
            <Button fullWidth variant="light" disabled={!value} onClick={exportWallet}>
              Confirm
            </Button>
          )}
        </Flex>
      </Flex>
    </Modal>
  );
}
