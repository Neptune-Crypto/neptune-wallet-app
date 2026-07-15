import {
  addWatchOnlyAddress,
  knownWatchOnlyAddresses,
  removeWatchOnlyAddress,
} from "@/commands/wallet";
import AccountContextLabel from "@/components/account-context-label";
import CopyedIcon from "@/components/copyed-icon";
import WithTitlePageHeader from "@/components/header/withTitlePageHeader";
import MonoText from "@/components/mono-text";
import { useSyncedBlock } from "@/store/sync/hooks";
import { useCurrentWalledId, useWallets } from "@/store/wallet/hooks";
import { WatchOnlyAddressRecord, WatchOnlyKeyType } from "@/utils/api/types";
import { amount_to_positive_fixed } from "@/utils/math-util";
import { notify } from "@/utils/notify";
import {
  ActionIcon,
  Box,
  Button,
  Center,
  Flex,
  Group,
  Loader,
  Modal,
  NumberFormatter,
  ScrollArea,
  Select,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLock, IconPlus, IconTrash } from "@tabler/icons-react";
import { format, formatDistanceToNow } from "date-fns";
import { useCallback, useEffect, useRef, useState } from "react";

// Match the rest of the wallet: full-precision amounts from the backend are
// shown with four decimals, but an exact zero renders as a plain "0".
function formatNpt(amount?: string): string {
  const fixed = amount_to_positive_fixed(amount ?? "");
  return fixed === "0.0000" ? "0" : fixed;
}

// Viewing address is imported as its plain nview… address; EC hybrid as its
// nechvk… viewing key.
const KEY_TYPE_OPTIONS = [
  { value: "ViewingAddress", label: "Viewing address" },
  { value: "EcHybrid", label: "EC hybrid" },
];

const KEY_TYPE_LABELS: Record<string, string> = {
  ViewingAddress: "Viewing address",
  EcHybrid: "EC hybrid",
};

export default function WatchOnlyPage() {
  // Watch-only entries are account-scoped, so refetch whenever the active
  // account changes (mirrors the Receive page).
  const currentWalletID = useCurrentWalledId();
  const wallets = useWallets();
  const activeAccountName = wallets.find((w) => w.id === currentWalletID)?.name;
  // Advances as the account syncs; used to refresh balances live while the page
  // is open (otherwise they'd only update on remount / account switch).
  const syncedBlock = useSyncedBlock();

  const [addresses, setAddresses] = useState<WatchOnlyAddressRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const hasLoadedOnce = useRef(false);

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [keyType, setKeyType] = useState<WatchOnlyKeyType>("ViewingAddress");
  const [addressInput, setAddressInput] = useState("");
  const [preimageInput, setPreimageInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const fetchAddresses = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await knownWatchOnlyAddresses();
      setAddresses(data);
    } catch (error) {
      console.error("Failed to fetch watch-only addresses:", error);
    } finally {
      setIsLoading(false);
      hasLoadedOnce.current = true;
    }
  }, [currentWalletID]);

  // Clear the previous account's rows immediately on switch so stale entries
  // never linger while the refetch is in flight.
  useEffect(() => {
    setAddresses([]);
  }, [currentWalletID]);

  // Refetch on mount, on account switch (fetchAddresses identity), and whenever
  // a new block is synced so balances update without leaving the page.
  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses, syncedBlock]);

  const resetForm = () => {
    setKeyType("ViewingAddress");
    setAddressInput("");
    setPreimageInput("");
    setLabelInput("");
  };

  const handleAdd = async () => {
    const trimmed = addressInput.trim();
    if (!trimmed) return;
    setIsSaving(true);
    try {
      const record = await addWatchOnlyAddress(keyType, trimmed, preimageInput, labelInput);
      setAddresses((prev) => [...prev, record]);
      notify.success("Watch-only address added");
      resetForm();
      closeModal();
    } catch (error) {
      // Backend rejects invalid / wrong-network keys and duplicates.
      notify.error(error, "Please check the viewing key.", "Couldn't add address");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async (id: number) => {
    try {
      await removeWatchOnlyAddress(id);
      setAddresses((prev) => prev.filter((a) => a.id !== id));
    } catch (error) {
      notify.error(error, "Please try again.", "Couldn't remove address");
    }
  };

  const addModal = (
    <Modal
      opened={modalOpened}
      onClose={closeModal}
      title="Add watch-only address"
      centered
      overlayProps={{ backgroundOpacity: 0.5, blur: 4 }}
    >
      <Flex direction="column" gap="md">
        <Select
          label="Address type"
          data={KEY_TYPE_OPTIONS}
          value={keyType}
          onChange={(value) => setKeyType((value as WatchOnlyKeyType) ?? "ViewingAddress")}
          allowDeselect={false}
        />
        <TextInput
          label="Label (optional)"
          value={labelInput}
          onChange={(event) => setLabelInput(event.currentTarget.value)}
          placeholder="A name to recognise this address"
        />
        <Textarea
          label="Viewing key"
          data-autofocus
          required
          autosize
          minRows={3}
          value={addressInput}
          onChange={(event) => setAddressInput(event.currentTarget.value)}
          placeholder={
            keyType === "EcHybrid"
              ? "Paste the nechvk… viewing key to monitor"
              : "Paste the nview… viewing address to monitor"
          }
        />
        <TextInput
          label="Receiver preimage (optional)"
          value={preimageInput}
          onChange={(event) => setPreimageInput(event.currentTarget.value)}
          placeholder="Hex digest — enables balance (spend) tracking"
        />
        <Text c="dimmed" size="xs">
          With the viewing key alone you see the total received. Add the receiver preimage (a hex
          digest) to also track spends and see a real balance. Watch-only funds can never be spent
          and never count toward this account's balance.
        </Text>
        <Text c="dimmed" size="xs">
          A new entry only tracks payments from now on. To pick up earlier payments to this address,
          resync the account from Settings → Resync account history.
        </Text>
        <Button
          variant="light"
          loading={isSaving}
          disabled={!addressInput.trim()}
          onClick={handleAdd}
        >
          Add
        </Button>
      </Flex>
    </Modal>
  );

  return (
    <WithTitlePageHeader title="Watch-only addresses">
      {addModal}

      <Box mb="sm">
        <AccountContextLabel label="Monitoring in" name={activeAccountName} />
      </Box>

      <Flex direction="column" align="flex-start" mb="sm" gap="lg">
        <Text c="dimmed" size="sm">
          Monitor incoming payments to an external address by importing its viewing key. You can see
          how much it has received, but you can never spend those funds.
        </Text>
        <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={openModal}>
          Add watch-only address
        </Button>
      </Flex>

      {isLoading && addresses.length === 0 && !hasLoadedOnce.current ? (
        <Center p="xl">
          <Loader color="blue" />
        </Center>
      ) : isLoading && addresses.length === 0 ? (
        // Switching accounts: hold a stable empty area (no message) until the
        // new account's list arrives, so "No watch-only addresses yet" never
        // flashes over an account that actually has entries.
        <ScrollArea
          style={{ flex: 1, minHeight: 0 }}
          type="auto"
          scrollbarSize={8}
          offsetScrollbars
        />
      ) : addresses.length === 0 ? (
        <Box p="md" ta="center" c="dimmed">
          No watch-only addresses yet.
        </Box>
      ) : (
        <ScrollArea
          style={{ flex: 1, minHeight: 0 }}
          type="auto"
          scrollbarSize={8}
          offsetScrollbars
        >
          <Table
            verticalSpacing="sm"
            striped
            highlightOnHover
            layout="fixed"
            w="100%"
            styles={{ td: { verticalAlign: "top" } }}
          >
            <Table.Thead
              style={{
                position: "sticky",
                top: 0,
                backgroundColor: "var(--mantine-color-body)",
                zIndex: 1,
              }}
            >
              <Table.Tr>
                <Table.Th w={140}>Label</Table.Th>
                <Table.Th w={120}>Type</Table.Th>
                <Table.Th>Address</Table.Th>
                <Table.Th w={140} ta="right">
                  Total received
                </Table.Th>
                <Table.Th w={150} ta="right">
                  Balance
                </Table.Th>
                <Table.Th w={60} ta="right">
                  Actions
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {addresses.map((item) => {
                // Some coins are still time-locked iff the backend returned an
                // upcoming unlock date (locked coins always carry a future one).
                // Independent of tracks_balance: a coin that is still locked
                // cannot have been spent, so the lock shows.
                const hasLocked = item.next_release_date != null;
                const lockedUntil = hasLocked
                  ? `${formatNpt(item.locked)} locked until ` +
                    `${format(item.next_release_date!, "yyyy-MM-dd HH:mm:ss")} ` +
                    `(${formatDistanceToNow(item.next_release_date!, { addSuffix: true })})`
                  : "";
                const balanceTooltip = item.tracks_balance
                  ? hasLocked
                    ? `Available ${formatNpt(item.available)}; ${lockedUntil}`
                    : "Spends tracked via the receiver preimage"
                  : hasLocked
                    ? `${lockedUntil}. Import the receiver preimage to track spends and see a balance`
                    : "Import the receiver preimage to track spends and see a balance";
                return (
                  <Table.Tr key={item.id}>
                    <Table.Td>{item.label || <Text c="dimmed">—</Text>}</Table.Td>
                    <Table.Td>{KEY_TYPE_LABELS[item.key_type] ?? item.key_type}</Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <MonoText value={item.address} copy={false} full={false} />
                        <CopyedIcon size={16} value={item.address} />
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right">
                      <NumberFormatter value={formatNpt(item.total_received)} thousandSeparator />
                    </Table.Td>
                    <Table.Td ta="right">
                      <Tooltip label={balanceTooltip} withArrow position="top">
                        <Box>
                          <Group gap={4} justify="flex-end" wrap="nowrap">
                            {hasLocked && <IconLock size={12} />}
                            {item.tracks_balance ? (
                              <Text>
                                <NumberFormatter
                                  value={formatNpt(item.balance)}
                                  thousandSeparator
                                />
                              </Text>
                            ) : (
                              <Text c="dimmed">—</Text>
                            )}
                          </Group>
                          {hasLocked && (
                            <Text c="dimmed" size="xs">
                              {formatNpt(item.locked)} locked
                            </Text>
                          )}
                        </Box>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        <Tooltip label="Remove" withArrow position="top">
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={() => handleRemove(item.id)}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </WithTitlePageHeader>
  );
}
