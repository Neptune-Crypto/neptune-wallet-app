import { Contact } from "@/database/types/contact";
import { queryAllContacts } from "@/store/contact/contact-slice";
import { useAppDispatch } from "@/store/hooks";
import { updateContactAddress } from "@/utils/storage";
import { Button, Flex, Modal, Text, Textarea, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
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

  // Re-sync the form whenever a different contact is opened for editing.
  useEffect(() => {
    if (contact) {
      setAliasName(contact.aliasName);
      setAddress(contact.address);
    }
  }, [contact]);

  async function handleSubmit() {
    if (!contact) return;
    try {
      setLoading(true);
      const updated: Contact = {
        ...contact,
        aliasName,
        address: address.trim(),
      };
      await updateContactAddress({ originalAddress: contact.address, contact: updated });
      notifications.show({
        position: "top-right",
        message: "Contact updated successfully",
        color: "green",
      });
      dispatch(queryAllContacts());
      close();
    } catch (error: any) {
      console.error(error);
      notifications.show({
        position: "top-right",
        message: error || "Failed to update contact",
        color: "red",
      });
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
            onChange={(event) => setAddress(event.target.value)}
          />
        </Flex>
        <Button
          variant="light"
          loading={loading}
          disabled={!aliasName || !address.trim()}
          onClick={handleSubmit}
        >
          Save
        </Button>
      </Flex>
    </Modal>
  );
}
