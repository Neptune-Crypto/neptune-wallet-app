use serde::Deserialize;
use serde::Serialize;
#[cfg(feature = "gui")]
use tauri::Emitter;
#[cfg(all(feature = "gui", desktop))]
use tauri_plugin_dialog::DialogExt;

#[cfg(feature = "gui")]
#[derive(Debug, Serialize)]
pub(crate) struct BuildInfo {
    pub(crate) time: String,
    pub(crate) commit: String,
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg(feature = "gui")]
pub(crate) fn get_build_info() -> BuildInfo {
    let commit = env!("git_commit").to_string();
    let time = env!("build_time").to_string();

    BuildInfo { time, commit }
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct UpdateInfo {
    pub(crate) version: String,
    pub(crate) url: String,
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg(feature = "gui")]
pub(crate) async fn update_info() -> Result<UpdateInfo, String> {
    let resp = reqwest::get(
        "https://raw.githubusercontent.com/VxBlocks/vxb_neptune_wallet/refs/heads/main/update.json",
    )
    .await
    .map_err(|e| e.to_string())?
    .json::<UpdateInfo>()
    .await
    .map_err(|e| e.to_string())?;

    Ok(resp)
}

#[cfg(all(feature = "gui", desktop))]
pub(crate) fn error_dialog(app: &tauri::AppHandle, message: &str) {
    use tauri_plugin_dialog::MessageDialogButtons;

    app.dialog()
        .message(message)
        .title("error")
        .buttons(MessageDialogButtons::Ok)
        .blocking_show();
    std::process::exit(1)
}

#[cfg(feature = "gui")]
pub(crate) fn emit_event_to<I, S>(target: I, event: &str, payload: S) -> anyhow::Result<()>
where
    I: Into<tauri::EventTarget>,
    S: Serialize + Clone,
{
    let app = crate::service::get_state::<tauri::AppHandle>();
    let _ = app.emit_to(target, event, payload);
    Ok(())
}

#[cfg(not(feature = "gui"))]
pub(crate) fn emit_event_to<I, S>(_target: I, _event: &str, _payload: S) -> anyhow::Result<()> {
    Ok(())
}
