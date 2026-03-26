import "@mantine/core/styles.css";
import { ModalsProvider } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import "./app.css";
import { ViewPort } from "./components/base/ViewPort";
import { UpdateHandler } from "./components/UpdateHandler"; // Path to the new component
import WindowTitlebarCard from "./components/windowTitlebarCard";
import { SYNC_FINISH_EVENT, SYNC_HEIGHT_EVENT, SYNC_SENT_STATUS_EVENT } from "./constant";
import { checkHasUpdateVersion, queryAboutInfo } from "./store/about/about-slice";
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

function App() {
  const platform = useCurrentPlatform();
  if (platform == "android" || platform == "ios") {
    document.documentElement.style.setProperty("--body-radius", "0");
  }
  return (
    <>
      <ModalsProvider>
        <WindowTitlebarCard />
        <UpdateHandler /> {/* This handles the update logic */}
        <NotificationCard />
        <InitApp />
        <ViewPort />
      </ModalsProvider>
    </>
  );
}
const InitApp = (): null => {
  const dispatch = useAppDispatch();
  const { hasAuth } = useAuth();
  const startedRpcServer = useStartRpcServer();
  const { serverUrl, remoteUrl } = useSettingActionData();
  useEffect(() => {
    dispatch(queryCurrentPlatform());
    dispatch(checkAuthPassword());
  }, [dispatch]);

  useEffect(() => {
    if (hasAuth) {
      dispatch(queryAboutInfo());
      dispatch(startRunRpcServer());
      dispatch(checkHasUpdateVersion());
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
      notifications.show({
        position: "top-right",
        color: "green",
        title: "Success",
        message: "Create transaction success!",
      });
    } else if (!requesTransactionResponse.transaction && requesTransactionResponse.message) {
      notifications.show({
        position: "top-right",
        color: "red",
        title: "Error",
        message: requesTransactionResponse.message,
      });
    }
  }
  return null;
};
export default App;
