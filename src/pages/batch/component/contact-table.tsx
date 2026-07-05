import CopyedIcon from "@/components/copyed-icon";
import EmptyTable from "@/components/empty-table";
import { queryAllContacts } from "@/store/contact/contact-slice";
import { useAllContacts, useLoadingContacts } from "@/store/contact/hooks";
import { useAppDispatch } from "@/store/hooks";
import { Contact } from "@/database/types/contact";
import { ellipsis } from "@/utils/ellipsis-format";
import { deleteContactAddress } from "@/utils/storage";
import { Box, Button, Center, Flex, LoadingOverlay, ScrollArea, Table, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import AddContact from "./add-contact";
import EditContact from "./edit-contact";

export default function ContactTable({ height = "450px" }: { height?: string } = {}) {
  const loading = useLoadingContacts();
  const contracts = useAllContacts();
  // This page manages user-saved contacts only. A wallet's own addresses (type
  // "owner") are merged into the shared list for the Send picker, but are not
  // contacts you manage here, so exclude them.
  const customContacts = (contracts ?? []).filter((element) => element.type !== "owner");
  const dispatch = useAppDispatch();
  const [showAddContact, setShowAddContact] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  async function handleDelete(address: string) {
    try {
      await deleteContactAddress({ address });
      dispatch(queryAllContacts());
      notifications.show({
        position: "top-right",
        title: "Success",
        message: "Delete contact successfully",
        color: "green",
      });
    } catch (error: any) {
      notifications.show({
        position: "top-right",
        title: "Error",
        message: error || "Delete contact failed",
        color: "red",
      });
    }
  }
  const rows = customContacts.map((element) => (
    <Table.Tr key={element.address}>
      <Table.Td>
        <Text style={{ minWidth: "115px" }}>{element.aliasName}</Text>
      </Table.Td>
      <Table.Td>
        <Flex direction={"row"} gap={8} align={"center"}>
          <Text>{ellipsis(element.address)}</Text>
          <CopyedIcon tooltipLable="Copy address" size={16} value={element.address} />
        </Flex>
      </Table.Td>
      <Table.Td>
        <Center>
          <Flex direction={"row"} gap={12} align={"center"}>
            <IconPencil
              size={18}
              color="var(--mantine-color-blue-6)"
              style={{ cursor: "pointer" }}
              onClick={() => setEditingContact(element)}
            />
            <IconTrash
              size={18}
              color="red"
              style={{ cursor: "pointer" }}
              onClick={() => handleDelete(element.address)}
            ></IconTrash>
          </Flex>
        </Center>
      </Table.Td>
    </Table.Tr>
  ));
  return (
    <Flex direction={"column"}>
      <AddContact opened={showAddContact} close={() => setShowAddContact(false)} />
      <EditContact
        opened={!!editingContact}
        close={() => setEditingContact(null)}
        contact={editingContact}
      />
      <Flex direction={"row"} mb={"sm"}>
        <Button
          variant="light"
          data-autofocus
          size={"xs"}
          leftSection={<IconPlus size={14} />}
          onClick={() => setShowAddContact(true)}
        >
          Add contact
        </Button>
        <div data-autofocus></div>
      </Flex>
      <Box pos="relative">
        <LoadingOverlay
          visible={loading}
          zIndex={1000}
          overlayProps={{ radius: "sm", blur: 2 }}
          loaderProps={{ color: "pink" }}
        />
        {!loading && customContacts.length > 0 ? (
          <ScrollArea h={height} type="auto" scrollbarSize={8} offsetScrollbars>
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
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Address</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>{rows}</Table.Tbody>
            </Table>
          </ScrollArea>
        ) : (
          <EmptyTable />
        )}
      </Box>
    </Flex>
  );
}
