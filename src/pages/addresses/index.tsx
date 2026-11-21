import {
  addressBalances,
  generateNewAddress,
  knownAddresses,
  setAddressLabel,
} from "@/commands/wallet";
import AccountContextLabel from "@/components/account-context-label";
import CopyedIcon from "@/components/copyed-icon";
import WithTitlePageHeader from "@/components/header/withTitlePageHeader";
import MonoText from "@/components/mono-text";
import { useSyncedBlock } from "@/store/sync/hooks";
import { useCurrentWalledId, useWallets } from "@/store/wallet/hooks";
import {
  AddressRow,
  NO_BALANCES,
  mergeAddressRows,
  settleAddressFetch,
} from "@/utils/address-rows";
import { AddressBalances, AddressRecord, AddressTotals, NeptuneKeyType } from "@/utils/api/types";
import { amount_to_positive_fixed } from "@/utils/math-util";
import { notify } from "@/utils/notify";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  CopyButton,
  Flex,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Table,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconCheck, IconCopy, IconPencil, IconPlus, IconQrcode } from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const generation_tab = "generation";
const viewing_tab = "viewing";
const ec_hybrid_tab = "echybrid";
const uri_scheme_prefix = "NPT";

// Full-precision amounts are shown with four decimals; zero (in either the
// "0" or the lossless "0.000…" form) renders as a plain "0".
function formatNpt(amount: string): string {
  const fixed = amount_to_positive_fixed(amount);
  return fixed === "0.0000" ? "0" : fixed;
}

export default function AddressesPage() {
  const [activeTab, setActiveTab] = useState<string | null>(generation_tab);
  // Refetch when the active account changes (e.g. via the sidebar switcher):
  // addresses are account-scoped, so a switch must not show the old account's list.
  const currentWalletID = useCurrentWalledId();
  const wallets = useWallets();
  const activeAccountName = wallets.find((w) => w.id === currentWalletID)?.name;
  // Read when a response arrives: results requested for another account are dropped.
  const walletIdRef = useRef(currentWalletID);
  walletIdRef.current = currentWalletID;
  // Advances as the account syncs; balances are refetched on each new block.
  const syncedBlock = useSyncedBlock();
  const [addresses, setAddresses] = useState<AddressRecord[]>([]);
  const [balances, setBalances] = useState<AddressBalances>(NO_BALANCES);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  // Tracks whether the first fetch has completed, so the loading spinner only
  // shows on the initial load, not on every tab switch.
  const hasLoadedOnce = useRef(false);

  // State for managing the QR modal
  const [qrModalOpened, { open: openQrModal, close: closeQrModal }] = useDisclosure(false);
  const [selectedAddress, setSelectedAddress] = useState("");

  // State for the label editor
  const [labelModalOpened, { open: openLabelModal, close: closeLabelModal }] = useDisclosure(false);
  const [labelKeyIndex, setLabelKeyIndex] = useState<number | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const [isSavingLabel, setIsSavingLabel] = useState(false);

  const BUTTON_LABELS: Record<string, string> = {
    [generation_tab]: "New generation address",
    [ec_hybrid_tab]: "New EC hybrid address",
    [viewing_tab]: "New viewing address",
  };

  const ADDRESS_DESCRIPTIONS: Record<string, string> = {
    [generation_tab]:
      "The most private option and a good default for everyday use. It is safe to reuse without harming your on-chain privacy, though publicly posting the same address under different names can still connect those identities.",
    [ec_hybrid_tab]:
      "A shorter, more compact address that is easier to share. Give each one to a single person only: if reused more widely, a future quantum attacker could reveal (but never spend) the funds sent to it.",
    [viewing_tab]:
      "A view-only address, best given to a single person. Anyone holding it can see every payment the address has ever received — which is useful for auditing — but can never move or spend any of those funds.",
  };

  // Fine print for the QR modal: each key type's sharing consequence, worded
  // for the person about to hand the address out. The tab description says
  // the same, but the modal is the moment of sharing.
  const QR_FOOTNOTES: Record<string, string> = {
    [generation_tab]:
      "Generation addresses make a very dense code. Scan from close up with a steady camera; if it will not read, copy the address, or consider sharing an EC hybrid address instead.",
    [ec_hybrid_tab]:
      "Best given to a single person. If shared more widely, a future quantum attacker could reveal, but never spend, the funds sent to it.",
    [viewing_tab]:
      "Anyone holding this address can watch every payment it ever receives, though they can never spend the funds. Share it only with someone you trust to see that activity.",
  };

  const getQrPayload = (address: string) => `${uri_scheme_prefix}:${address.toUpperCase()}`;

  const keyTypeFromTab = (tab: string | null): NeptuneKeyType => {
    if (tab === ec_hybrid_tab) return "EcHybrid";
    if (tab === viewing_tab) return "ViewingAddress";
    return "Generation";
  };

  // Like walletIdRef, for the tab: rows fetched for another key type are dropped,
  // so the table (and the label editor) never pairs them with the wrong one.
  const tabRef = useRef(activeTab);
  tabRef.current = activeTab;

  // Balances come from both the full fetch and the per-block refresh; a response
  // only applies if no later-started request has applied already.
  const balancesSeq = useRef(0);
  const appliedBalancesSeq = useRef(0);
  const applyBalances = useCallback((seq: number, totals: AddressBalances) => {
    if (seq < appliedBalancesSeq.current) return;
    appliedBalancesSeq.current = seq;
    setBalances(totals);
  }, []);

  const fetchAddresses = useCallback(async () => {
    if (!activeTab) return;
    setIsLoading(true);
    const walletId = currentWalletID;
    const tab = activeTab;
    const isCurrent = () => walletIdRef.current === walletId && tabRef.current === tab;
    const seq = ++balancesSeq.current;
    try {
      const keyType = keyTypeFromTab(tab);
      const [data, totals] = await Promise.allSettled([knownAddresses(keyType), addressBalances()]);
      if (!isCurrent()) return;
      const settled = settleAddressFetch(data, totals);
      if (settled.addresses) setAddresses(settled.addresses);
      applyBalances(seq, settled.balances);
      if (settled.addressesError) {
        console.error("Failed to fetch addresses from backend:", settled.addressesError.error);
      }
      if (settled.balancesError) {
        console.error("Failed to fetch address balances:", settled.balancesError.error);
        // A fixed id replaces the previous toast, so repeated failures show one.
        notify.error(
          settled.balancesError.error,
          "Balances are shown as zero. Please try again.",
          "Couldn't load address balances",
          { id: "address-balances-error" }
        );
      }
    } finally {
      // A dropped response must not end the newer request's loading state.
      if (isCurrent()) {
        setIsLoading(false);
        hasLoadedOnce.current = true;
      }
    }
  }, [activeTab, currentWalletID, applyBalances]);

  // Clear the previous account's rows as soon as the account switches, so stale
  // addresses never linger while the refetch below is in flight.
  useEffect(() => {
    setAddresses([]);
    setBalances(NO_BALANCES);
  }, [currentWalletID]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  // On each newly synced block, refresh only the balances. During catch-up sync
  // blocks arrive faster than a scan finishes: at most one scan runs, and blocks
  // seen meanwhile trigger a single follow-up scan.
  const lastSyncedBlock = useRef(syncedBlock);
  const balancesInFlight = useRef(false);
  const balancesStale = useRef(false);
  const refreshBalances = useCallback(() => {
    if (balancesInFlight.current) {
      balancesStale.current = true;
      return;
    }
    balancesInFlight.current = true;
    balancesStale.current = false;
    const walletId = walletIdRef.current;
    const seq = ++balancesSeq.current;
    addressBalances()
      .then((totals) => {
        if (walletIdRef.current === walletId) applyBalances(seq, totals);
      })
      .catch((error) => console.error("Failed to fetch address balances:", error))
      .finally(() => {
        balancesInFlight.current = false;
        if (balancesStale.current) refreshBalances();
      });
  }, [applyBalances]);
  useEffect(() => {
    if (lastSyncedBlock.current === syncedBlock) return;
    lastSyncedBlock.current = syncedBlock;
    refreshBalances();
  }, [syncedBlock, refreshBalances]);

  const rows: AddressRow[] = useMemo(
    () => mergeAddressRows(addresses, balances, keyTypeFromTab(activeTab)),
    [addresses, balances, activeTab]
  );

  const editLabel = (item: AddressRow) => {
    setLabelKeyIndex(item.key_index);
    setLabelInput(item.label ?? "");
    openLabelModal();
  };

  const handleSaveLabel = async () => {
    if (!activeTab || labelKeyIndex === null) return;
    setIsSavingLabel(true);
    try {
      const label = labelInput.trim();
      await setAddressLabel(keyTypeFromTab(activeTab), labelKeyIndex, label === "" ? null : label);
      closeLabelModal();
      await fetchAddresses();
    } catch (error) {
      notify.error(error, "Please try again.", "Couldn't save label");
    } finally {
      setIsSavingLabel(false);
    }
  };

  // Handler for the generate button
  const handleGenerate = async () => {
    if (!activeTab) return;
    setIsGenerating(true);
    try {
      const keyType = keyTypeFromTab(activeTab);
      const newAddress = await generateNewAddress(keyType);

      // Append the new address to the existing list without needing a full refetch
      setAddresses((prev) => [...prev, newAddress]);
    } catch (error) {
      console.error("Failed to generate new address:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const qrPayload = selectedAddress ? getQrPayload(selectedAddress) : "";
  // Past the alphanumeric capacity of the largest QR version at this error
  // level, the encoder throws instead of rendering.
  const qrTooLong = qrPayload.length > 4296;
  // Every code renders at the same size, the largest the fixed app window
  // height allows, so the modal has identical dimensions for every key type.
  // Generation addresses need all of it for their dense module grid; the
  // short types simply get large, easily scanned modules.
  const qrDense = qrPayload.length > 1000;
  const qrSize = 540;
  const qrFootnote = activeTab ? QR_FOOTNOTES[activeTab] : "";

  const qr_button = (item: AddressRecord) => {
    return (
      <Tooltip label="Show QR code" withArrow position="top">
        <ActionIcon
          color="blue"
          variant="subtle"
          onClick={() => {
            setSelectedAddress(item.address);
            openQrModal();
          }}
        >
          <IconQrcode size={14} />
        </ActionIcon>
      </Tooltip>
    );
  };

  // Shared by the side-panel layout and the too-long fallback.
  const copy_button = (
    <CopyButton value={selectedAddress} timeout={2000}>
      {({ copied, copy }) => (
        <Button
          size="xs"
          variant="light"
          color={copied ? "teal" : "blue"}
          leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          onClick={copy}
        >
          {copied ? "Copied" : "Copy address"}
        </Button>
      )}
    </CopyButton>
  );

  const qr_modal = (
    <Modal
      opened={qrModalOpened}
      onClose={closeQrModal}
      title="Receive funds"
      centered
      size="auto"
      // Mantine's default vertical clearance caps the modal height just below
      // what the code needs in the fixed app window, forcing a scrollbar.
      yOffset={8}
      overlayProps={{ backgroundOpacity: 0.5, blur: 4 }}
    >
      <Box
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "0 10px",
        }}
      >
        {selectedAddress && qrTooLong && (
          <>
            <Text size="sm" c="dimmed" maw={360} ta="center">
              This address is too long to fit in a QR code. Copy it instead, or share an EC hybrid
              address.
            </Text>
            <Box mt="md">{copy_button}</Box>
          </>
        )}
        {selectedAddress && !qrTooLong && (
          // One layout for every key type; only the column's content varies.
          <Group align="center" gap="lg" wrap="nowrap">
            {/* Lowest error-correction level: generation payloads barely fit
                as is, and redundancy would push them over capacity. The
                margin is the spec's quiet zone; the modal background can be
                dark, so the SVG must carry its own. */}
            <QRCodeSVG
              value={qrPayload}
              level="L"
              size={qrSize}
              marginSize={4}
              bgColor="#ffffff"
              fgColor="#000000"
            />
            <Flex direction="column" gap="md" maw={240}>
              <Box>
                <Text size="sm" fw={500}>
                  Address
                </Text>
                <Box mt={4}>
                  {/* Full text for the short types; a head/tail abbreviation
                      for generation, whose full text would dwarf the column.
                      Both keep first/last characters checkable against the
                      code being shared. Shorter than the table's abbreviation
                      so the no-wrap line stays inside the column. */}
                  <MonoText
                    value={selectedAddress}
                    chars={12}
                    copy={false}
                    full={!qrDense}
                    size="xs"
                    c="dimmed"
                  />
                </Box>
              </Box>
              {copy_button}
              {qrFootnote && (
                <Text size="xs" c="dimmed">
                  {qrFootnote}
                </Text>
              )}
            </Flex>
          </Group>
        )}
      </Box>
    </Modal>
  );

  const label_modal = (
    <Modal
      opened={labelModalOpened}
      onClose={closeLabelModal}
      title={`Label for key index ${labelKeyIndex ?? ""}`}
      centered
    >
      <TextInput
        label="Label"
        description="Only stored in this wallet. Leave blank to remove it."
        value={labelInput}
        maxLength={64}
        data-autofocus
        onChange={(e) => setLabelInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSaveLabel();
        }}
      />
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={closeLabelModal}>
          Cancel
        </Button>
        <Button onClick={handleSaveLabel} loading={isSavingLabel}>
          Save
        </Button>
      </Group>
    </Modal>
  );

  // Totals not shown in the table; a line is hidden while it holds no UTXOs.
  const footer_line = (title: string, totals: AddressTotals) =>
    totals.utxo_count > 0 && (
      <Text size="xs" c="dimmed">
        {title}: {formatNpt(totals.unspent)}
      </Text>
    );

  return (
    <WithTitlePageHeader title="Receive addresses">
      {qr_modal}
      {label_modal}

      {/* First element under the header on every page, so the "which account?"
          glance always lands in the same spot (matches Wallet and Send). It sits
          above the tabs because the account applies to all of them. */}
      <Box mb="sm">
        {/* Action-role label, mirroring the Send page's "Sending from": funds
            received via the addresses below land in this account. */}
        <AccountContextLabel label="Receiving to" name={activeAccountName} />
      </Box>

      <Tabs
        value={activeTab}
        onChange={(value) => {
          // Ignore repeat clicks on the already-active tab (e.g. a double-click) and
          // deactivation: otherwise we'd clear the list and enter loading without a
          // refetch (fetchAddresses is keyed on activeTab), leaving the table blank.
          if (!value || value === activeTab) return;
          // Clear rows and enter loading synchronously with the tab change, so the
          // previous tab's addresses never render for a frame under the new tab.
          setActiveTab(value);
          setAddresses([]);
          setIsLoading(true);
        }}
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="generation">Generation</Tabs.Tab>
          <Tabs.Tab value="echybrid">EC hybrid</Tabs.Tab>
          <Tabs.Tab value="viewing">Viewing</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value={activeTab || generation_tab} className="page-tab-panel">
          <Flex direction="column" align="flex-start" mb="sm" gap="lg">
            <Text c="dimmed" size="sm">
              {activeTab ? ADDRESS_DESCRIPTIONS[activeTab] : ""}
            </Text>
            <Button
              variant="light"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={handleGenerate}
              loading={isGenerating}
            >
              {activeTab ? BUTTON_LABELS[activeTab] : "Generate new address"}
            </Button>
          </Flex>

          {isLoading && addresses.length === 0 && !hasLoadedOnce.current ? (
            <Center p="xl">
              <Loader color="blue" />
            </Center>
          ) : isLoading && addresses.length === 0 ? (
            // Switching tabs: hold a stable empty area (no spinner, no message)
            // until the new tab's addresses arrive.
            <ScrollArea
              style={{ flex: 1, minHeight: 0 }}
              type="auto"
              scrollbarSize={8}
              offsetScrollbars
            />
          ) : addresses.length === 0 ? (
            <Box p="md" ta="center" c="dimmed">
              No addresses found.
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
                // Fits the default window; narrower windows scroll sideways
                // instead of squeezing the address column.
                miw={860}
                horizontalSpacing={8}
                styles={{ td: { verticalAlign: "top" }, th: { whiteSpace: "nowrap" } }}
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
                    <Table.Th w={85}>Key index</Table.Th>
                    <Table.Th w={120}>Label</Table.Th>
                    <Table.Th>Address</Table.Th>
                    <Table.Th w={85} ta="right">
                      Balance
                    </Table.Th>
                    <Table.Th w={75} ta="right">
                      Locked
                    </Table.Th>
                    <Table.Th w={85} ta="right">
                      Received
                    </Table.Th>
                    <Table.Th w={65} ta="right">
                      UTXOs
                    </Table.Th>
                    <Table.Th w={90} ta="right">
                      Last block
                    </Table.Th>
                    <Table.Th w={70} ta="right">
                      Actions
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {[...rows]
                    .sort((a, b) => b.key_index - a.key_index)
                    .map((item) => (
                      <Table.Tr key={item.key_index}>
                        <Table.Td>
                          {/* Wrapped: Group drops falsy children, which would hide index 0. */}
                          <Group gap={6} wrap="nowrap">
                            <span>{item.key_index}</span>
                            {item.utxo_count > 0 && (
                              <Badge size="xs" variant="light">
                                Used
                              </Badge>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} wrap="nowrap" justify="space-between">
                            <Tooltip
                              label={item.label}
                              disabled={!item.label}
                              withArrow
                              position="top"
                            >
                              <Text size="sm" truncate="end" c={item.label ? undefined : "dimmed"}>
                                {item.label || "—"}
                              </Text>
                            </Tooltip>
                            <Tooltip label="Edit label" withArrow position="top">
                              <ActionIcon
                                color="blue"
                                variant="subtle"
                                size="sm"
                                onClick={() => editLabel(item)}
                              >
                                <IconPencil size={14} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          {/* Abbreviated on every tab (tighter than elsewhere, to leave
                              room for the balance columns); the QR and copy actions
                              carry the full address, hence copy={false}. */}
                          <MonoText value={item.address} chars={9} copy={false} />
                        </Table.Td>
                        <Table.Td ta="right">{formatNpt(item.unspent)}</Table.Td>
                        <Table.Td ta="right">{formatNpt(item.locked)}</Table.Td>
                        <Table.Td ta="right">{formatNpt(item.received)}</Table.Td>
                        <Table.Td ta="right">{item.utxo_count}</Table.Td>
                        <Table.Td ta="right">{item.last_received_height ?? "—"}</Table.Td>
                        <Table.Td>
                          <Group gap="xs" justify="flex-end" wrap="nowrap">
                            {qr_button(item)}
                            <CopyedIcon size={16} value={item.address} />
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
          <Box mt="xs">
            {footer_line("Internal (change & mining rewards to internal keys)", balances.internal)}
            {footer_line("Unclassified", balances.unattributed)}
          </Box>
        </Tabs.Panel>
      </Tabs>
    </WithTitlePageHeader>
  );
}
