import { snapshot_dir } from "@/commands/app";
import { get_disk_cache, set_disk_cache, set_network } from "@/commands/config";
import { set_log_level } from "@/commands/log";
import { LOG_LEVELS, NETWORKS } from "@/constant";
import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { querySyncBlockStatus } from "@/store/sync/sync-slice";
import { queryWalletBalance, queryWallets } from "@/store/wallet/wallet-slice";
import { notify } from "@/utils/notify";
import { Flex, Select, Switch, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconCirclesRelation,
  IconCube,
  IconDatabase,
  IconEye,
  IconEyeOff,
  IconFolderOpen,
  IconFolderShare,
  IconLicense,
  IconLockCog,
  IconPlugConnected,
  IconWorld,
} from "@tabler/icons-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import CopyedIcon from "../../../components/copyed-icon";
import BaseItem from "./base-item";
import EditRemoteIcon from "./edit-remote-icon";
import ResetPasswordIcon from "./reset-password-icon";
import ResyncIcon from "./resync-icon";
import TrashDiskIcon from "./trash-disk-icon";

export default function SettingList() {
  const dispatch = useAppDispatch();
  const { serverUrl, network, logLevel, remoteUrl } = useSettingActionData();
  const [selectedLogLevel, setSelectedLogLevel] = useState<string | null>("");

  const [selectedNetwork, setSelectedNetwork] = useState<string | null>("");
  const [dataDir, setDataDir] = useState("");
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    setSelectedLogLevel(logLevel);
  }, [logLevel]);
  useEffect(() => {
    setSelectedNetwork(network);
  }, [network]);
  useEffect(() => {
    queryDiskCache();
    queryDataRir();
  }, []);
  async function queryDataRir() {
    let address = await snapshot_dir();
    setDataDir(address);
  }

  async function queryDiskCache() {
    let diskCache = await get_disk_cache();
    setChecked(diskCache);
  }

  async function changeDiskCache(enable: boolean) {
    try {
      await set_disk_cache(enable);
      setChecked(enable);
      notify.success("Disk cache has been changed");
    } catch (error: any) {
      notify.error(error, "Failed to change disk cache.");
    }
  }

  async function changeLogLevel(value: string | null) {
    if (value) {
      try {
        await set_log_level(value);
        setSelectedLogLevel(value);
      } catch (error: any) {
        notify.error(error, "Failed to change log level.");
      }
    }
  }

  // Switching network is consequential (connects to a different chain and
  // deselects the active account), so require explicit confirmation.
  function changeNetwork(value: string | null) {
    if (!value || value === selectedNetwork) return;
    modals.openConfirmModal({
      title: "Switch network?",
      centered: true,
      children: (
        <Text size="sm">
          Switch from {selectedNetwork} to {value}? The wallet will connect to the {value} network
          — the active account is deselected, and the accounts, balances, and history shown will
          be those of {value}.
        </Text>
      ),
      labels: { confirm: "Switch network", cancel: "Cancel" },
      confirmProps: { variant: "light" },
      onConfirm: async () => {
        try {
          await set_network(value);
          setSelectedNetwork(value);
          // set_network deselects the active account; refresh wallet state.
          dispatch(queryWallets());
          dispatch(queryWalletBalance({ serverUrl }));
          dispatch(querySyncBlockStatus({ serverUrl }));
          notify.success("Switched to " + value, "Network changed");
        } catch (error: any) {
          notify.error(error, "Failed to change network.");
        }
      },
    });
  }

  const [hideServerUrl, setHideServerUrl] = useState(true);

  // Small dimmed group label; mt separates a group from the rows above it.
  const SectionHeader = ({ first, children }: { first?: boolean; children: string }) => (
    <Text size="xs" fw={700} c="dimmed" tt="uppercase" mt={first ? 0 : 12}>
      {children}
    </Text>
  );

  return (
    <Flex direction="column" gap={16} w={"100%"}>
      <SectionHeader first>Connection</SectionHeader>
      <BaseItem
        leftSection={<IconCirclesRelation />}
        label={"Local RPC URL"}
        description="The wallet's own local backend (127.0.0.1). Carries an access token, so keep it private."
        value={serverUrl}
        hide={hideServerUrl}
        rightSection={
          <Flex direction={"row"} gap={8} align={"center"}>
            {!hideServerUrl ? (
              <IconEyeOff
                style={{
                  cursor: "pointer",
                }}
                size={18}
                onClick={() => setHideServerUrl(true)}
              />
            ) : (
              <IconEye
                style={{
                  cursor: "pointer",
                }}
                size={18}
                onClick={() => setHideServerUrl(false)}
              />
            )}
            <CopyedIcon value={serverUrl} />
          </Flex>
        }
      />

      <BaseItem
        leftSection={<IconPlugConnected />}
        label={"Remote node URL"}
        description="The remote Neptune node the wallet fetches blockchain data from."
        value={remoteUrl}
        rightSection={
          <Flex direction={"row"} gap={8}>
            <EditRemoteIcon value={remoteUrl} />
            <CopyedIcon value={remoteUrl} />
          </Flex>
        }
      />

      <BaseItem
        leftSection={<IconWorld />}
        label={"Network"}
        description="Which Neptune network the wallet connects to."
        rightSection={
          <Select
            allowDeselect
            size="xs"
            data={NETWORKS}
            value={selectedNetwork}
            onChange={changeNetwork}
          />
        }
      />

      <SectionHeader>Security</SectionHeader>
      <BaseItem
        leftSection={<IconLockCog />}
        label={"Password"}
        description="Change the password that unlocks this wallet."
        rightSection={<ResetPasswordIcon />}
      />

      <SectionHeader>Maintenance</SectionHeader>
      <BaseItem
        leftSection={<IconCube />}
        label={"Resync block height"}
        description="Re-scan the blockchain from a chosen block height to rebuild balances and history."
        rightSection={<ResyncIcon />}
      />

      <BaseItem
        leftSection={<IconDatabase />}
        label={"Disk cache"}
        description="Keep downloaded blocks on disk to speed up future syncs."
        rightSection={
          <Flex direction={"row"} gap={8} align={"center"}>
            <TrashDiskIcon />
            <Switch
              checked={checked}
              onChange={(event) => changeDiskCache(event.currentTarget.checked)}
              onLabel="ON"
              offLabel="OFF"
              size="sm"
            />
          </Flex>
        }
      />

      <BaseItem
        leftSection={<IconFolderOpen />}
        label={"Open data directory"}
        description="Open the folder where the wallet stores its files."
        value={`${dataDir}`}
        rightSection={
          <IconFolderShare
            size={18}
            style={{ cursor: "pointer" }}
            onClick={async () => {
              await revealItemInDir(dataDir);
            }}
          />
        }
      />

      <SectionHeader>Diagnostics</SectionHeader>
      <BaseItem
        leftSection={<IconLicense />}
        label={"Log level"}
        description="How much detail the app writes to its logs."
        rightSection={
          <Select
            allowDeselect
            size="xs"
            data={LOG_LEVELS}
            value={selectedLogLevel}
            onChange={changeLogLevel}
          />
        }
      />
    </Flex>
  );
}
