// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![feature(new_range_api)]
#![feature(linked_list_retain)]

#[cfg(not(feature = "gui"))]
mod cli;
mod command;
mod config;
#[cfg(feature = "gui")]
mod gui;
mod logger;
mod os;
pub(crate) mod prover;
mod rpc;
pub(crate) mod rpc_client;
mod service;
#[cfg(feature = "gui")]
mod session_store;
pub(crate) mod wallet;

#[cfg(test)]
pub(crate) mod tests;

/// The maximum number of log lines shown
const MAX_NUM_LINES_IN_LOG: usize = 5_000;

#[cfg(feature = "gui")]
fn add_commands<R: tauri::Runtime>(invoke: tauri::ipc::Invoke<R>) -> bool {
    let handler: fn(tauri::ipc::Invoke<R>) -> bool = tauri::generate_handler![
        command::commands::add_wallet,
        command::commands::delete_cache,
        command::commands::export_wallet,
        command::commands::generate_snapshot_file,
        command::commands::get_disk_cache,
        command::commands::get_network,
        command::commands::get_remote_rest,
        command::commands::get_wallet_id,
        command::commands::get_wallets,
        command::commands::has_password,
        command::commands::input_password,
        command::commands::list_cache,
        command::commands::remove_wallet,
        command::commands::reset_to_height,
        command::commands::set_disk_cache,
        command::commands::set_network,
        command::commands::set_password,
        command::commands::set_remote_rest,
        command::commands::set_wallet_id,
        command::commands::snapshot_dir,
        command::commands::try_password,
        command::commands::wallet_address,
        rpc::commands::avaliable_utxos,
        rpc::commands::current_wallet_address,
        rpc::commands::forget_tx,
        rpc::commands::get_server_url,
        rpc::commands::get_tip_height,
        rpc::commands::history,
        rpc::commands::pending_transactions,
        rpc::commands::run_rpc_server,
        rpc::commands::send_to_address,
        rpc::commands::stop_rpc_server,
        rpc::commands::sync_state,
        rpc::commands::wallet_balance,
        os::is_win11,
        os::os_info,
        os::platform,
        logger::clear_logs,
        logger::get_log_level,
        logger::get_logs,
        logger::log,
        logger::set_log_level,
        session_store::command::add_contact_address_execute,
        session_store::command::delete_contact_address_execute,
        session_store::command::get_contact_list_execute,
        session_store::command::get_execution_history_execute,
        session_store::command::add_execution_history_execute,
        session_store::command::delete_execution_history_execute,
        session_store::command::session_store_del,
        session_store::command::session_store_get,
        session_store::command::session_store_set,
        service::app::get_build_info,
        service::app::update_info,
    ];

    (handler)(invoke)
}

#[cfg(feature = "gui")]
pub(crate) fn add_commands_middleware<R: tauri::Runtime>(
    app: tauri::Builder<R>,
) -> tauri::Builder<R> {
    app.invoke_handler(|invoke: tauri::ipc::Invoke<R>| {
        let cmd_name = invoke.message.command();

        let debug = std::env::var("DEBUG").is_ok();

        // `get_logs` is too noisy here. Just ignore it.
        if cmd_name != "get_logs" {
            if debug {
                println!("Executing command: '{cmd_name}'");
                tracing::info!("Executing command: '{cmd_name}'");
            } else {
                tracing::debug!("Executing command: '{cmd_name}'");
            }
        }

        add_commands(invoke)
    })
}

pub fn run() {
    #[cfg(feature = "gui")]
    gui::run();
    #[cfg(not(feature = "gui"))]
    {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            crate::logger::setup_logger(None, MAX_NUM_LINES_IN_LOG).unwrap();
            cli::run().await;
        })
    }
}
