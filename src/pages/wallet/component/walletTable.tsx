import { removeWallet, renameWallet, setCurrentWallet } from "@/commands/wallet";
import CopyedIcon from "@/components/copyed-icon";
import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { querySyncBlockStatus } from "@/store/sync/sync-slice";
import { Wallet } from "@/store/types";
import { useCurrentWalledId, useLoadingWallets, useWallets } from "@/store/wallet/hooks";
import { queryWalletBalance, queryWallets } from "@/store/wallet/wallet-slice";
import { bigNumberPlusToString } from "@/utils/common";
import { ellipsis } from "@/utils/ellipsis-format";
import { handleImportRandomness } from "@/utils/import-wallet-randomness";
import { notify } from "@/utils/notify";
import { deleteContactAddress } from "@/utils/storage";
import {
  Badge,
  Box,
  Button,
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
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import ActionMenu from "./action-menu";
import AddWalletModal from "./add-wallet-modal";
import ExportWalletModal from "./export-wallet-modal";

export default function WalletTable() {
  const loading = useLoadingWallets();
  const wallets = useWallets();
  const currentWalletID = useCurrentWalledId();
  const { serverUrl } = useSettingActionData();
  const dispatch = useAppDispatch();
  const [showAddWalletModal, setShowAddWalletModal] = useState(false);
  const [removeWalletData, setRemoveWalletData] = useState({} as Wallet);

  const [showExportWalletModal, setShowExportWalletModal] = useState(false);
  const [exportWalletData, setExportWalletData] = useState({} as Wallet);

  const [renameWalletData, setRenameWalletData] = useState({} as Wallet);
  const [renameValue, setRenameValue] = useState("");

  function amount_to_fixed(amount: string) {
    if (!amount) return "0";
    let len = amount.length;
    return amount.substring(0, len - 30);
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

  const stack = useModalsStack(["delete-page", "export-page", "rename-page"]);
  async function confirmRemoveWallet() {
    if (removeWalletData && removeWalletData.id) {
      try {
        await removeWallet(removeWalletData.id);
        remoceContact(removeWalletData.address);
        dispatch(queryWallets());
        notify.success("Account " + removeWalletData.name + " has been removed", "Account removed");
      } catch (error: any) {
        notify.error(
          error,
          "An error occurred while removing the account.",
          "Failed to remove account"
        );
      }
      stack.closeAll();
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
      notify.error(
        error,
        "An error occurred while renaming the account.",
        "Failed to rename account"
      );
    }
    stack.closeAll();
  }

  function onClickRemoveWallet(wallet: Wallet) {
    setRemoveWalletData(wallet);
    setTimeout(() => {
      stack.open("delete-page");
    }, 200);
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
          <Text w={340} truncate>
            {ellipsis(element.address)}
          </Text>
          <span style={{ display: "inline-flex" }} onClick={(e) => e.stopPropagation()}>
            <CopyedIcon size={16} value={element.address} />
          </span>
        </Flex>
      </Table.Td>
      <Table.Td>
        {
          <Flex direction={"row"} align={"center"} gap={8} justify={"center"}>
            <Text fw={600} c="#0A8430">{amount_to_fixed(element.balance ?? "0")}</Text>
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
        <Modal {...stack.register("delete-page")} title="Delete this account?">
          Are you sure you want to remove this account? You will lose control of this account after
          you remove it.
          <Group mt="lg" justify="flex-end">
            <Button onClick={stack.closeAll} variant="light">
              Cancel
            </Button>
            <Button onClick={() => confirmRemoveWallet()} variant="light" color="red">
              Delete
            </Button>
          </Group>
        </Modal>

        <Modal {...stack.register("export-page")} title="Export account">
          <Group mt="lg" justify="flex-end">
            <Button onClick={stack.closeAll} variant="default">
              Cancel
            </Button>
            <Button onClick={() => confirmExportWallet()} color="red">
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
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" scrollbarSize={8} offsetScrollbars>
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
