import { addWallet, setCurrentWallet } from "@/commands/wallet";
import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { useLatestBlock } from "@/store/sync/hooks";
import { queryLatestBlock } from "@/store/sync/sync-slice";
import { notify } from "@/utils/notify";
import {
  Box,
  Button,
  Center,
  Checkbox,
  Flex,
  Grid,
  LoadingOverlay,
  Text,
  TextInput,
} from "@mantine/core";
import { IconCircleCheck, IconCopy, IconEye, IconReload } from "@tabler/icons-react";
import { useSeedHideTimer } from "@/utils/use-seed-hide-timer";
import { useEffect, useState } from "react";

export default function CreateWallet({
  onCreated,
  mnemonic,
  refreshMnemonic,
}: {
  onCreated: () => void;
  mnemonic: string;
  refreshMnemonic: () => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const { serverUrl } = useSettingActionData();
  const [showCopyIcon, setShowCopyIcon] = useState(false);
  const [copyed, setCopyed] = useState(false);
  // Backup attestation gating Create (same pattern as the delete-account
  // modal's "I understand" checkbox): nothing says "this matters" like the
  // app refusing to proceed until the user confirms they wrote it down.
  const [acknowledged, setAcknowledged] = useState(false);
  const latestBlock = useLatestBlock();

  const dispatch = useAppDispatch();

  // Shared 60s auto-hide (see use-seed-hide-timer.ts): reveal restarts the
  // full window, never stacks.
  const { visible: visibleMnemonic, reveal: showMnemonic } = useSeedHideTimer();

  useEffect(() => {
    dispatch(queryLatestBlock({ serverUrl }));
  }, [dispatch, serverUrl]);
  async function handleCreate() {
    try {
      setLoading(true);
      let walletID = await addWallet(name, mnemonic, 25, latestBlock, true);
      await setCurrentWallet(walletID);
      onCreated();
      notify.success("Account created successfully!");
    } catch (error: any) {
      console.log(error);
      notify.error(error, "Please try again.", "Couldn't create account");
    }
    setLoading(false);
  }
  return (
    <Flex direction={"column"} gap={8} style={{ minHeight: "200px", marginTop: "8px" }}>
      <TextInput
        data-autofocus
        label="Account name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Enter a name for your account"
      />
      <Flex direction={"column"}>
        <Flex direction={"row"} gap={4}>
          <Text>Seed phrase</Text>
          <Text c="var(--input-asterisk-color, var(--mantine-color-error))">*</Text>
        </Flex>
        {/* Always-visible (not a tooltip): fund-loss consequences must not hide
            behind a hover. Mirrors the onboarding flow's wording. */}
        <Text size="sm" c="dimmed" mb={6}>
          Write these 18 words down and store them safely. They are the only way to recover this
          account — and anyone who has them can spend its funds.
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
                    // Match the "Reveal seed phrase" button: revealing via the
                    // cover must also flip to the revealed state (copy row + Create).
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
                          style={{
                            minWidth: "18px",
                            textAlign: "center",
                          }}
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
      </Flex>
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
              refreshMnemonic();
              showMnemonic();
              // The attestation referred to the OLD phrase; a new one must be
              // written down and confirmed again.
              setAcknowledged(false);
            }}
          >
            <IconReload size={16} />
            <Text fz={14} fw={500}>
              {"Change seed phrase"}
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

      {showCopyIcon && (
        <Checkbox
          mt="sm"
          px="lg"
          size="sm"
          label="I have written down my seed phrase"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.currentTarget.checked)}
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
        {showCopyIcon ? (
          <Button
            variant="light"
            fullWidth
            disabled={!name || !mnemonic || !acknowledged}
            loading={loading}
            onClick={handleCreate}
          >
            Create
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
            Reveal seed phrase
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
