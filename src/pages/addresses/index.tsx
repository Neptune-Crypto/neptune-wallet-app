import { generateNewAddress, knownAddresses } from "@/commands/wallet";
import WithTitlePageHeader from "@/components/header/withTitlePageHeader";
import CopyedIcon from "@/components/copyed-icon";
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
      "The most private option. Safe to reuse and share with many people without weakening your privacy. Recommended for everyday use.",
    [ec_hybrid_tab]:
      "A shorter, more compact address. Share each one with a single person only: if the same address is reused more widely, an attacker with a powerful quantum computer could expose (but never steal) the payments sent to it.",
    [viewing_tab]:
      "Share each address with a single person only. Anyone who has one of these addresses can see everything it has ever received.",
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
  }, [activeTab]);

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

  // QR codes are only available for EC hybrid and viewing keys
  const has_qr_codes = activeTab == ec_hybrid_tab || activeTab == viewing_tab;
  const qr_button = (item: AddressRecord) => {
    return (
      has_qr_codes && (
        <Tooltip label="Show QR code" withArrow position="top">
          <ActionIcon
            color="blue"
            variant="subtle"
            onClick={() => {
              setSelectedAddress(item.address);
              openQrModal();
            }}
          >
            <IconQrcode size={16} />
          </ActionIcon>
        </Tooltip>
      )
    );
  };

  const qr_modal = has_qr_codes && (
    <Modal
      opened={qrModalOpened}
      onClose={closeQrModal}
      title="Receive funds"
      centered
      overlayProps={{ backgroundOpacity: 0.5, blur: 4 }}
    >
      <Box
        style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "10px" }}
      >
        {selectedAddress && (
          <>
            {/* level="L" keeps the grid low-density.
                marginSize={4} creates the required quiet zone.
              */}
            <QRCodeSVG
              value={getQrPayload(selectedAddress)}
              level="L"
              size={256}
              marginSize={4}
              bgColor="#ffffff"
              fgColor="#000000"
            />

            <Text mt="xl" size="sm" fw={500}>
              Address
            </Text>
            <Text
              ta="center"
              size="xs"
              c="dimmed"
              style={{ wordBreak: "break-all", marginTop: "4px" }}
            >
              {selectedAddress}
            </Text>
            <CopyButton value={selectedAddress} timeout={2000}>
              {({ copied, copy }) => (
                <Button
                  mt="md"
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
          </>
        )}
      </Box>
    </Modal>
  );

  const addressRepresentation = (address: AddressRecord): string =>
    activeTab === generation_tab ? address.address_short_form : address.address;

  return (
    <WithTitlePageHeader title="Receive">
      {qr_modal}

      <Tabs
        value={activeTab}
        onChange={(value) => {
          // Clear rows and enter loading synchronously with the tab change, so the
          // previous tab's addresses never render for a frame under the new tab.
          setActiveTab(value);
          setAddresses([]);
          setIsLoading(true);
        }}
      >
          <Tabs.List mb="md">
            <Tabs.Tab value="generation">Generation</Tabs.Tab>
            <Tabs.Tab value="echybrid">EC hybrid</Tabs.Tab>
            <Tabs.Tab value="viewing">Viewing</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value={activeTab || generation_tab}>
            {/* Reserve a consistent height so the table doesn't shift between
                tabs whose descriptions differ in length, and fix the button
                width so it stays the same across tabs. */}
            <Flex justify="space-between" align="flex-start" mb="sm" wrap="wrap" gap="sm" mih={80}>
              <Text c="dimmed" size="sm" style={{ flex: 1 }}>
                {activeTab ? ADDRESS_DESCRIPTIONS[activeTab] : ""}
              </Text>

              <Button
                w={230}
                justify="flex-start"
                leftSection={<IconPlus size={15} />}
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
              <ScrollArea h="calc(100vh - 244px)" type="auto" scrollbarSize={8} offsetScrollbars />
            ) : addresses.length === 0 ? (
              <Box p="md" ta="center" c="dimmed">
                No addresses found.
              </Box>
            ) : (
              <ScrollArea h="calc(100vh - 244px)" type="auto" scrollbarSize={8} offsetScrollbars>
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
                            <Box style={{ wordBreak: "break-all" }}>
                              {addressRepresentation(item)}
                            </Box>
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
