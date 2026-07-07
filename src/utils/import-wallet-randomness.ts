import { importIncomingRandomness } from "@/commands/wallet";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { notify } from "./notify";

export interface IncomingUtxoRecoveryData {
  utxo: any;
  sender_randomness: string;
  receiver_preimage: string;
  aocl_index: number;
}

export async function handleImportRandomness(): Promise<void> {
  try {
    // 1. Open Tauri file dialog
    const selectedPath = await open({
      multiple: false,
      filters: [
        {
          name: "Neptune Incoming Randomness Data",
          extensions: ["dat"],
        },
      ],
    });

    if (!selectedPath || Array.isArray(selectedPath)) {
      // User canceled the dialog
      return;
    }

    // 2. Read the file contents
    const fileContents = await readTextFile(selectedPath);

    // 3. Parse the JSON Lines (JSONL) data
    const parsedData: IncomingUtxoRecoveryData[] = fileContents
      .split(/\r?\n/) // Split by newline, handles both \n and \r\n
      .filter((line) => line.trim() !== "") // Ignore empty lines (prevents JSON syntax errors)
      .map((line) => JSON.parse(line)); // Parse each individual line into an object

    console.log("Successfully parsed randomness:", parsedData);

    // 4. Pass the data Rust backend for processing
    const recoveredAmountStr = await importIncomingRandomness(parsedData);
    const recoveredAmount = Number(recoveredAmountStr);

    if (recoveredAmount > 0) {
      // Success Notification (Positive Amount)
      notify.success(
        `Successfully imported ${parsedData.length} records. Recovered amount: ${recoveredAmountStr} NPT.`,
        "Import successful"
      );
    } else {
      // Warning Notification (Zero Amount)
      notify.info(
        "Did not manage to recover any funds. Check the log for details.",
        "No funds recovered"
      );
    }
  } catch (error: any) {
    console.error("Failed to import randomness:", error);

    // Error Notification
    notify.error(error, "Failed to import randomness. Check the log for details.", "Import failed");
  }
}
