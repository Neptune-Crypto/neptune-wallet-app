import { useMnemonic } from "@/store/wallet/hooks";
import { Box, Button, Center, Flex, Grid, LoadingOverlay, Text } from "@mantine/core";
import { IconCircleCheck, IconCopy, IconEye, IconReload } from "@tabler/icons-react";
import { useState } from "react";

import { useAppDispatch } from "@/store/hooks";
import { setMnemonic } from "@/store/wallet/wallet-slice";
import { notify } from "@/utils/notify";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
interface Props {
  nextStep: () => void;
}
export default function SecureWallet(props: Props) {
  const { nextStep } = props;
  const mnemonic = useMnemonic();
  const [showCopyIcon, setShowCopyIcon] = useState(false);
  const [visibleMnemonic, setVisibleMnemonic] = useState(false);
  const [copyed, setCopyed] = useState(false);
  const dispatch = useAppDispatch();

  function showMnemonic() {
    setVisibleMnemonic(true);
    setTimeout(() => {
      setVisibleMnemonic(false);
    }, 50000);
  }

  return (
    <Flex direction="column" justify={"center"} align="center" gap={8} w={"100%"}>
      <Text fz={14} fw={600} style={{ textAlign: "center" }}>
        Write down this 18-word recovery phrase and save it in a place that you trust and only you
        can access.
      </Text>
      <Box pos="relative">
        <LoadingOverlay
          visible={!visibleMnemonic}
          overlayProps={{ radius: "sm", blur: 4, color: "#eee", backgroundOpacity: 0.98 }}
          loaderProps={{
            children: (
              <Center
                style={{ cursor: "pointer" }}
                onClick={() => {
                  // Match the "Reveal recovery phrase" button: revealing via the
                  // cover must also flip to the revealed state (copy row + Next).
                  setShowCopyIcon(true);
                  showMnemonic();
                }}
              >
                <Flex direction={"column"} align={"center"}>
                  <IconEye />
                  <Text>Make sure nobody is looking</Text>
                </Flex>
              </Center>
            ),
          }}
        />
        <Box
          style={{
            width: "100%",
            border: "1px solid var(--mantine-color-gray-3)",
            borderRadius: "8px",
            padding: "16px",
            backgroundColor: "var(--mantine-color-gray-0)",
          }}
        >
          <Grid>
            {mnemonic &&
              mnemonic.split(" ").map((word, index) => {
                return (
                  <Grid.Col span={4} key={index}>
                    <Flex direction={"row"} justify={"center"} align={"center"} gap={8}>
                      <Text
                        style={{ minWidth: "18px", textAlign: "center" }}
                        size="sm"
                        c="dimmed"
                        fw={500}
                      >{`${index + 1}.`}</Text>
                      <Flex
                        style={{
                          border: "1px solid var(--mantine-color-gray-3)",
                          borderRadius: "6px",
                          padding: "4px 8px",
                          minWidth: "120px",
                          backgroundColor: "#ffffff",
                        }}
                        justify={"center"}
                      >
                        <Text>{word}</Text>
                      </Flex>
                    </Flex>
                  </Grid.Col>
                );
              })}
          </Grid>
        </Box>
      </Box>

      {showCopyIcon ? (
        <Flex
          direction={"row"}
          px={"lg"}
          justify={"space-between"}
          align={"center"}
          w={"100%"}
          mt="sm"
        >
          <Flex
            direction={"row"}
            align={"center"}
            gap={8}
            style={{ cursor: "pointer", caretColor: "transparent" }}
            onClick={() => {
              dispatch(setMnemonic(bip39.generateMnemonic(wordlist, 192)));
              showMnemonic();
              notify.success("New recovery phrase generated");
            }}
          >
            <IconReload size={16} />
            <Text fz={14} fw={500}>
              {"Change recovery phrase"}
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
              <IconCircleCheck size={16} color="var(--color-positive)" />
            ) : (
              <IconCopy size={16} />
            )}
            <Text fz={14} fw={500}>
              {copyed ? "Copied" : "Copy to clipboard"}
            </Text>
          </Flex>
        </Flex>
      ) : null}
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
        {showCopyIcon ? (
          <Button variant="light" fullWidth onClick={nextStep}>
            Next
          </Button>
        ) : (
          <Button
            variant="light"
            fullWidth
            onClick={() => {
              setShowCopyIcon(true);
              showMnemonic();
            }}
          >
            Reveal recovery phrase
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
