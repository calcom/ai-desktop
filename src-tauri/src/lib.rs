mod api;
mod commands;
mod shortcuts;
mod state;
mod tray;
mod updater;
mod workflow;
mod wrap;

use tauri::Manager;

use crate::commands::{show_or_create_window, WindowKind};
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    shortcuts::handle_shortcut(app, shortcut, event.state);
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::validate_api_key,
            commands::refresh_voices,
            commands::set_selected_voice,
            commands::open_composer,
            commands::open_settings_window,
            commands::close_window,
            commands::quit_app,
            commands::check_for_updates,
            commands::restart_to_apply_update,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Initialize app state from persisted store.
            let app_state = AppState::load(app.handle());
            app.manage(app_state);

            // Build the menu-bar tray.
            tray::build_tray(app.handle())?;

            // Register global shortcuts. Registration failures (e.g. denied
            // accessibility permission) surface as notifications, not panics.
            let _ = shortcuts::register(app.handle());

            let snapshot = {
                let state = app.state::<AppState>();
                state.snapshot()
            };

            if snapshot.api_key.is_none() {
                // First run: open the settings window so the user can configure.
                let handle = app.handle().clone();
                let _ = show_or_create_window(&handle, WindowKind::Settings);
            } else {
                // Normal launch: refresh the cached voices in the background.
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = commands::refresh_voices(handle).await;
                });
            }

            // Background check for app updates. Silent on success/no-update;
            // notifies + adds a tray menu item if a new version was staged.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                updater::check_on_launch(handle).await;
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                // Don't quit when the last window closes; the tray stays alive.
                api.prevent_exit();
            }
        });
}
