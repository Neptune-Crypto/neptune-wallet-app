import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { querySyncBlockStatus } from "@/store/sync/sync-slice";
import { queryWalletBalance, queryWallets } from "@/store/wallet/wallet-slice";
import { notify } from "@/utils/notify";
import { Flex, Modal, SegmentedControl } from "@mantine/core";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { useEffect, useState } from "react";
import CreateWallet from "./create-wallet";
import ImportWallet from "./import-wallet";

export default function AddWalletModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const [section, setSection] = useState("create");
  const dispatch = useAppDispatch();
  const { serverUrl } = useSettingActionData();
  const [mnemonic, setMnemonic] = useState("");
  async function onCreated() {
    dispatch(queryWallets());
    dispatch(queryWalletBalance({ serverUrl }));
    dispatch(querySyncBlockStatus({ serverUrl }));
    onClose();
  }
  useEffect(() => {
    // Only generate when no seed exists yet: the user may have revealed and
    // written down the current one, and regenerating on a tab toggle or on
    // reopen (e.g. after an accidental click outside the modal) would silently
    // invalidate that backup. Fresh seeds come only from the explicit "Change
    // seed phrase" button below, or once this seed is consumed by a creation.
    if (opened && section === "create" && !mnemonic) {
      setMnemonic(bip39.generateMnemonic(wordlist, 192));
    }
  }, [section, opened]);
  return (
    <Modal
      opened={opened}
      size={"lg"}
      centered
      yOffset="2dvh"
      onClose={onClose}
      title="Add account"
    >
      <Flex direction="column">
        <SegmentedControl
          value={section}
          onChange={(value: any) => setSection(value)}
          transitionTimingFunction="ease"
          fullWidth
          data={[
            { label: "Create account", value: "create" },
            { label: "Import account", value: "import" },
          ]}
        />
        {section === "create" && (
          <CreateWallet
            mnemonic={mnemonic}
            onCreated={() => {
              // This seed now belongs to the created account; clear it so the
              // next "Add account" starts from a fresh one.
              setMnemonic("");
              onCreated();
            }}
            refreshMnemonic={() => {
              let mnemonic = bip39.generateMnemonic(wordlist, 192);
              setMnemonic(mnemonic);
              notify.success("New seed phrase generated");
            }}
          />
        )}
        {section === "import" && <ImportWallet onCreated={async () => onCreated()} />}
      </Flex>
    </Modal>
  );
}
