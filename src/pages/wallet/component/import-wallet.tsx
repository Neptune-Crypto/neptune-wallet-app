import { addWallet, setCurrentWallet } from "@/commands/wallet";
import { notify } from "@/utils/notify";
import { Button, Flex, NumberInput, Textarea, TextInput } from "@mantine/core";
import { useState } from "react";

export default function ImportWallet({ onCreated }: { onCreated: () => void }) {
  const [importData, setImportData] = useState({
    name: "",
    mnemonic: "",
    numKeys: 25,
    startHeight: 0,
  });
  const [loading, setLoading] = useState(false);

  async function handleImport() {
    try {
      setLoading(true);
      let walletID = await addWallet(
        importData.name,
        importData.mnemonic,
        importData.numKeys || 25,
        importData.startHeight || 0,
        false
      );
      await setCurrentWallet(walletID);
      onCreated();
    } catch (error: any) {
      console.log(error);
      notify.error(error, "Failed to import account");
    }
    setLoading(false);
  }

  function checkDisabled() {
    if (importData.name === "" || importData.mnemonic === "" || importData.numKeys === 0) {
      return true;
    }
    return false;
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
        label="Recovery phrase"
        placeholder="Enter your recovery phrase"
        autosize
        minRows={4}
        value={importData.mnemonic}
        onChange={(event) => {
          if (event && event.target.value) {
            let newValue = event.target.value
              .split("\n")
              .map((line) => line.replace(/^\d+\.\s*/, "").trim())
              .join(" ");
            setImportData({
              ...importData,
              mnemonic: newValue,
            });
          } else {
            setImportData({
              ...importData,
              mnemonic: "",
            });
          }
        }}
      />
      <Flex direction={"row"} gap={16}>
        <NumberInput
          label="Number of keys"
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
          label="Start height"
          thousandSeparator
          w={"50%"}
          placeholder="Enter the start height"
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
      <Button variant="light" disabled={checkDisabled()} loading={loading} onClick={handleImport}>
        Import
      </Button>
    </Flex>
  );
}
