import { get_logs } from "@/commands/log";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { LogState } from "../types";

const initialState: LogState = {
  loadingLogs: false,
  logs: [],
};

const logSlice = createSlice({
  name: "log",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(queryLogMessages.pending, (state, action) => {
      state.loadingLogs = true;
    });
    builder.addCase(queryLogMessages.rejected, (state, action) => {
      state.loadingLogs = false;
    });
    builder.addCase(queryLogMessages.fulfilled, (state, action) => {
      state.loadingLogs = false;
      state.logs = action.payload.data;
    });
  },
});

export const queryLogMessages = createAsyncThunk<{ data: string[] }>(
  "/api/log/queryLogMessages",
  async () => {
    const req = await get_logs();
    let logs = req as string[];
    return {
      data: logs,
    };
  }
);

export const {} = logSlice.actions;

export default logSlice.reducer;
