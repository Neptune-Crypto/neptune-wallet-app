import { removeWallet, renameWallet, setCurrentWallet } from "@/commands/wallet";
import CopyedIcon from "@/components/copyed-icon";
import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { querySyncBlockStatus } from "@/store/sync/sync-slice";
import { Wallet } from "@/store/types";
import { useCurrentWalledId, useLoadingWallets, useWallets } from "@/store/wallet/hooks";
import { queryWalletBalance, queryWallets } from "@/store/wallet/wallet-slice";
import { ellipsis } from "@/utils/ellipsis-format";
import { handleImportRandomness } from "@/utils/import-wallet-randomness";
import { deleteContactAddress } from "@/utils/storage";
import {
  Badge,
  Box,
  Button,
  Flex,
  Group,
  LoadingOverlay,
  Modal,
  ScrollArea,
  Table,
  Text,
  TextInput,
  useModalsStack,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconCirclePlus, IconStarFilled } from "@tabler/icons-react";
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

  async function changeWallet(wallet: Wallet) {
    let canChange = currentWalletID != wallet.id;
    if (canChange) {
      const id = notifications.show({
        position: "top-right",
        loading: true,
        title: "Changing wallet",
        message: "Change wallet to " + wallet.name,
        autoClose: false,
        withCloseButton: false,
      });
      await setCurrentWallet(wallet.id);
      await refreshWalletData();
      notifications.update({
        id,
        position: "top-right",
        color: "green",
        title: "Wallet changed",
        autoClose: 2000,
        message: "Change wallet to " + wallet.name,
        icon: <IconCheck size={18} />,
        loading: false,
        withCloseButton: true,
      });
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
        notifications.show({
          position: "top-right",
          color: "green",
          title: "Account removed",
          message: "Account " + removeWalletData.name + " has been removed",
        });
      } catch (error: any) {
        notifications.show({
          position: "top-right",
          color: "red",
          title: "Failed to remove account",
          message: error || "An error occurred while removing the account.",
        });
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
      notifications.show({
        position: "top-right",
        color: "green",
        title: "Account renamed",
        message: 'Account renamed to "' + name + '"',
      });
    } catch (error: any) {
      notifications.show({
        position: "top-right",
        color: "red",
        title: "Failed to rename account",
        message: error || "An error occurred while renaming the account.",
      });
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
    <Table.Tr key={index}>
      <Table.Td>
        {currentWalletID != element.id ? (
          <Flex>{`#${index + 1}`}</Flex>
        ) : (
          <Flex direction={"row"} align={"center"} style={{ color: "green" }} gap={8}>
            {`#${index + 1}`}
            <IconStarFilled color="green" size={12} />
          </Flex>
        )}
      </Table.Td>
      <Table.Td>
        <Text>{element.name}</Text>
      </Table.Td>
      <Table.Td>
        <Flex direction={"row"} gap={8} align={"center"}>
          <Text>{ellipsis(element.address)}</Text>
          <CopyedIcon size={16} value={element.address} />
        </Flex>
      </Table.Td>
      <Table.Td>
        {
          <Flex direction={"row"} align={"center"} gap={8} justify={"center"}>
            <Text c="green">{amount_to_fixed(element.balance ?? "0")}</Text>
            NPT
          </Flex>
        }
      </Table.Td>
      <Table.Td>
        <Flex direction="row" gap={8} align="center">
          <Badge color="blue" variant="light" size="sm" title="Generation Addresses">
            {element.num_generation_addresses} Gen
          </Badge>
          <Badge color="violet" variant="light" size="sm" title="Symmetric Addresses">
            {element.num_symmetric_addresses} Sym
          </Badge>
          <Badge color="green" variant="light" size="sm" title="EC-hybrid Addresses">
            {element.num_ec_hybrid_addresses} ECH
          </Badge>
          <Badge color="orange" variant="light" size="sm" title="Viewing Addresses">
            {element.num_viewing_addresses} View
          </Badge>
        </Flex>
      </Table.Td>
      <Table.Td>
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
    <Flex direction={"column"} gap={8}>
      <ExportWalletModal
        id={exportWalletData.id}
        opened={showExportWalletModal}
        closeModal={() => setShowExportWalletModal(false)}
      />
      <Modal.Stack>
        <Modal {...stack.register("delete-page")} title="Delete this acount?">
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

        <Modal {...stack.register("export-page")} title="Export Wallet">
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
      <Flex direction={"row"} justify={"space-between"} align={"center"}>
        <Text fz={24} fw={500}>
          Account
        </Text>
        <Button
          variant="light"
          onClick={() => setShowAddWalletModal(true)}
          leftSection={<IconCirclePlus />}
        >
          Add account
        </Button>
      </Flex>
      <ScrollArea h={"calc(100vh - 300px)"} scrollbarSize={0}>
        <Box pos="relative">
          <LoadingOverlay
            visible={loading}
            zIndex={1000}
            overlayProps={{ radius: "sm", blur: 2 }}
            loaderProps={{ color: "pink" }}
          />
          <Table verticalSpacing="md">
            <Table.Tbody>{rows}</Table.Tbody>
          </Table>
        </Box>
      </ScrollArea>
    </Flex>
  );
}
