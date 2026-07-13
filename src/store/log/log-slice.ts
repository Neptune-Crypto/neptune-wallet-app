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
    builder.addCase(queryLogMessages.pending, (state) => {
      state.loadingLogs = true;
    });
    builder.addCase(queryLogMessages.rejected, (state) => {
      state.loadingLogs = false;
    });
    builder.addCase(queryLogMessages.fulfilled, (state, action) => {
      state.loadingLogs = false;
      const next = action.payload.data;
      const prev = state.logs;
      // Skip the update (and the re-render it would trigger) when the log is
      // unchanged. Logs only append or roll off the front, so comparing the
      // length and the first/last entries is a cheap, reliable check.
      const unchanged =
        prev.length === next.length &&
        prev[prev.length - 1] === next[next.length - 1] &&
        prev[0] === next[0];
      if (!unchanged) {
        state.logs = next;
      }
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
