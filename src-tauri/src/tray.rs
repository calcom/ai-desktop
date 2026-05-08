use tauri::{
    image::Image,
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

use crate::commands::{show_or_create_window, WindowKind};
use crate::state::{AppState, DEFAULT_VOICE_KEY};
use crate::workflow::run_clipboard_oneshot;

const TRAY_ID: &str = "main-tray";

pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_menu(app)?;

    // Embed the monochrome template icon at compile time. macOS will render
    // it correctly in both light and dark menu bars because we mark it as
    // a template image below.
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .icon(icon)
        .icon_as_template(true)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = tray.app_handle();
            }
        })
        .build(app)?;

    Ok(())
}

pub fn rebuild_tray_menu<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "tray not found".to_string())?;
    let menu = build_menu(app).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    Ok(())
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    let snapshot = {
        let state = app.state::<AppState>();
        state.snapshot()
    };

    let voices_submenu = {
        let mut sub = SubmenuBuilder::new(app, "Voice");
        if snapshot.voices.is_empty() {
            sub = sub.item(
                &MenuItemBuilder::with_id("voice_none", "(No voices loaded)")
                    .enabled(false)
                    .build(app)?,
            );
        } else {
            let selected = if snapshot.selected_voice_key.is_empty() {
                DEFAULT_VOICE_KEY.to_string()
            } else {
                snapshot.selected_voice_key.clone()
            };
            for v in &snapshot.voices {
                let id = format!("voice:{}", v.key);
                // The canonical voice ships as "Cal.com Help Desk" (or
                // similar) but reads better in the menu as just "Default".
                let display = if v.key == "default" {
                    "Default"
                } else {
                    v.name.as_str()
                };
                let item = CheckMenuItemBuilder::with_id(id, display)
                    .checked(v.key == selected)
                    .build(app)?;
                sub = sub.item(&item);
            }
            sub = sub.separator().item(
                &MenuItemBuilder::with_id("refresh_voices", "Refresh voices").build(app)?,
            );
        }
        sub.build()?
    };

    let mut builder = MenuBuilder::new(app)
        .item(
            &MenuItemBuilder::with_id("open_composer", "Open composer  ⇧⌘R").build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("clipboard_reply", "Reply from clipboard  ⌥⌘R")
                .build(app)?,
        )
        .separator()
        .item(&voices_submenu)
        .separator()
        .item(&MenuItemBuilder::with_id("settings", "Settings…").build(app)?)
        .item(&MenuItemBuilder::with_id("check_for_updates", "Check for Updates…").build(app)?);

    if let Some(version) = snapshot.pending_update_version.as_deref() {
        builder = builder.item(
            &MenuItemBuilder::with_id(
                "restart_to_apply_update",
                format!("Restart to install v{version}"),
            )
            .build(app)?,
        );
    }

    let menu = builder
        .separator()
        .item(&MenuItemBuilder::with_id("quit", "Quit Cal.ai").build(app)?)
        .build()?;

    Ok(menu)
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "clipboard_reply" => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                run_clipboard_oneshot(app_handle).await;
            });
        }
        "open_composer" => {
            let _ = show_or_create_window(app, WindowKind::Composer);
        }
        "settings" => {
            let _ = show_or_create_window(app, WindowKind::Settings);
        }
        "check_for_updates" => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = crate::updater::check_now(app_handle).await;
            });
        }
        "restart_to_apply_update" => {
            app.restart();
        }
        "quit" => {
            app.exit(0);
        }
        "refresh_voices" => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = crate::commands::refresh_voices(app_handle).await;
            });
        }
        other if other.starts_with("voice:") => {
            let key = other.trim_start_matches("voice:").to_string();
            let app_handle = app.clone();
            let _ = crate::state::save_selected_voice(&app_handle, &key);
            let _ = rebuild_tray_menu(&app_handle);
            let _ = app_handle.emit("voice-changed", &key);
        }
        _ => {}
    }
}
