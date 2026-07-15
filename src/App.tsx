import { notify } from "@/utils/notify";
import "@mantine/charts/styles.css";
import "@mantine/core/styles.css";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import "./app.css";
import { ViewPort } from "./components/base/ViewPort";
import { UpdateProvider } from "./components/update/update-context";
import { UpdateHandler } from "./components/UpdateHandler"; // Path to the new component
import WindowTitlebarCard from "./components/windowTitlebarCard";
import { SYNC_FINISH_EVENT, SYNC_HEIGHT_EVENT, SYNC_SENT_STATUS_EVENT } from "./constant";
import { queryAboutInfo } from "./store/about/about-slice";
import { checkAuthPassword, startRunRpcServer } from "./store/auth/auth-slice";
import { useAuth, useStartRpcServer } from "./store/auth/hooks";
import { updateSendState } from "./store/execution/execution-slice";
import { useRequesetSendTransactionResponse } from "./store/execution/hooks";
import { useAppDispatch } from "./store/hooks";
import { useCurrentPlatform, useSettingActionData } from "./store/settings/hooks";
import { queryCurrentPlatform, querySettingActionData } from "./store/settings/settings-slice";
import {
  handleFinishBlockStatus,
  queryLatestBlock,
  querySyncBlockStatus,
  updateSyncedBlock,
} from "./store/sync/sync-slice";
import { useCurrentWalledId } from "./store/wallet/hooks";
import { queryWalletBalance, queryWallets } from "./store/wallet/wallet-slice";

function App() {
  const platform = useCurrentPlatform();
  if (platform == "android" || platform == "ios") {
    document.documentElement.style.setProperty("--body-radius", "0");
  }
  return (
    // UpdateProvider owns the single update check; UpdateHandler (startup prompt),
    // the About view, and the sidebar badge all read from it.
    <UpdateProvider>
      <WindowTitlebarCard />
      <UpdateHandler />
      <NotificationCard />
      <InitApp />
      <ViewPort />
    </UpdateProvider>
  );
}
const InitApp = (): null => {
  const dispatch = useAppDispatch();
  const { hasAuth } = useAuth();
  const startedRpcServer = useStartRpcServer();
  const { serverUrl } = useSettingActionData();
  const currentWalletID = useCurrentWalledId();
  // The backend re-emits sync_finish every ~60s while idle at tip; only refetch
  // balances when the height actually advanced, or the Wallet page's loading
  // states flash on a once-a-minute heartbeat.
  const lastSyncedHeight = useRef<number | null>(null);
  useEffect(() => {
    // Same chain height, different account: the post-switch sync must refetch,
    // so the guard resets whenever the active account changes.
    lastSyncedHeight.current = null;
  }, [currentWalletID]);
  useEffect(() => {
    dispatch(queryCurrentPlatform());
    dispatch(checkAuthPassword());
  }, [dispatch]);

  useEffect(() => {
    if (hasAuth) {
      dispatch(queryAboutInfo());
      dispatch(startRunRpcServer());
    }
  }, [hasAuth]);
  useEffect(() => {
    dispatch(querySettingActionData());
  }, [startedRpcServer]);

  useEffect(() => {
    if (serverUrl) {
      dispatch(queryLatestBlock({ serverUrl }));
      dispatch(querySyncBlockStatus({ serverUrl }));
      initEvent();
    }
  }, [serverUrl]);

  function initEvent() {
    listen<number>(SYNC_HEIGHT_EVENT, (event) => {
      dispatch(updateSyncedBlock(event.payload));
    });
    listen<number>(SYNC_FINISH_EVENT, (event) => {
      console.log("sync finish");
      dispatch(handleFinishBlockStatus({ serverUrl }));
      if (event.payload === lastSyncedHeight.current) return;
      lastSyncedHeight.current = event.payload;
      // A processed block can confirm pending transactions and mint change;
      // refetch so available/pending figures update on whatever page is open.
      dispatch(queryWalletBalance({ serverUrl }));
      // The accounts table shows the cached per-account total, which the
      // backend rewrites just before emitting this event — refetch the list so
      // the table picks it up (e.g. an incoming tx found while syncing).
      dispatch(queryWallets());
    });
    listen<number>(SYNC_SENT_STATUS_EVENT, (event) => {
      dispatch(updateSendState(event.payload));
    });
  }
  return null;
};
const NotificationCard = (): null => {
  const requesTransactionResponse = useRequesetSendTransactionResponse();
  useEffect(() => {
    handleRequesTransactionResponse();
  }, [requesTransactionResponse]);
  function handleRequesTransactionResponse() {
    if (requesTransactionResponse.transaction) {
      // Same vocabulary as the send checklist's final step and the
      // "Transactions awaiting network confirmation" section the tx lands in.
      notify.success("Now awaiting network confirmation.", "Transaction sent");
    } else if (
      !requesTransactionResponse.transaction &&
      requesTransactionResponse.message &&
      // The Send page prompts just-in-time and retries for this case; don't also
      // surface it as a raw error toast.
      !requesTransactionResponse.requiresLustration
    ) {
      // Sticky: this lands after minutes of proving — the user has likely
      // tabbed away, and "did my money send?" must not expire unseen.
      notify.error(undefined, requesTransactionResponse.message, "Couldn't send transaction", {
        sticky: true,
      });
    }
  }
  return null;
};
export default App;
