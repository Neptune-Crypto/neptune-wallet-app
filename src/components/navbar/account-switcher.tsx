import { setCurrentWallet } from "@/commands/wallet";
import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { querySyncBlockStatus } from "@/store/sync/sync-slice";
import { Wallet } from "@/store/types";
import { useCurrentWalledId, useWallets } from "@/store/wallet/hooks";
import { queryWalletBalance, queryWallets } from "@/store/wallet/wallet-slice";
import { Box, Group, Menu, Text, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconChevronDown, IconWallet } from "@tabler/icons-react";
import { useEffect } from "react";

// Active-account indicator + switcher, shown at the top of the sidebar so the
// current account is visible on every page and can be changed from anywhere.
export default function AccountSwitcher() {
  const wallets = useWallets();
  const currentWalletID = useCurrentWalledId();
  const { serverUrl } = useSettingActionData();
  const dispatch = useAppDispatch();
  const current = wallets.find((w) => w.id === currentWalletID);

  // Ensure the account list is loaded even if the user lands on a non-wallet page.
  useEffect(() => {
    dispatch(queryWallets());
  }, [dispatch]);

  async function changeWallet(wallet: Wallet) {
    if (currentWalletID === wallet.id) return;
    const id = notifications.show({
      position: "top-right",
      loading: true,
      title: "Changing account",
      message: "Switching to " + wallet.name,
      autoClose: false,
      withCloseButton: false,
    });
    await setCurrentWallet(wallet.id);
    setTimeout(() => {
      dispatch(querySyncBlockStatus({ serverUrl }));
      dispatch(queryWallets());
      dispatch(queryWalletBalance({ serverUrl }));
    }, 200);
    notifications.update({
      id,
      position: "top-right",
      color: "green",
      title: "Account changed",
      message: "Switched to " + wallet.name,
      icon: <IconCheck size={18} />,
      loading: false,
      autoClose: 2000,
      withCloseButton: true,
    });
  }

  return (
    <Box px={12}>
      <Menu shadow="md" width="target" position="bottom" withinPortal>
        <Menu.Target>
          <UnstyledButton
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "#fff",
            }}
          >
            <Group gap={8} wrap="nowrap">
              <IconWallet size={18} style={{ flexShrink: 0 }} />
              <Text size="sm" fw={600} truncate style={{ flex: 1, minWidth: 0 }}>
                {current?.name ?? "—"}
              </Text>
              <IconChevronDown size={16} style={{ flexShrink: 0, opacity: 0.7 }} />
            </Group>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          {wallets.map((w) => (
            <Menu.Item
              key={w.id}
              onClick={() => changeWallet(w)}
              rightSection={w.id === currentWalletID ? <IconCheck size={16} /> : undefined}
            >
              {w.name}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </Box>
  );
}
