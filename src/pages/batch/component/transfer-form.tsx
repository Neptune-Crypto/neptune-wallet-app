import { SendInputItem } from "@/utils/api/types.ts";
import { Flex, NumberInput, Text, TextInput } from "@mantine/core";
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
        <Text style={{ fontSize: "16px", fontWeight: 600 }}>
          {showRemove ? `Recipient ${keyIndex + 1}` : "Recipient"}
        </Text>
        <Flex direction={"row"} gap={8} align={"center"}>
          <IconAddressBook
            style={{
              color: "#332526",
            }}
            size={20}
            cursor={"pointer"}
            onClick={() => setShowSelectContactModal(true)}
          />
          {showRemove && (
            <IconTrash
              style={{ cursor: "pointer", color: "red" }}
              size={14}
              onClick={() => {
                if (onRemoveWallet) {
                  onRemoveWallet(data.index);
                }
              }}
            />
          )}
        </Flex>
      </Flex>
      <Flex direction={"row"} gap={16} align={"flex-start"} wrap={"wrap"}>
        <TextInput
          style={{ flex: 1, minWidth: 240 }}
          value={data.toAddress}
          onChange={(event) => {
            onChangeToAddress(event.target.value.trim());
          }}
          required
          placeholder="Enter recipient address"
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
