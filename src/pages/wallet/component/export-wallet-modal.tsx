import { ExportWallet } from "@/commands/wallet";
import { notify } from "@/utils/notify";
import {
  Alert,
  Box,
  Button,
  Center,
  Flex,
  FocusTrap,
  LoadingOverlay,
  Modal,
  PasswordInput,
  Text,
  Textarea,
} from "@mantine/core";
import {
  IconCircleCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconInfoCircle,
} from "@tabler/icons-react";
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
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [copyed, setCopyed] = useState(false);

  useEffect(() => {
    if (opened) {
      clearData();
    }
  }, [opened]);

  function clearData() {
    setValue("");
    setMnemonic("");
    setShowMnemonic(false);
    setCopyed(false);
  }

  async function exportWallet() {
    try {
      let mnemonicWordList = await ExportWallet(value, id);
      setMnemonic(mnemonicWordList.join(" "));
    } catch (error: any) {
      notify.error(error, "Please try again.", "Couldn't export account");
    }
  }
  function clickShowMnemonic() {
    setShowMnemonic(true);
    setTimeout(() => {
      setShowMnemonic(false);
    }, 12000);
  }

  return (
    <Modal opened={opened} onClose={close} title="Export account">
      <FocusTrap.InitialFocus />
      <Flex direction={"column"} gap={16} w={"100%"}>
        <Alert variant="light" color="red" title="" icon={<IconInfoCircle />}>
          Make sure no one is looking at your screen.
        </Alert>
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
                label="Recovery phrase"
                placeholder="Recovery phrase"
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
                    setShowMnemonic(!showMnemonic);
                  } else {
                    clickShowMnemonic();
                  }
                }}
              >
                {showMnemonic ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                <Text fz={14} fw={500}>
                  {showMnemonic ? "Hide recovery phrase" : "Reveal recovery phrase"}
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
            label="Enter password to continue"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
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
