// Latest height
export const LATEST_BLOCKHEIGHT = "/rpc/block/tip_height";

export const SCAN_BLOCK_STATE = "/rpc/scan/state";

export const START_SCAN_BLOCK = "/rpc/scan/0/0";
// History records
export const WALLET_ACTIVITY_HISTORY = "/rpc/wallet/history";

export const WALLET_AVAILABLE_UTXOS = "/rpc/wallet/available_utxos";

// Transaction history in progress
export const WALLET_PENDING_HISTORY = "/rpc/mempool/pendingtx";
// Cancel transaction /rpc/forget_tx/${txid}
export const WALLET_FORGET_TX = "/rpc/forget_tx/";
// Send transaction
export const WALLET_SEND_TRANSACTION = "/rpc/send";

// Cheap pre-check (no proving) for whether a send would require lustration.
export const WALLET_REQUIRES_LUSTRATION = "/rpc/requires_lustration";

// Wallet balance
export const WALLET_BALANCE = "/rpc/wallet/balance";

export const SYNC_HEIGHT_EVENT = "sync_height"; // Sync progress
export const SYNC_STOP_EVENT = "sync_stop"; // Stop syncing
export const SYNC_FINISH_EVENT = "sync_finish"; // Sync completed
export const SYNC_NEW_BLOCK_EVENT = "syncing_new_block"; // A new block height is received

export const SYNC_SENT_STATUS_EVENT = "send_state"; // Status when sending a transaction

export const LOG_LEVELS = [
  { value: "error", label: "Error" },
  { value: "warn", label: "Warn" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
  { value: "trace", label: "Trace" },
];

export const NETWORKS = [{ value: "main", label: "Mainnet" }];

// Manual-download fallback for installs the one-click updater can't service
// (e.g. Linux .deb/.rpm, which Tauri's updater cannot replace in place).
export const RELEASES_URL = "https://github.com/Neptune-Crypto/neptune-wallet-app/releases/latest";

// Block-explorer page for a single transaction output, keyed by its canonical
// commitment. Append the commitment hex. The explorer domain is allow-listed
// for opening via opener:allow-open-url in src-tauri/capabilities/default.json.
export const EXPLORER_OUTPUT_URL = "https://neptunefundamentals.org/output/";
