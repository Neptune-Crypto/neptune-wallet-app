import { get_server_url } from "@/commands/app";
import {
  get_auto_lock_minutes,
  get_list_cache,
  get_network,
  get_rest_url,
} from "@/commands/config";
import { get_log_level } from "@/commands/log";
import { get_platform, os_info } from "@/commands/os";
import { AUTO_LOCK_NEVER } from "@/constant";
import { handleServiceUrl } from "@/utils/url";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { BlockCacheFile, Info, SettingActionData, SettingsState } from "../types";

const initialState: SettingsState = {
  acctionData: {
    serverUrl: "",
    network: "",
    logLevel: "",
    remoteUrl: "",
    password: "",
    system: {
      os_type: "",
      version: "",
      edition: "",
      codename: "",
      bitness: "",
      architecture: "",
    },
  },
  loadingSettings: false,
  platform: "",
  cacheFiles: [],
  // Until the stored value is read back, treat the wallet as never
  // auto-locking, so a slow query can't lock a wallet the user set to "Never".
  autoLockMinutes: AUTO_LOCK_NEVER,
};

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    updateAutoLockMinutes: (state, action) => {
      state.autoLockMinutes = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(querySettingActionData.pending, (state) => {
      state.loadingSettings = true;
    });
    builder.addCase(querySettingActionData.rejected, (state) => {
      state.loadingSettings = false;
    });
    builder.addCase(querySettingActionData.fulfilled, (state, action) => {
      state.loadingSettings = false;
      state.acctionData = action.payload.data;
    });
    builder.addCase(queryCurrentPlatform.fulfilled, (state, action) => {
      state.platform = action.payload.data;
    });
    builder.addCase(queryDiskCacheFiles.fulfilled, (state, action) => {
      state.cacheFiles = action.payload.data;
    });
    builder.addCase(queryAutoLockMinutes.fulfilled, (state, action) => {
      state.autoLockMinutes = action.payload.data;
    });
  },
});

export const queryCurrentPlatform = createAsyncThunk<{ data: string }>(
  "/api/settings/queryCurrentPlatform",
  async () => {
    const platform = await get_platform();
    return {
      data: platform,
    };
  }
);

export const querySettingActionData = createAsyncThunk<{
  data: SettingActionData;
}>("/api/settings/querySettingActionData", async () => {
  let newData = {
    serverUrl: "",
    network: "",
    logLevel: "",
    remoteUrl: "",
    password: "",
    system: {
      os_type: "",
      version: "",
      edition: "",
      codename: "",
      bitness: "",
      architecture: "",
    },
  } as SettingActionData;
  let requestFunctions = [
    get_server_url(),
    get_network(),
    os_info(),
    get_rest_url(),
    get_log_level(),
  ];
  let results = await Promise.allSettled(requestFunctions);
  results.forEach((result, index) => {
    switch (index) {
      case 0:
        if (result.status === "fulfilled") {
          let url = result.value.toString();
          let { authorization } = handleServiceUrl(url);
          localStorage.setItem("token", authorization);
          newData.serverUrl = url;
        }
        break;
      case 1:
        if (result.status === "fulfilled") {
          newData.network = result.value.toString();
        }
        break;
      case 2:
        if (result.status === "fulfilled") {
          newData.system = result.value as Info;
        }
        break;
      case 3:
        if (result.status === "fulfilled") {
          newData.remoteUrl = result.value.toString();
        }
        break;
      case 4:
        if (result.status === "fulfilled") {
          newData.logLevel = result.value.toString();
        }
        break;
    }
  });
  return {
    data: newData,
  };
});

/**
 * Read the stored idle auto-lock timeout. Kept out of `querySettingActionData`
 * because that one waits on the RPC server, and the timeout is a plain config
 * value the idle watcher needs as soon as the wallet is unlocked.
 */
export const queryAutoLockMinutes = createAsyncThunk<{ data: number }>(
  "/api/settings/queryAutoLockMinutes",
  async () => {
    return {
      data: await get_auto_lock_minutes(),
    };
  }
);

export const queryDiskCacheFiles = createAsyncThunk<{ data: BlockCacheFile[] }>(
  "/api/settings/queryDiskCacheFiles",
  async () => {
    const req = await get_list_cache();
    return {
      data: req,
    };
  }
);

export const { updateAutoLockMinutes } = settingsSlice.actions;

export default settingsSlice.reducer;
