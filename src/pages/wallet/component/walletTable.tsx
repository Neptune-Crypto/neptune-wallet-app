import { removeWallet, renameWallet, setCurrentWallet } from "@/commands/wallet";
import MonoText from "@/components/mono-text";
import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { querySyncBlockStatus } from "@/store/sync/sync-slice";
import { Wallet } from "@/store/types";
import { useCurrentWalledId, useLoadingWallets, useWallets } from "@/store/wallet/hooks";
import { queryWalletBalance, queryWallets } from "@/store/wallet/wallet-slice";
import { bigNumberPlusToString } from "@/utils/common";
import { handleImportRandomness } from "@/utils/import-wallet-randomness";
import { notify } from "@/utils/notify";
import { deleteContactAddress } from "@/utils/storage";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Group,
  LoadingOverlay,
  Modal,
  NumberFormatter,
  ScrollArea,
  Table,
  Text,
  TextInput,
  useModalsStack,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import ActionMenu from "./action-menu";
import AddWalletModal from "./add-wallet-modal";
import ExportWalletModal from "./export-wallet-modal";

// Body of the delete-account confirmation. Stateful (acknowledgement checkbox
// gates the Delete button), which modals.openConfirmModal cannot express.
function DeleteAccountConfirm({ wallet, onConfirm }: { wallet: Wallet; onConfirm: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <Flex direction={"column"} gap={16}>
      <Text size="sm">
        Are you sure you want to delete "{wallet.name}"? Its keys will be erased from this device —
        without its recovery phrase you will permanently lose access to its funds.
      </Text>
      <Checkbox
        size="sm"
        label="I understand this cannot be undone"
        checked={acknowledged}
        onChange={(event) => setAcknowledged(event.currentTarget.checked)}
      />
      <Group justify="flex-end">
        <Button variant="default" onClick={() => modals.closeAll()}>
          Cancel
        </Button>
        <Button
          color="red.9"
          variant="light"
          disabled={!acknowledged}
          onClick={() => {
            modals.closeAll();
            onConfirm();
          }}
        >
          Delete
        </Button>
      </Group>
    </Flex>
  );
}

export default function WalletTable() {
  const loading = useLoadingWallets();
  const wallets = useWallets();
  const currentWalletID = useCurrentWalledId();
  const { serverUrl } = useSettingActionData();
  const dispatch = useAppDispatch();
  const [showAddWalletModal, setShowAddWalletModal] = useState(false);

  const [showExportWalletModal, setShowExportWalletModal] = useState(false);
  const [exportWalletData, setExportWalletData] = useState({} as Wallet);

  const [renameWalletData, setRenameWalletData] = useState({} as Wallet);
  const [renameValue, setRenameValue] = useState("");

  // The cached balance is neptune's display_lossless() string: "<int>.<34 decimals>"
  // (empty until the first sync completes). Show 4 decimals, truncated — truncation
  // (vs rounding) can only ever UNDERSTATE a balance, never overstate it.
  // Always pad to 4 decimals so a brand-new account (cached balance "") reads the
  // same "0.0000" as a synced zero balance, not a bare "0".
  function amount_to_fixed(amount: string) {
    const [int = "0", frac = ""] = (amount || "0").split(".");
    return `${int}.${frac.substring(0, 4).padEnd(4, "0")}`;
  }

  // Portfolio total across all accounts. Sum the already-formatted per-account
  // values (what the column shows) rather than the raw balances, so the result
  // stays a plain number and matches the table.
  const totalBalance = (wallets ?? []).reduce(
    (sum, w) => bigNumberPlusToString(sum, amount_to_fixed(w.balance || "0") || "0"),
    "0"
  );

  async function changeWallet(wallet: Wallet) {
    let canChange = currentWalletID != wallet.id;
    if (canChange) {
      const id = notify.loading("Changing account", "Switching to " + wallet.name);
      await setCurrentWallet(wallet.id);
      await refreshWalletData();
      notify.done(id, "Account changed", "Switched to " + wallet.name);
    }
  }

  async function refreshWalletData() {
    try {
      setTimeout(() => {
        dispatch(querySyncBlockStatus({ serverUrl }));
        dispatch(queryWallets());
        dispatch(queryWalletBalance({ serverUrl }));
      }, 200);
    } catch (error) {}
  }

  const stack = useModalsStack(["export-page", "rename-page"]);
  async function confirmRemoveWallet(wallet: Wallet) {
    try {
      await removeWallet(wallet.id);
      remoceContact(wallet.address);
      dispatch(queryWallets());
      notify.success("Account " + wallet.name + " has been deleted", "Account deleted");
    } catch (error: any) {
      notify.error(error, "Please try again.", "Couldn't delete account");
    }
  }

  async function confirmExportWallet() {
    stack.closeAll();
  }

  async function confirmRenameWallet() {
    const name = renameValue.trim();
    if (!renameWalletData || !renameWalletData.id || !name) {
      return;
    }
    try {
      await renameWallet(renameWalletData.id, name);
      dispatch(queryWallets());
      notify.success('Account renamed to "' + name + '"', "Account renamed");
    } catch (error: any) {
      notify.error(error, "Please try again.", "Couldn't rename account");
    }
    stack.closeAll();
  }

  // Styled to match the Contacts page's delete confirmation, plus an explicit
  // acknowledgement checkbox: deletion irrecoverably erases the account's keys,
  // so a reflexive confirm-click alone is not enough.
  function onClickRemoveWallet(wallet: Wallet) {
    modals.open({
      title: "Delete this account?",
      centered: true,
      children: (
        <DeleteAccountConfirm wallet={wallet} onConfirm={() => confirmRemoveWallet(wallet)} />
      ),
    });
  }

  function onClickRenameWallet(wallet: Wallet) {
    setRenameWalletData(wallet);
    setRenameValue(wallet.name ?? "");
    setTimeout(() => {
      stack.open("rename-page");
    }, 200);
  }

  function onClickExportWallet(wallet: Wallet) {
    setExportWalletData(wallet);
    setShowExportWalletModal(true);
  }

  async function remoceContact(address: string) {
    await deleteContactAddress({ address });
  }

  const rows = wallets.map((element, index) => (
    <Table.Tr
      key={index}
      bg={currentWalletID === element.id ? "var(--mantine-color-blue-light)" : undefined}
      // Row click switches the active account (the menu's Switch item remains);
      // interactive cells below stop propagation so they don't trigger a switch.
      onClick={() => changeWallet(element)}
      title={currentWalletID === element.id ? undefined : "Switch to this account"}
      style={{ cursor: currentWalletID === element.id ? "default" : "pointer" }}
    >
      <Table.Td>
        <Flex direction={"row"} align={"center"} gap={8}>
          <Text>{element.name}</Text>
          {currentWalletID === element.id && (
            <Badge color="blue" variant="filled" size="sm">
              Active
            </Badge>
          )}
        </Flex>
      </Table.Td>
      <Table.Td>
        <Flex direction={"row"} gap={8} align={"center"}>
          {/* stopPropagation so selecting/copying the address doesn't also switch
              account (the row's click handler); the rest of the row still switches. */}
          <span onClick={(e) => e.stopPropagation()}>
            <MonoText value={element.address} />
          </span>
        </Flex>
      </Table.Td>
      <Table.Td>
        {
          <Flex direction={"row"} align={"center"} gap={8} justify={"center"}>
            <Text fw={600} c="var(--color-positive)">
              {amount_to_fixed(element.balance ?? "0")}
            </Text>
            NPT
          </Flex>
        }
      </Table.Td>
      <Table.Td onClick={(e) => e.stopPropagation()}>
        <ActionMenu
          isCurrentWallet={currentWalletID == element.id}
          switchWallet={() => changeWallet(element)}
          renameWallet={() => onClickRenameWallet(element)}
          removeWallet={() => {
            onClickRemoveWallet(element);
          }}
          exportWallet={() => onClickExportWallet(element)}
          importRandomness={handleImportRandomness}
        />
      </Table.Td>
    </Table.Tr>
  ));
  return (
    <Flex direction={"column"} gap={8} style={{ flex: 1, minHeight: 0 }}>
      <ExportWalletModal
        id={exportWalletData.id}
        opened={showExportWalletModal}
        closeModal={() => setShowExportWalletModal(false)}
      />
      <Modal.Stack>
        <Modal {...stack.register("export-page")} title="Export account">
          <Group mt="lg" justify="flex-end">
            <Button onClick={stack.closeAll} variant="default">
              Cancel
            </Button>
            <Button onClick={() => confirmExportWallet()} color="red.9">
              Confirm
            </Button>
          </Group>
        </Modal>

        <Modal {...stack.register("rename-page")} title="Rename account">
          <TextInput
            data-autofocus
            label="Account name"
            placeholder="Enter a name for your wallet"
            value={renameValue}
            onChange={(event) => setRenameValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") confirmRenameWallet();
            }}
          />
          <Group mt="lg" justify="flex-end">
            <Button onClick={stack.closeAll} variant="default">
              Cancel
            </Button>
            <Button
              onClick={() => confirmRenameWallet()}
              variant="light"
              disabled={!renameValue.trim()}
            >
              Save
            </Button>
          </Group>
        </Modal>
      </Modal.Stack>
      <AddWalletModal opened={showAddWalletModal} onClose={() => setShowAddWalletModal(false)} />
      <Flex direction={"row"} justify={"space-between"} align={"center"} mb={"sm"}>
        <Button
          variant="light"
          size="xs"
          onClick={() => setShowAddWalletModal(true)}
          leftSection={<IconPlus size={14} />}
        >
          Add account
        </Button>
        {wallets.length > 1 && (
          <Text size="sm" fw={500}>
            Total across {wallets.length} accounts:{" "}
            <NumberFormatter value={totalBalance} thousandSeparator /> NPT
          </Text>
        )}
      </Flex>
      {/* No offsetScrollbars: it pads the right edge by the scrollbar size whenever
          the list scrolls, pushing the table 8px out of line with the balance cards
          and the portfolio total above. The thin auto scrollbar overlays instead —
          same behavior as the History/Send page scroll areas. */}
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" scrollbarSize={8}>
        <Box pos="relative">
          <LoadingOverlay
            visible={loading}
            zIndex={1000}
            overlayProps={{ radius: "sm", blur: 2 }}
            loaderProps={{ color: "blue" }}
          />
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
                <Table.Th>Account name</Table.Th>
                <Table.Th>Address</Table.Th>
                <Table.Th>Total balance</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{rows}</Table.Tbody>
          </Table>
        </Box>
      </ScrollArea>
    </Flex>
  );
}
