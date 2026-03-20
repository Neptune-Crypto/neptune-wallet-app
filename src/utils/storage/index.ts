import {
  add_contact_address_execute,
  add_execution_history_execute,
  delete_contact_address_execute,
  delete_execution_history_execute,
  get_contact_list_execute,
  get_execution_history_execute,
} from "@/commands/app";
import { Contact } from "@/database/types/contact";
import { ExecutionDbHistory, ExecutionHistory } from "@/database/types/localhistory";
import { notifications } from "@mantine/notifications";

export async function addContactAddress({ contact }: { contact: Contact }): Promise<boolean> {
  const params = [
    contact.aliasName,
    contact.address,
    contact.type,
    contact.remark,
    contact.createdTime,
  ];

  try {
    await add_contact_address_execute(params);
    return true;
  } catch (error) {
    console.error("Failed to insert contact:", error);
    throw error;
  }
}

export async function deleteContactAddress({ address }: { address: string }): Promise<boolean> {
  const params = [address];

  try {
    await delete_contact_address_execute(params);
    return true;
  } catch (error) {
    console.error("Failed to delete contact:", error);
    throw error;
  }
}

export async function getContactList(): Promise<Contact[]> {
  let contactList = [] as Contact[];
  try {
    let req = await get_contact_list_execute();
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
  const params = [addressId];

  let historys = [] as ExecutionHistory[];
  try {
    let req = await get_execution_history_execute(params);
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
    await add_execution_history_execute(params);
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
  const params = [txid];
  try {
    await delete_execution_history_execute(params);
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
