import {
  AddressRecord,
  NeptuneKeyType,
  PayoutPolicy,
  PayoutPolicyDraft,
  PayoutPreview,
  PayoutRun,
  WatchOnlyAddressRecord,
  WatchOnlyKeyType,
} from "@/utils/api/types";
import { IncomingUtxoRecoveryData } from "@/utils/import-wallet-randomness";
import { invoke } from "@tauri-apps/api/core";

export interface WalletData {
  id: number;
  name: string;
  address: string;
  balance: string;
}
export async function addWallet(
  name: String,
  mnemonic: String,
  num_keys: number,
  start_height: number,
  is_new: boolean
): Promise<number> {
  return await invoke("add_wallet", {
    name: name,
    mnemonic: mnemonic,
    numKeys: num_keys,
    startHeight: start_height,
    isNew: is_new,
  });
}
export async function setCurrentWallet(id: number) {
  await invoke("set_wallet_id", { id });
}
export async function getCurrentWallet(): Promise<number> {
  return await invoke("get_wallet_id", {});
}

export async function getWallets(): Promise<WalletData[]> {
  return await invoke("get_wallets", {});
}

export async function removeWallet(id: number) {
  await invoke("remove_wallet", { id });
}

export async function renameWallet(id: number, name: string) {
  await invoke("rename_wallet", { id, name });
}

export async function getWalletAddress(index: number): Promise<string> {
  return await invoke("wallet_address", { index: index });
}
export async function ExportWallet(password: string, id: number): Promise<string[]> {
  return await invoke("export_wallet", { password, id });
}

export async function resetToHeight(height: number): Promise<string[]> {
  return await invoke("reset_to_height", { height });
}

export async function importIncomingRandomness(
  payload: IncomingUtxoRecoveryData[]
): Promise<string> {
  return await invoke("import_incoming_randomness", { payload });
}

export async function knownAddresses(keyType: NeptuneKeyType): Promise<AddressRecord[]> {
  return await invoke<AddressRecord[]>("known_addresses", { keyType });
}

export async function generateNewAddress(keyType: NeptuneKeyType): Promise<AddressRecord> {
  return await invoke<AddressRecord>("generate_new_address", { keyType });
}

export async function addWatchOnlyAddress(
  keyType: WatchOnlyKeyType,
  address: string,
  name: string,
  preimage?: string
): Promise<WatchOnlyAddressRecord> {
  return await invoke<WatchOnlyAddressRecord>("add_watch_only_address", {
    keyType,
    address,
    preimage: preimage && preimage.trim() !== "" ? preimage.trim() : null,
    name: name.trim(),
  });
}

export async function knownWatchOnlyAddresses(): Promise<WatchOnlyAddressRecord[]> {
  return await invoke<WatchOnlyAddressRecord[]>("known_watch_only_addresses", {});
}

export async function removeWatchOnlyAddress(id: number): Promise<void> {
  await invoke("remove_watch_only_address", { id });
}

// The draft's fields are snake_case to match the backend struct exactly (Tauri
// only camelCases top-level command args, not nested struct fields).
export async function savePayoutPolicy(
  watchOnlyId: number,
  draft: PayoutPolicyDraft
): Promise<PayoutPolicy> {
  return await invoke<PayoutPolicy>("save_payout_policy", { watchOnlyId, draft });
}

export async function getPayoutPolicy(watchOnlyId: number): Promise<PayoutPolicy | null> {
  return await invoke<PayoutPolicy | null>("get_payout_policy", { watchOnlyId });
}

export async function listPayoutPolicies(): Promise<PayoutPolicy[]> {
  return await invoke<PayoutPolicy[]>("list_payout_policies", {});
}

export async function removePayoutPolicy(watchOnlyId: number): Promise<void> {
  await invoke("remove_payout_policy", { watchOnlyId });
}

export async function getPayoutRuns(watchOnlyId: number): Promise<PayoutRun[]> {
  return await invoke<PayoutRun[]>("get_payout_runs", { watchOnlyId });
}

export async function previewPayout(watchOnlyId: number): Promise<PayoutPreview> {
  return await invoke<PayoutPreview>("preview_payout", { watchOnlyId });
}
