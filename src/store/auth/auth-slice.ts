import { run_rpc_server } from "@/commands/app";
import { has_password, try_password } from "@/commands/password";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { AuthData, AuthState } from "../types";

export const _test_internals = {
  startRpcLogic,
};

const initialState: AuthState = {
  startRpcServer: false,
  data: {
    loading: false,
    hasPassword: false,
    hasAuth: false,
  } as AuthData,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(checkAuthPassword.pending, (state, action) => {
      state.data = {
        ...state.data,
        loading: true,
      };
    });
    builder.addCase(checkAuthPassword.rejected, (state, action) => {
      state.data = {
        ...state.data,
        loading: false,
      };
    });
    builder.addCase(checkAuthPassword.fulfilled, (state, action) => {
      state.data = {
        hasAuth: action.payload.hasAuth,
        hasPassword: action.payload.hasPassword,
        loading: false,
      };
    });
    builder.addCase(startRunRpcServer.fulfilled, (state, action) => {
      state.startRpcServer = action.payload.data;
    });
  },
});

export const checkAuthPassword = createAsyncThunk<{
  hasPassword: boolean;
  hasAuth: boolean;
}>("/api/auth/checkAuthPassword", async () => {
  let hasPassword = false;
  let hasAuth = false;
  try {
    hasPassword = await has_password();
    if (hasPassword) {
      hasAuth = await try_password();
    }
  } catch (error) {
    console.log(error);
  }
  return { hasPassword, hasAuth };
});

/**
 * Logic to start the RPC server, with dependency injection to allow mocking.
 */
async function startRpcLogic(
  runRpc: typeof run_rpc_server,
  logger = console
): Promise<{ data: boolean }> {
  let startRpcServer = false;

  try {
    await runRpc();
    startRpcServer = true;
  } catch (error) {
    if (String(error).includes("rpc server is already running")) {
      startRpcServer = true;
    } else {
      // Only log errors other than the "already running" error.
      logger.log(error);
    }
  }

  return { data: startRpcServer };
}

export const startRunRpcServer = createAsyncThunk<{ data: boolean }>(
  "/api/auth/startRunRpcServer",
  async () => {
    return startRpcLogic(run_rpc_server);
  }
);

export const {} = authSlice.actions;

export default authSlice.reducer;
