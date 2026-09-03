import { addWallet, setCurrentWallet } from "@/commands/wallet";
import { useLatestBlock } from "@/store/sync/hooks";
import { normalizeMnemonic } from "@/utils/mnemonic";
import { notify } from "@/utils/notify";
import { Button, Flex, NumberInput, Textarea, TextInput, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useState } from "react";

export default function ImportWallet({ onCreated }: { onCreated: () => void }) {
  const [importData, setImportData] = useState({
    name: "",
    mnemonic: "",
    numKeys: 25,
    startHeight: 0,
  });
  const [loading, setLoading] = useState(false);
  const latestBlock = useLatestBlock();
  // The backend rejects this too; checking here gives an inline error instead
  // of a failed import. Skipped while the tip is unknown (0).
  const aboveTip = latestBlock > 0 && importData.startHeight > latestBlock;

  async function handleImport() {
    try {
      setLoading(true);
      let walletID = await addWallet(
        importData.name,
        normalizeMnemonic(importData.mnemonic),
        importData.numKeys || 25,
        importData.startHeight || 0,
        false
      );
      await setCurrentWallet(walletID);
      onCreated();
    } catch (error: any) {
      console.log(error);
      notify.error(error, "Please try again.", "Couldn't import account");
    }
    setLoading(false);
  }

  function checkDisabled() {
    if (importData.name === "" || importData.mnemonic === "" || importData.numKeys === 0) {
      return true;
    }
    return aboveTip;
  }

  return (
    <Flex direction={"column"} gap={8} style={{ height: "100%", marginTop: "8px" }}>
      <TextInput
        label="Account name"
        data-autofocus
        placeholder="Enter a name for your account"
        value={importData.name}
        onChange={(event) =>
          setImportData({
            ...importData,
            name: event.target.value,
          })
        }
      />
      <Textarea
        label="Seed phrase"
        placeholder="Enter your seed phrase"
        autosize
        minRows={4}
        value={importData.mnemonic}
        onChange={(event) => {
          setImportData({ ...importData, mnemonic: event.target.value });
        }}
        onPaste={(event) => {
          // Pasted backups arrive numbered and multi-line; clean them visibly
          // at paste time so the field shows the words as imported.
          event.preventDefault();
          const el = event.currentTarget;
          const start = el.selectionStart ?? el.value.length;
          const end = el.selectionEnd ?? el.value.length;
          const pasted = event.clipboardData.getData("text");
          const next = normalizeMnemonic(
            `${el.value.slice(0, start)} ${pasted} ${el.value.slice(end)}`
          );
          setImportData({ ...importData, mnemonic: next });
        }}
      />
      <Flex direction={"row"} gap={16}>
        <NumberInput
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
          w={"50%"}
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
          w={"50%"}
          placeholder="Enter the start block height"
          min={0}
          max={latestBlock > 0 ? latestBlock : undefined}
          error={
            aboveTip ? `Above the current chain tip (${latestBlock.toLocaleString()})` : undefined
          }
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
      <Button
        variant="light"
        mt="md"
        disabled={checkDisabled()}
        loading={loading}
        onClick={handleImport}
      >
        Import
      </Button>
    </Flex>
  );
}
