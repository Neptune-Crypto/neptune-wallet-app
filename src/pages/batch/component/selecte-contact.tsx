import EmptyTable from "@/components/empty-table";
import MonoText from "@/components/mono-text";
import { Contact } from "@/database/types/contact";
import { queryAllContacts } from "@/store/contact/contact-slice";
import { useAllContacts, useLoadingContacts } from "@/store/contact/hooks";
import { useAppDispatch } from "@/store/hooks";
import {
  Box,
  Button,
  Checkbox,
  Flex,
  LoadingOverlay,
  Modal,
  ScrollArea,
  Table,
  Tabs,
  Text,
} from "@mantine/core";
import { useEffect, useState } from "react";

export default function SelecteContact({
  opened,
  close,
  selectedContact,
}: {
  opened: boolean;
  close: () => void;
  selectedContact: (contact: string) => void;
}) {
  const dispatch = useAppDispatch();
  const loading = useLoadingContacts();
  const contracts = useAllContacts();
  const [selectedAddress, setSelectedAddress] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string | null>("contacts");
  useEffect(() => {
    dispatch(queryAllContacts());
  }, [dispatch]);

  useEffect(() => {
    setSelectedAddress("");
    setActiveTab("contacts");
  }, [opened]);

  // Split the merged list so the picker can present saved contacts and the
  // wallet's own addresses (type "owner", useful for self-transfers) separately.
  const list = contracts ?? [];
  const contacts = list.filter((element) => element.type !== "owner");
  const myAccounts = list.filter((element) => element.type === "owner");

  const renderRow = (element: Contact) => (
    <Table.Tr
      key={element.address}
      bg={selectedAddress === element.address ? "var(--mantine-color-blue-light)" : undefined}
    >
      <Table.Td>
        <Checkbox
          aria-label="Select row"
          checked={selectedAddress === element.address}
          onChange={(event) =>
            setSelectedAddress(event.currentTarget.checked ? element.address : "")
          }
        />
      </Table.Td>
      <Table.Td>
        <Text style={{ minWidth: "115px" }}>{element.aliasName}</Text>
      </Table.Td>
      <Table.Td>
        <MonoText value={element.address} />
      </Table.Td>
    </Table.Tr>
  );

  const renderTable = (items: Contact[]) =>
    items.length > 0 ? (
      <ScrollArea h={"420px"} type="auto" scrollbarSize={8} offsetScrollbars>
        <Table
          stickyHeader
          verticalSpacing="sm"
          striped
          highlightOnHover
          styles={{
            thead: {
              fontSize: "14px",
              fontWeight: 600,
            },
          }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th></Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Address</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>{items.map(renderRow)}</Table.Tbody>
        </Table>
      </ScrollArea>
    ) : (
      // The empty state is shared by both tabs — word it for whichever is open.
      <EmptyTable message={activeTab === "accounts" ? "No other accounts" : "No saved contacts"} />
    );

  return (
    <Modal size={"lg"} opened={opened} onClose={close} title="Select contact to send">
      <Flex direction={"column"} gap={16}>
        <Box pos="relative">
          <LoadingOverlay
            visible={loading}
            zIndex={1000}
            overlayProps={{ radius: "sm", blur: 2 }}
            loaderProps={{ color: "blue" }}
          />
          <Tabs value={activeTab} onChange={setActiveTab}>
            <Tabs.List mb="sm">
              <Tabs.Tab value="contacts">Contacts</Tabs.Tab>
              <Tabs.Tab value="accounts">My accounts</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="contacts">{renderTable(contacts)}</Tabs.Panel>
            <Tabs.Panel value="accounts">{renderTable(myAccounts)}</Tabs.Panel>
          </Tabs>
        </Box>
        <Button
          variant={"light"}
          fullWidth
          disabled={!selectedAddress}
          onClick={() => selectedContact(selectedAddress)}
        >
          Confirm
        </Button>
      </Flex>
    </Modal>
  );
}
