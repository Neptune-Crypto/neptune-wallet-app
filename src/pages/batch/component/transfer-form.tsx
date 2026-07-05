import { SendInputItem } from "@/utils/api/types.ts";
import { ActionIcon, Flex, NumberInput, Text, TextInput } from "@mantine/core";
import { IconAddressBook, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import SelecteContact from "./selecte-contact";

interface Props {
  keyIndex: number;
  data: SendInputItem;
  showRemove: boolean;
  onChangeToAddress: (address: string) => void;
  onChangeAmount: (amount: string) => void;
  onRemoveWallet?: (index: number) => void;
}

export default function TransferForm(props: Props) {
  const { keyIndex, showRemove, data, onRemoveWallet, onChangeToAddress, onChangeAmount } = props;
  const [showSelectContactModal, setShowSelectContactModal] = useState(false);
  return (
    <Flex direction={"column"} gap={4} key={data.index}>
      <SelecteContact
        opened={showSelectContactModal}
        close={() => setShowSelectContactModal(false)}
        selectedContact={(contact) => {
          onChangeToAddress(contact);
          setShowSelectContactModal(false);
        }}
      />
      <Flex direction={"row"} justify={"space-between"} align={"center"}>
        <Flex direction={"row"} gap={4} align={"center"}>
          <Text fz={16} fw={600}>
            {showRemove ? `Address ${keyIndex + 1}` : "Address"}
          </Text>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="lg"
            aria-label="Choose from contacts"
            onClick={() => setShowSelectContactModal(true)}
          >
            <IconAddressBook size={18} />
          </ActionIcon>
        </Flex>
        {showRemove && (
          <ActionIcon
            variant="subtle"
            color="red"
            size="lg"
            aria-label="Remove address"
            onClick={() => {
              if (onRemoveWallet) {
                onRemoveWallet(data.index);
              }
            }}
          >
            <IconTrash size={18} />
          </ActionIcon>
        )}
      </Flex>
      <Flex direction={"row"} gap={16} align={"flex-start"} wrap={"wrap"}>
        <TextInput
          style={{ flex: 1, minWidth: 240 }}
          value={data.toAddress}
          onChange={(event) => {
            onChangeToAddress(event.target.value.trim());
          }}
          required
          placeholder="Enter address"
        />
        <NumberInput
          w={200}
          placeholder="Enter amount"
          allowNegative={false}
          value={data.amount}
          onChange={(value) => {
            onChangeAmount(value.toString());
          }}
          required
          hideControls
          rightSection={
            <Text size="sm" c="dimmed">
              NPT
            </Text>
          }
          rightSectionWidth={48}
        />
      </Flex>
    </Flex>
  );
}
