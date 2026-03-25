#[cfg(target_os = "windows")]
use os_info::Version::Semantic;

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg(feature = "gui")]
pub(crate) fn os_info() -> os_info::Info {
    os_info::get()
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg(feature = "gui")]
pub(crate) fn platform() -> String {
    std::env::consts::OS.to_string()
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg(feature = "gui")]
pub(crate) fn is_win11() -> bool {
    #[cfg(target_os = "windows")]
    {
        let info = os_info::get();

        if let Semantic(major, _minor, patch) = info.version() {
            if major < &10 {
                return false;
            }

            if patch < &20000 {
                return false;
            }
            return true;
        };
    }

    false
}
