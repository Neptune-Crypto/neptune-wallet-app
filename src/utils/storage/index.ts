import { persist_store_execute } from "@/commands/app";
import { Contact } from "@/database/types/contact";
import { ExecutionDbHistory, ExecutionHistory } from "@/database/types/localhistory";
import { notifications } from "@mantine/notifications";

export async function addContactAddress({ contact }: { contact: Contact }): Promise<boolean> {
  const sql = `
  INSERT INTO contacts (aliasName, address, type, remark, createdTime)
  VALUES (?, ?, ?, ?, ?)
  `;

  const params = [
    contact.aliasName,
    contact.address,
    contact.type,
    contact.remark,
    contact.createdTime,
  ];

  try {
    await persist_store_execute(sql, params);
    return true;
  } catch (error) {
    console.error("Failed to insert contact:", error);
    throw error;
  }
}

export async function deleteContactAddress({ address }: { address: string }): Promise<boolean> {
  const sql = `
  DELETE FROM contacts WHERE address = ?
  `;

  const params = [address];

  try {
    await persist_store_execute(sql, params);
    return true;
  } catch (error) {
    console.error("Failed to delete contact:", error);
    throw error;
  }
}

export async function getContactList(): Promise<Contact[]> {
  const sql = `
  SELECT * FROM contacts
  `;

  const params: string[] = [];

  let contactList = [] as Contact[];
  try {
    let req = await persist_store_execute(sql, params);
    if (req && req.length > 0) {
      contactList = req as unknown as Contact[];
    }
  } catch (error) {
    console.error("Failed to get contact list:", error);
    throw error;
  }

  return contactList;
}

export async function getExecutionHistory({
  addressId,
}: {
  addressId: number;
}): Promise<ExecutionHistory[]> {
  const sql = `
  SELECT * FROM execution_history WHERE addressId = ? ORDER BY timestamp DESC
  `;

  const params = [addressId];

  let historys = [] as ExecutionHistory[];
  try {
    let req = await persist_store_execute(sql, params);
    let list = req as unknown as ExecutionDbHistory[];
    list.map((item) => {
      historys.push({
        ...item,
        outputs:
          item.status && item.status != "" && item.status != "[]" && item.status != "undefined"
            ? JSON.parse(item.status)
            : [],
        batchOutput:
          item.batchOutput &&
          item.batchOutput != "" &&
          item.batchOutput != "[]" &&
          item.batchOutput != "undefined"
            ? JSON.parse(item.batchOutput)
            : [],
      });
    });
  } catch (error) {
    console.error("Failed to get execution history:", error);
    throw error;
  }

  return historys;
}

export async function addExecutionHistory({ localHistory }: { localHistory: ExecutionHistory }) {
  const sql = `
  INSERT INTO execution_history (
    txid,
    timestamp,
    height,
    addressId,
    address,
    fee,
    priorityFee,
    status,
    batchOutput
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    localHistory.txid,
    localHistory.timestamp,
    localHistory.height,
    localHistory.addressId,
    localHistory.address,
    localHistory.fee,
    localHistory.priorityFee,
    localHistory.outputs.length > 0 ? JSON.stringify(localHistory.outputs) : "",
    localHistory.batchOutput.length > 0 ? JSON.stringify(localHistory.batchOutput) : "",
  ];

  try {
    await persist_store_execute(sql, params);
    return true;
  } catch (error: any) {
    console.log("Failed to insert execution history:", error);
    notifications.show({
      position: "top-right",
      message: error,
      color: "red",
      title: "Error",
    });
    return false;
  }
}

export async function deleteExecutionHistory({ txid }: { txid: string }): Promise<boolean> {
  const sql = `
  DELETE FROM execution_history WHERE txid = ?
  `;

  const params = [txid];
  try {
    await persist_store_execute(sql, params);
    return true;
  } catch (error: any) {
    console.log("Failed to delete execution history element:", error);
    notifications.show({
      position: "top-right",
      message: error,
      color: "red",
      title: "Error",
    });
    return false;
  }
}
