import { set_password } from "@/commands/password";
import { addWallet } from "@/commands/wallet";
import { useAppDispatch } from "@/store/hooks";
import { useOneTimePassword, useOneTimeWalletName } from "@/store/wallet/hooks";
import { setOneTimePassword } from "@/store/wallet/wallet-slice";
import { notify } from "@/utils/notify";
import { Button, Flex, NumberInput, Stack, Text, Textarea, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useState } from "react";

export default function ImportCecret({ nextStep }: { nextStep: () => void }) {
  const [importData, setImportData] = useState({
    name: "",
    mnemonic: "",
    numKeys: 25,
    startHeight: 0,
  });
  const [loading, setLoading] = useState(false);
  const walletName = useOneTimeWalletName();
  const oneTimePassword = useOneTimePassword();
  const dispatch = useAppDispatch();

  async function handleImport() {
    setLoading(true);
    try {
      await set_password("", oneTimePassword);
      await addWallet(
        walletName,
        importData.mnemonic,
        importData.numKeys || 25,
        importData.startHeight || 0,
        false
      );
      dispatch(setOneTimePassword(""));
      nextStep();
    } catch (error: any) {
      notify.error(error, "Please try again.", "Couldn't import account");
    }
    setLoading(false);
  }

  return (
    <Flex direction="column" justify={"center"} align="center" gap={8} w={"100%"}>
      <Text fz={14} fw={600} style={{ textAlign: "center" }}>
        Access your account with your seed phrase.
      </Text>
      <Stack w={"100%"}>
        <Textarea
          label="Seed phrase"
          value={importData.mnemonic}
          onChange={(event) => {
            if (event && event.target.value) {
              let newValue = event.target.value
                .split("\n")
                .map((line) => line.replace(/^\d+\.\s*/, "").trim())
                .join(" ");
              setImportData({ ...importData, mnemonic: newValue });
            } else {
              setImportData({
                ...importData,
                mnemonic: "",
              });
            }
          }}
          placeholder="Enter your seed phrase"
          rows={4}
        />

        <Flex direction={"row"} gap={16} w={"100%"}>
          <NumberInput
            w={"50%"}
            label={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                Number of keys
                <Tooltip
                  label="How many derived addresses are scanned for funds. Set this to at least the number of addresses this account has ever created — too few silently misses funds. The default of 25 suits accounts with few addresses."
                  multiline
                  w={280}
                  withArrow
                  position="top"
                >
                  <IconInfoCircle size={13} style={{ opacity: 0.6, cursor: "help" }} />
                </Tooltip>
              </span>
            }
            placeholder="Enter the number of keys"
            min={1}
            hideControls
            thousandSeparator
            allowDecimal={false}
            allowNegative={false}
            value={importData.numKeys}
            onChange={(value) =>
              setImportData({
                ...importData,
                numKeys: Number(value),
              })
            }
          />
          <NumberInput
            w={"50%"}
            label={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                Start block height
                <Tooltip
                  label="Scanning for this account's funds starts from this block. Earlier blocks are skipped, so use a height at or before the account's first transaction — or leave 0 to scan the whole chain."
                  multiline
                  w={280}
                  withArrow
                  position="top"
                >
                  <IconInfoCircle size={13} style={{ opacity: 0.6, cursor: "help" }} />
                </Tooltip>
              </span>
            }
            thousandSeparator
            placeholder="Enter the start block height"
            min={0}
            hideControls
            allowDecimal={false}
            allowNegative={false}
            value={importData.startHeight}
            onChange={(value) =>
              setImportData({
                ...importData,
                startHeight: Number(value),
              })
            }
          />
        </Flex>
      </Stack>

      <Flex justify={"center"} align={"center"} w={"100%"} style={{ marginTop: "16px" }}>
        <Button
          variant="light"
          fullWidth
          disabled={!importData.mnemonic}
          loading={loading}
          onClick={handleImport}
        >
          Create a new wallet
        </Button>
      </Flex>
    </Flex>
  );
}
