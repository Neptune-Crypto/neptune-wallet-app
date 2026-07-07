import CopyedIcon from "@/components/copyed-icon";
import EmptyTable from "@/components/empty-table";
import { Contact } from "@/database/types/contact";
import { queryAllContacts } from "@/store/contact/contact-slice";
import { useAllContacts, useLoadingContacts } from "@/store/contact/hooks";
import { useAppDispatch } from "@/store/hooks";
import { ellipsis } from "@/utils/ellipsis-format";
import { notify } from "@/utils/notify";
import { deleteContactAddress } from "@/utils/storage";
import {
  ActionIcon,
  Box,
  Button,
  Center,
  Flex,
  LoadingOverlay,
  ScrollArea,
  Table,
  Text,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import AddContact from "./add-contact";
import EditContact from "./edit-contact";

export default function ContactTable() {
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
      notify.success("Contact deleted successfully");
    } catch (error: any) {
      notify.error(error, "Failed to delete contact");
    }
  }

  // Deleting a saved payment address is destructive; require confirmation.
  function confirmDelete(contact: Contact) {
    modals.openConfirmModal({
      title: "Delete this contact?",
      centered: true,
      children: (
        <Text size="sm">
          Are you sure you want to delete "{contact.aliasName}"? You will need to obtain the address
          again to re-add it.
        </Text>
      ),
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red.9", variant: "light" },
      onConfirm: () => handleDelete(contact.address),
    });
  }
  const rows = customContacts.map((element) => (
    <Table.Tr key={element.address}>
      <Table.Td>
        <Text style={{ minWidth: "115px" }}>{element.aliasName}</Text>
      </Table.Td>
      <Table.Td>
        <Flex direction={"row"} gap={8} align={"center"}>
          {/* Fixed width pins every row's copy icon at the same x — the same
              icon rail as the Wallet accounts table. */}
          <Text w={340} truncate>
            {ellipsis(element.address)}
          </Text>
          <CopyedIcon tooltipLable="Copy address" size={16} value={element.address} />
        </Flex>
      </Table.Td>
      <Table.Td>
        <Center>
          <Flex direction={"row"} gap={4} align={"center"}>
            <ActionIcon
              variant="subtle"
              color="blue"
              aria-label="Edit contact"
              onClick={() => setEditingContact(element)}
            >
              <IconPencil size={18} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label="Delete contact"
              onClick={() => confirmDelete(element)}
            >
              <IconTrash size={18} />
            </ActionIcon>
          </Flex>
        </Center>
      </Table.Td>
    </Table.Tr>
  ));
  return (
    <Flex direction={"column"} style={{ flex: 1, minHeight: 0 }}>
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
      <Box
        pos="relative"
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        <LoadingOverlay
          visible={loading}
          zIndex={1000}
          overlayProps={{ radius: "sm", blur: 2 }}
          loaderProps={{ color: "blue" }}
        />
        {!loading && customContacts.length > 0 ? (
          <ScrollArea
            style={{ flex: 1, minHeight: 0 }}
            type="auto"
            scrollbarSize={8}
            offsetScrollbars
          >
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
