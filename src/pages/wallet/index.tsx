import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { useLatestBlock, useSyncedBlock } from "@/store/sync/hooks";
import { queryWalletBalance, queryWallets } from "@/store/wallet/wallet-slice";
import { Container, Flex } from "@mantine/core";
import { useEffect } from "react";
import BalanceCard from "./component/balanceCard";
import BlockSyncCard from "./component/block-sync-card";
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
    <Container fluid w={"100%"}>
      <Flex direction={"column"} style={{ width: "100%" }} gap={16} px={24}>
        <BlockSyncCard />
        <BalanceCard />
        <WalletTable />
      </Flex>
    </Container>
  );
}
