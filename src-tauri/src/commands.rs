use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

use crate::api;
use crate::state::{
    save_selected_voice, save_settings as persist_settings, save_voices, AppState, Voice,
    DEFAULT_BASE_URL, DEFAULT_VOICE_KEY,
};
use crate::tray;

#[derive(Serialize)]
pub struct Settings {
    api_key: Option<String>,
    base_url: String,
    selected_voice_key: String,
    voices: Vec<Voice>,
    has_api_key: bool,
}

#[tauri::command]
pub fn get_settings<R: Runtime>(app: AppHandle<R>) -> Settings {
    let state = app.state::<AppState>();
    let inner = state.inner.lock().unwrap();
    Settings {
        api_key: inner.api_key.clone(),
        base_url: if inner.base_url.is_empty() {
            DEFAULT_BASE_URL.to_string()
        } else {
            inner.base_url.clone()
        },
        selected_voice_key: if inner.selected_voice_key.is_empty() {
            DEFAULT_VOICE_KEY.to_string()
        } else {
            inner.selected_voice_key.clone()
        },
        voices: inner.voices.clone(),
        has_api_key: inner.api_key.as_deref().map(|s| !s.is_empty()).unwrap_or(false),
    }
}

#[derive(Deserialize)]
pub struct SaveSettingsArgs {
    pub api_key: String,
    pub base_url: String,
}

#[tauri::command]
pub fn save_settings<R: Runtime>(app: AppHandle<R>, args: SaveSettingsArgs) -> Result<(), String> {
    persist_settings(&app, Some(&args.api_key), &args.base_url)?;
    Ok(())
}

#[derive(Serialize)]
pub struct ValidateResult {
    ok: bool,
    name: Option<String>,
    scopes: Vec<String>,
    rate_limit_per_minute: Option<u32>,
    error_code: Option<String>,
    error_message: Option<String>,
    required_scope: Option<String>,
    missing_scopes: Vec<String>,
}

#[derive(Deserialize)]
pub struct ValidateArgs {
    pub api_key: String,
    pub base_url: String,
}

#[tauri::command]
pub async fn validate_api_key(args: ValidateArgs) -> ValidateResult {
    match api::fetch_me(&args.base_url, &args.api_key).await {
        Ok(me) => {
            let required = ["ask", "voices:read"];
            let missing: Vec<String> = required
                .iter()
                .filter(|s| !me.scopes.iter().any(|x| x == *s))
                .map(|s| s.to_string())
                .collect();
            ValidateResult {
                ok: missing.is_empty(),
                name: Some(me.name),
                scopes: me.scopes,
                rate_limit_per_minute: me.rate_limit_per_minute,
                error_code: None,
                error_message: None,
                required_scope: None,
                missing_scopes: missing,
            }
        }
        Err(err) => ValidateResult {
            ok: false,
            name: None,
            scopes: Vec::new(),
            rate_limit_per_minute: None,
            error_code: Some(err.code.clone()),
            error_message: Some(err.user_message(&args.base_url)),
            required_scope: err.required_scope.clone(),
            missing_scopes: Vec::new(),
        },
    }
}

#[tauri::command]
pub async fn refresh_voices<R: Runtime>(app: AppHandle<R>) -> Result<Vec<Voice>, String> {
    let snapshot = {
        let state = app.state::<AppState>();
        state.snapshot()
    };
    let Some(api_key) = snapshot.api_key else {
        return Err("API key not set".into());
    };
    match api::fetch_voices(&snapshot.base_url, &api_key).await {
        Ok(voices) => {
            save_voices(&app, &voices)?;
            tray::rebuild_tray_menu(&app)?;
            Ok(voices)
        }
        Err(err) => Err(err.user_message(&snapshot.base_url)),
    }
}

#[tauri::command]
pub fn set_selected_voice<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    save_selected_voice(&app, &key)?;
    tray::rebuild_tray_menu(&app)?;
    let _ = app.emit("voice-changed", &key);
    Ok(())
}

#[tauri::command]
pub fn open_composer<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    show_or_create_window(&app, WindowKind::Composer)
}

#[tauri::command]
pub fn open_settings_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    show_or_create_window(&app, WindowKind::Settings)
}

#[tauri::command]
pub fn close_window<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&label) {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app<R: Runtime>(app: AppHandle<R>) {
    app.exit(0);
}

#[derive(Clone, Copy)]
pub enum WindowKind {
    Composer,
    Settings,
}

pub fn show_or_create_window<R: Runtime>(app: &AppHandle<R>, kind: WindowKind) -> Result<(), String> {
    let label = match kind {
        WindowKind::Composer => "composer",
        WindowKind::Settings => "settings",
    };

    if let Some(window) = app.get_webview_window(label) {
        // Toggle behavior for composer: if visible+focused, hide it.
        if matches!(kind, WindowKind::Composer) {
            let visible = window.is_visible().unwrap_or(false);
            let focused = window.is_focused().unwrap_or(false);
            if visible && focused {
                window.hide().map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        match kind {
            WindowKind::Composer => emit_clipboard_to_composer(app),
            WindowKind::Settings => {
                let _ = app.emit("settings-opened", ());
            }
        }
        return Ok(());
    }

    let url = WebviewUrl::App(format!("index.html?w={label}").into());
    let mut builder = WebviewWindowBuilder::new(app, label, url)
        .title(match kind {
            WindowKind::Composer => "Cal.ai Composer",
            WindowKind::Settings => "Cal.ai Settings",
        })
        .resizable(matches!(kind, WindowKind::Settings))
        .focused(true)
        .visible(true)
        .center();

    builder = match kind {
        WindowKind::Composer => builder
            .inner_size(640.0, 480.0)
            .min_inner_size(560.0, 420.0)
            .always_on_top(true)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .skip_taskbar(true),
        WindowKind::Settings => builder
            .inner_size(560.0, 480.0)
            .min_inner_size(520.0, 460.0)
            .always_on_top(false)
            .decorations(true),
    };

    let window = builder.build().map_err(|e| e.to_string())?;

    if matches!(kind, WindowKind::Composer) {
        let app_handle = app.clone();
        // Hide on blur (default close-on-blur behavior, configurable later).
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                if let Some(w) = app_handle.get_webview_window("composer") {
                    let _ = w.hide();
                }
            }
        });
        emit_clipboard_to_composer(app);
    }

    Ok(())
}

fn emit_clipboard_to_composer<R: Runtime>(app: &AppHandle<R>) {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    if let Ok(text) = app.clipboard().read_text() {
        let _ = app.emit("composer-prefill", text);
    }
}
