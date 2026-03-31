use serde::Deserialize;
use serde::Serialize;
#[cfg(feature = "gui")]
use tauri::Emitter;
#[cfg(all(feature = "gui", desktop))]
use tauri_plugin_dialog::DialogExt;
#[cfg(feature = "gui")]
use tracing::trace;

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

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg(feature = "gui")]
pub(crate) async fn update_info() -> Result<UpdateInfo, String> {
    let url = "https://api.github.com/repos/Neptune-Crypto/neptune-wallet-app/releases/latest";

    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .header("User-Agent", "NeptuneCrypto/NeptuneWallet")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    trace!("Response from update info on GitHub was: {}", resp.status());

    let resp = resp
        .json::<GitHubRelease>()
        .await
        .map_err(|e| e.to_string())?;
    trace!("Decoded response of release info");

    let update_info = UpdateInfo {
        // Return '3.0.0', not 'v3.0.0' as tag usually is.
        version: resp.tag_name.trim_start_matches('v').to_string(),
        url: resp.html_url,
    };

    Ok(update_info)
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
