import { Contact } from "@/database/types/contact";
import { queryAllContacts } from "@/store/contact/contact-slice";
import { useAllContacts } from "@/store/contact/hooks";
import { useAppDispatch } from "@/store/hooks";
import { sleep_milliseconds } from "@/utils/common";
import { notify } from "@/utils/notify";
import { addContactAddress } from "@/utils/storage";
import { Button, Flex, Modal, Text, Textarea, TextInput } from "@mantine/core";
import { useState } from "react";

export default function AddContact({ opened, close }: { opened: boolean; close: () => void }) {
  const [contact, setContact] = useState({
    aliasName: "",
    address: "",
    remark: "",
    type: "",
    createdTime: 0,
  } as Contact);
  const [loading, setLoading] = useState(false);
  const dispatch = useAppDispatch();
  const contacts = useAllContacts();

  // The backend keys update/delete on the address, so duplicates would be edited
  // and deleted together — block saving an address that already exists.
  const trimmedAddress = (contact.address ?? "").trim();
  const isDuplicate =
    trimmedAddress !== "" && (contacts ?? []).some((c) => c.address === trimmedAddress);

  async function handleSubmit() {
    if (isDuplicate) return;
    try {
      setLoading(true);
      contact.createdTime = new Date().getTime();
      addContactAddress({ contact: { ...contact, address: trimmedAddress } });
      notify.success("Contact added successfully");
      await sleep_milliseconds(100);
      dispatch(queryAllContacts());
      close();
    } catch (error: any) {
      console.error(error);
      notify.error(error, "Failed to add contact");
    }
    setLoading(false);
  }
  return (
    <Modal opened={opened} onClose={close} title="Add contact">
      <Flex direction="column" gap="md">
        <TextInput
          data-autofocus
          label="Name"
          value={contact.aliasName ?? ""}
          onChange={(event) => setContact({ ...contact, aliasName: event.target.value })}
          placeholder="Enter a name for this address"
        />
        <Flex direction={"column"}>
          <Flex direction={"row"} justify={"space-between"}>
            <Flex direction={"row"} gap={4}>
              <Text>Address</Text>
              <Text c="var(--input-asterisk-color, var(--mantine-color-error))">*</Text>
            </Flex>
          </Flex>
          <Textarea
            placeholder="Enter a public address"
            autosize
            minRows={4}
            value={contact.address ?? ""}
            error={isDuplicate ? "A contact with this address already exists" : undefined}
            onChange={(event) =>
              setContact({
                ...contact,
                address: event.target.value,
              })
            }
          />
        </Flex>
        <Button
          variant="light"
          loading={loading}
          disabled={!contact.aliasName || !contact.address || isDuplicate}
          onClick={handleSubmit}
        >
          Add
        </Button>
      </Flex>
    </Modal>
  );
}
