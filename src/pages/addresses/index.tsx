import { generateNewAddress, knownAddresses } from "@/commands/wallet";
import AccountContextLabel from "@/components/account-context-label";
import CopyedIcon from "@/components/copyed-icon";
import WithTitlePageHeader from "@/components/header/withTitlePageHeader";
import MonoText from "@/components/mono-text";
import { useCurrentWalledId, useWallets } from "@/store/wallet/hooks";
import { AddressRecord, NeptuneKeyType } from "@/utils/api/types";
import {
  ActionIcon,
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
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconCheck, IconCopy, IconPlus, IconQrcode } from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";

const generation_tab = "generation";
const viewing_tab = "viewing";
const ec_hybrid_tab = "echybrid";
const uri_scheme_prefix = "NPT";

export default function AddressesPage() {
  const [activeTab, setActiveTab] = useState<string | null>(generation_tab);
  // Refetch when the active account changes (e.g. via the sidebar switcher):
  // addresses are account-scoped, so a switch must not show the old account's list.
  const currentWalletID = useCurrentWalledId();
  const wallets = useWallets();
  const activeAccountName = wallets.find((w) => w.id === currentWalletID)?.name;
  const [addresses, setAddresses] = useState<AddressRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  // Tracks whether the first fetch has completed, so the loading spinner only
  // shows on the initial load, not on every tab switch.
  const hasLoadedOnce = useRef(false);

  // State for managing the QR modal
  const [qrModalOpened, { open: openQrModal, close: closeQrModal }] = useDisclosure(false);
  const [selectedAddress, setSelectedAddress] = useState("");

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

  const fetchAddresses = useCallback(async () => {
    if (!activeTab) return;
    setIsLoading(true);
    try {
      const keyType = keyTypeFromTab(activeTab);
      const data = await knownAddresses(keyType);
      setAddresses(data);
    } catch (error) {
      console.error("Failed to fetch addresses from backend:", error);
    } finally {
      setIsLoading(false);
      hasLoadedOnce.current = true;
    }
  }, [activeTab, currentWalletID]);

  // Clear the previous account's rows as soon as the account switches, so stale
  // addresses never linger while the refetch below is in flight.
  useEffect(() => {
    setAddresses([]);
  }, [currentWalletID]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

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

  return (
    <WithTitlePageHeader title="Receive addresses">
      {qr_modal}

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
                    <Table.Th w={110}>Key index</Table.Th>
                    <Table.Th>Address</Table.Th>
                    <Table.Th w={80} ta="right">
                      Actions
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {[...addresses]
                    .sort((a, b) => b.key_index - a.key_index)
                    .map((item) => (
                      <Table.Tr key={item.key_index}>
                        <Table.Td>{item.key_index}</Table.Td>
                        <Table.Td>
                          {/* Generation addresses are too long to show in full, so
                              abbreviate; the other types show in full. Copy lives in
                              the Actions column, hence copy={false}. */}
                          <MonoText
                            value={item.address}
                            copy={false}
                            full={activeTab !== generation_tab}
                          />
                        </Table.Td>
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
        </Tabs.Panel>
      </Tabs>
    </WithTitlePageHeader>
  );
}
