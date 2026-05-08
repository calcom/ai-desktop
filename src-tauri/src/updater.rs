use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

use crate::state::AppState;
use crate::tray;

/// Background check fired once on launch. Silent on no-update or failure;
/// downloads + stages the new bundle and notifies the user when an update
/// is available, surfacing a "Restart to install" item in the tray.
pub async fn check_on_launch<R: Runtime>(app: AppHandle<R>) {
    if let Err(err) = run_check(&app, /* notify_no_update */ false).await {
        // Network failures, manifest errors, etc. shouldn't bother the user
        // on every launch — log and move on.
        eprintln!("updater: launch check failed: {err}");
    }
}

/// Manual check via the tray menu. Notifies regardless of outcome so the
/// user gets feedback that something happened.
pub async fn check_now<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    run_check(&app, /* notify_no_update */ true)
        .await
        .map_err(|e| e.to_string())
}

async fn run_check<R: Runtime>(
    app: &AppHandle<R>,
    notify_no_update: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let updater = app.updater()?;
    let Some(update) = updater.check().await? else {
        if notify_no_update {
            let _ = app
                .notification()
                .builder()
                .title("Cal.ai")
                .body("You're on the latest version.")
                .show();
        }
        return Ok(());
    };

    let version = update.version.clone();
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await?;

    {
        let state = app.state::<AppState>();
        let mut inner = state.inner.lock().unwrap();
        inner.pending_update_version = Some(version.clone());
    }
    let _ = tray::rebuild_tray_menu(app);

    let _ = app
        .notification()
        .builder()
        .title(format!("Cal.ai {version} ready"))
        .body("Restart from the menu bar to install.")
        .show();

    Ok(())
}
