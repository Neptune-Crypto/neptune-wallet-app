import { get_build_info } from "@/commands/app";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { AboutState, BuildInfo } from "../types";

const initialState: AboutState = {
  loadingAbout: false,
  buildInfo: null,
  version: "",
  tauriVersion: "",
};

const aboutSlice = createSlice({
  name: "about",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(queryAboutInfo.pending, (state, action) => {
      state.loadingAbout = true;
    });
    builder.addCase(queryAboutInfo.rejected, (state, action) => {
      state.loadingAbout = false;
    });
    builder.addCase(queryAboutInfo.fulfilled, (state, action) => {
      state.loadingAbout = false;
      state.buildInfo = action.payload.data;
      state.version = action.payload.version;
      state.tauriVersion = action.payload.tauriVersion;
    });
  },
});

export const queryAboutInfo = createAsyncThunk<{
  data: BuildInfo;
  version: string;
  tauriVersion: string;
}>("/api/about/queryAboutInfo", async () => {
  const buildInfo = await get_build_info();
  let tauriVersion = await getTauriVersion();
  let version = await getVersion();
  return {
    data: buildInfo,
    version,
    tauriVersion,
  };
});

export const {} = aboutSlice.actions;

export default aboutSlice.reducer;
