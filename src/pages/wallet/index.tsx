import WithTitlePageHeader from "@/components/header/withTitlePageHeader";
import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { useLatestBlock, useSyncedBlock } from "@/store/sync/hooks";
import { queryWalletBalance, queryWallets } from "@/store/wallet/wallet-slice";
import { Flex } from "@mantine/core";
import { useEffect } from "react";
import BalanceCard from "./component/balanceCard";
import WalletTable from "./component/walletTable";

export default function WalletPage() {
  const { serverUrl } = useSettingActionData();
  const dispatch = useAppDispatch();
  const latestBlock = useLatestBlock();
  const syncedBlock = useSyncedBlock();
  useEffect(() => {
    dispatch(queryWallets());
    dispatch(queryWalletBalance({ serverUrl }));
  }, [dispatch, serverUrl]);

  useEffect(() => {
    if (latestBlock && syncedBlock && latestBlock === syncedBlock) {
      dispatch(queryWalletBalance({ serverUrl }));
    }
  }, [latestBlock, syncedBlock]);

  return (
    <WithTitlePageHeader title="Wallet">
      <Flex direction={"column"} style={{ width: "100%" }} gap={16}>
        <BalanceCard />
        <WalletTable />
      </Flex>
    </WithTitlePageHeader>
  );
}
