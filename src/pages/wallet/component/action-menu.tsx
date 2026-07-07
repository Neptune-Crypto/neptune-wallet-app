import { ActionIcon, Center, Menu, Text } from "@mantine/core";
import {
  IconArrowBarToDown,
  IconArrowBarToUp,
  IconDots,
  IconExchange,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";

export default function ActionMenu({
  isCurrentWallet,
  switchWallet,
  renameWallet,
  removeWallet,
  exportWallet,
  importRandomness,
}: {
  isCurrentWallet: boolean;
  switchWallet: () => void;
  renameWallet: () => void;
  removeWallet: () => void;
  exportWallet: () => void;
  importRandomness: () => void;
}) {
  return (
    <Menu shadow="md" width={165} position="bottom-end">
      <Menu.Target>
        <Center>
          <ActionIcon size="sm" variant="default">
            <IconDots size={16} />
          </ActionIcon>
        </Center>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Item
          disabled={isCurrentWallet}
          leftSection={<IconExchange size={14} />}
          onClick={switchWallet}
        >
          <Text>Switch Wallet</Text>
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<IconPencil size={14} />} onClick={renameWallet}>
          <Text>Rename Wallet</Text>
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          disabled={isCurrentWallet}
          leftSection={<IconTrash size={14} />}
          onClick={removeWallet}
        >
          <Text>Remove Wallet</Text>
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          leftSection={<IconArrowBarToDown size={14} />}
          onClick={importRandomness}
          disabled={!isCurrentWallet}
        >
          <Text>Import Randomness</Text>
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<IconArrowBarToUp size={14} />} onClick={exportWallet}>
          <Text>Export Wallet</Text>
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
