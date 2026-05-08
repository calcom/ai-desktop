use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::StoreExt;

pub const STORE_FILE: &str = "settings.json";

pub const KEY_API_KEY: &str = "api_key";
pub const KEY_BASE_URL: &str = "base_url";
pub const KEY_SELECTED_VOICE: &str = "selected_voice_key";
pub const KEY_VOICES_CACHE: &str = "voices_cache";

pub const DEFAULT_BASE_URL: &str = "http://localhost:3000";
pub const DEFAULT_VOICE_KEY: &str = "default";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Voice {
    pub key: String,
    pub name: String,
    pub description: String,
}

#[derive(Default)]
pub struct AppState {
    pub inner: Mutex<AppStateInner>,
}

#[derive(Debug, Clone, Default)]
pub struct AppStateInner {
    pub api_key: Option<String>,
    pub base_url: String,
    pub selected_voice_key: String,
    pub voices: Vec<Voice>,
}

impl AppState {
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Self {
        let store = match app.store(STORE_FILE) {
            Ok(s) => s,
            Err(_) => {
                return Self {
                    inner: Mutex::new(AppStateInner {
                        api_key: None,
                        base_url: DEFAULT_BASE_URL.to_string(),
                        selected_voice_key: DEFAULT_VOICE_KEY.to_string(),
                        voices: Vec::new(),
                    }),
                };
            }
        };

        let api_key = store
            .get(KEY_API_KEY)
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .filter(|s| !s.is_empty());

        let base_url = store
            .get(KEY_BASE_URL)
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());

        let selected_voice_key = store
            .get(KEY_SELECTED_VOICE)
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_VOICE_KEY.to_string());

        let voices: Vec<Voice> = store
            .get(KEY_VOICES_CACHE)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        Self {
            inner: Mutex::new(AppStateInner {
                api_key,
                base_url,
                selected_voice_key,
                voices,
            }),
        }
    }

    pub fn snapshot(&self) -> AppStateInner {
        self.inner.lock().unwrap().clone()
    }
}

pub fn save_settings<R: Runtime>(
    app: &AppHandle<R>,
    api_key: Option<&str>,
    base_url: &str,
) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    match api_key {
        Some(k) if !k.is_empty() => store.set(KEY_API_KEY, serde_json::json!(k)),
        Some(_) => {
            store.delete(KEY_API_KEY);
        }
        None => {}
    }
    store.set(KEY_BASE_URL, serde_json::json!(base_url));
    store.save().map_err(|e| e.to_string())?;

    let state = app.state::<AppState>();
    let mut inner = state.inner.lock().unwrap();
    if let Some(k) = api_key {
        inner.api_key = if k.is_empty() { None } else { Some(k.to_string()) };
    }
    inner.base_url = base_url.to_string();
    Ok(())
}

pub fn save_selected_voice<R: Runtime>(app: &AppHandle<R>, voice_key: &str) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(KEY_SELECTED_VOICE, serde_json::json!(voice_key));
    store.save().map_err(|e| e.to_string())?;

    let state = app.state::<AppState>();
    let mut inner = state.inner.lock().unwrap();
    inner.selected_voice_key = voice_key.to_string();
    Ok(())
}

pub fn save_voices<R: Runtime>(app: &AppHandle<R>, voices: &[Voice]) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(KEY_VOICES_CACHE, serde_json::to_value(voices).unwrap_or_default());
    store.save().map_err(|e| e.to_string())?;

    let state = app.state::<AppState>();
    let mut inner = state.inner.lock().unwrap();
    inner.voices = voices.to_vec();
    Ok(())
}
