import { ActionIcon, Center, Menu, Text } from "@mantine/core";
import {
  IconArrowBarToDown,
  IconDots,
  IconExchange,
  IconKey,
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
    <Menu shadow="md" width={230} position="bottom-end">
      <Menu.Target>
        <Center>
          <ActionIcon size="sm" variant="default">
            <IconDots size={14} />
          </ActionIcon>
        </Center>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Item
          disabled={isCurrentWallet}
          leftSection={<IconExchange size={14} />}
          onClick={switchWallet}
        >
          <Text>Set as active</Text>
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<IconPencil size={14} />} onClick={renameWallet}>
          <Text>Rename account</Text>
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          disabled={isCurrentWallet}
          color="red"
          leftSection={<IconTrash size={14} />}
          onClick={removeWallet}
        >
          <Text>Delete account</Text>
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          leftSection={<IconArrowBarToDown size={14} />}
          onClick={importRandomness}
          disabled={!isCurrentWallet}
        >
          <Text>Import randomness</Text>
          {/* Menus don't tooltip well (hover selects, keyboards never see it), so
              explain inline — same label + description pattern as Settings rows. */}
          <Text size="xs" c="dimmed">
            Recover funds from an incoming-randomness (.dat) file
          </Text>
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<IconKey size={14} />} onClick={exportWallet}>
          <Text>View seed phrase</Text>
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
