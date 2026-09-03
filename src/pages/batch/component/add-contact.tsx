import { Contact } from "@/database/types/contact";
import { queryAllContacts } from "@/store/contact/contact-slice";
import { useAllContacts } from "@/store/contact/hooks";
import { useAppDispatch } from "@/store/hooks";
import { notify } from "@/utils/notify";
import { addContactAddress } from "@/utils/storage";
import { useAddressValidation } from "@/utils/use-address-validation";
import { Badge, Button, Flex, Modal, Text, Textarea, TextInput } from "@mantine/core";
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
  const { invalid: isInvalidAddress, keyType: addressKeyType } =
    useAddressValidation(trimmedAddress);

  async function handleSubmit() {
    if (isDuplicate) return;
    try {
      setLoading(true);
      await addContactAddress({
        contact: { ...contact, address: trimmedAddress, createdTime: Date.now() },
      });
      notify.success("Contact added successfully");
      dispatch(queryAllContacts());
      close();
    } catch (error: any) {
      console.error(error);
      notify.error(error, "Please try again.", "Couldn't add contact");
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
        <Flex direction={"column"} gap={4}>
          <Flex direction={"row"} justify={"space-between"}>
            <Flex direction={"row"} gap={4} align="center">
              {/* Matches the built-in Mantine input label (as on the Name
                  field above), so the two fields read as one form. */}
              <Text size="sm" fw={500}>
                Address
              </Text>
              <Text size="sm" fw={500} c="var(--input-asterisk-color, var(--mantine-color-error))">
                *
              </Text>
              {addressKeyType && !isDuplicate && (
                <Badge variant="light" color="gray" radius="sm" tt="none" fw={500}>
                  {addressKeyType}
                </Badge>
              )}
            </Flex>
          </Flex>
          <Textarea
            placeholder="Enter a public address"
            autosize
            minRows={4}
            value={contact.address ?? ""}
            error={
              isDuplicate
                ? "A contact with this address already exists"
                : isInvalidAddress
                  ? "Not a valid address for this network"
                  : undefined
            }
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
          disabled={!contact.aliasName || !contact.address || isDuplicate || isInvalidAddress}
          onClick={handleSubmit}
        >
          Add
        </Button>
      </Flex>
    </Modal>
  );
}
