import { Contact } from "@/database/types/contact";
import { invoke } from "@tauri-apps/api/core";

export async function run_rpc_server() {
  await invoke("run_rpc_server", {});
}

export async function add_contact_address_execute(params: (string | number)[]): Promise<boolean> {
  return await invoke("add_contact_address_execute", { params });
}

export async function delete_contact_address_execute(
  params: (string | number)[]
): Promise<boolean> {
  return await invoke("delete_contact_address_execute", { params });
}

export async function get_contact_list_execute(): Promise<Contact[]> {
  return await invoke("get_contact_list_execute");
}

export async function get_execution_history_execute(
  params: (string | number)[]
): Promise<Contact[]> {
  return await invoke("get_execution_history_execute", { params });
}

export async function add_execution_history_execute(
  params: (string | number)[]
): Promise<Contact[]> {
  return await invoke("add_execution_history_execute", { params });
}

export async function delete_execution_history_execute(
  params: (string | number)[]
): Promise<Contact[]> {
  return await invoke("delete_execution_history_execute", { params });
}

export async function snapshot_dir(): Promise<string> {
  return await invoke("snapshot_dir", {});
}

export async function stop_rpc_server() {
  await invoke("stop_rpc_server", {});
}

export async function get_server_url(): Promise<string> {
  return await invoke("get_server_url", {});
}

export interface BuildInfo {
  time: string;
  commit: string;
}
export interface UpdateInfo {
  version: string;
  url: string;
}

export async function get_build_info(): Promise<BuildInfo> {
  return await invoke("get_build_info", {});
}

export async function get_update_info(): Promise<UpdateInfo> {
  return await invoke("update_info", {});
}
