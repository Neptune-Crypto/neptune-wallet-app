import { Contact } from "@/database/types/contact";
import { queryAllContacts } from "@/store/contact/contact-slice";
import { useAllContacts } from "@/store/contact/hooks";
import { useAppDispatch } from "@/store/hooks";
import { notify } from "@/utils/notify";
import { updateContactAddress } from "@/utils/storage";
import { Button, Flex, Modal, Text, Textarea, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";

export default function EditContact({
  opened,
  close,
  contact,
}: {
  opened: boolean;
  close: () => void;
  contact: Contact | null;
}) {
  const [aliasName, setAliasName] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const dispatch = useAppDispatch();
  const contacts = useAllContacts();

  // Block changing the address to one another contact already uses (the backend
  // keys update/delete on the address). The contact's own address is allowed.
  const trimmedAddress = address.trim();
  const isDuplicate =
    trimmedAddress !== "" &&
    trimmedAddress !== contact?.address &&
    (contacts ?? []).some((c) => c.address === trimmedAddress);

  // Re-sync the form whenever a different contact is opened for editing.
  useEffect(() => {
    if (contact) {
      setAliasName(contact.aliasName);
      setAddress(contact.address);
    }
  }, [contact]);

  async function handleSubmit() {
    if (!contact || isDuplicate) return;
    try {
      setLoading(true);
      const updated: Contact = {
        ...contact,
        aliasName,
        address: address.trim(),
      };
      await updateContactAddress({ originalAddress: contact.address, contact: updated });
      notify.success("Contact updated successfully");
      dispatch(queryAllContacts());
      close();
    } catch (error: any) {
      console.error(error);
      notify.error(error, "Failed to update contact");
    }
    setLoading(false);
  }

  return (
    <Modal opened={opened} onClose={close} title="Edit contact">
      <Flex direction="column" gap="md">
        <TextInput
          data-autofocus
          label="Name"
          value={aliasName}
          onChange={(event) => setAliasName(event.target.value)}
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
            value={address}
            error={isDuplicate ? "A contact with this address already exists" : undefined}
            onChange={(event) => setAddress(event.target.value)}
          />
        </Flex>
        <Button
          variant="light"
          loading={loading}
          disabled={!aliasName || !address.trim() || isDuplicate}
          onClick={handleSubmit}
        >
          Save
        </Button>
      </Flex>
    </Modal>
  );
}
