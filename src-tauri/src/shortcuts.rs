use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::commands::{show_or_create_window, WindowKind};
use crate::state::AppState;
use crate::workflow::{notify, run_clipboard_oneshot};

pub const HOTKEY_REPLY: (Modifiers, Code) =
    (Modifiers::SUPER.union(Modifiers::ALT), Code::KeyR);
pub const HOTKEY_COMPOSER: (Modifiers, Code) =
    (Modifiers::SUPER.union(Modifiers::SHIFT), Code::KeyR);

pub fn register<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let reply_shortcut = Shortcut::new(Some(HOTKEY_REPLY.0), HOTKEY_REPLY.1);
    let composer_shortcut = Shortcut::new(Some(HOTKEY_COMPOSER.0), HOTKEY_COMPOSER.1);

    let gs = app.global_shortcut();

    if let Err(e) = gs.register(reply_shortcut) {
        notify(
            "Cal.ai",
            &format!(
                "Could not register Cmd+Option+R: {e}. Grant Accessibility in System Settings → Privacy & Security."
            ),
        );
    }

    if let Err(e) = gs.register(composer_shortcut) {
        notify(
            "Cal.ai",
            &format!(
                "Could not register Cmd+Shift+R: {e}. Another app may be using it."
            ),
        );
    }

    Ok(())
}

pub fn handle_shortcut<R: Runtime>(
    app: &AppHandle<R>,
    shortcut: &Shortcut,
    state: ShortcutState,
) {
    if state != ShortcutState::Pressed {
        return;
    }

    let reply = Shortcut::new(Some(HOTKEY_REPLY.0), HOTKEY_REPLY.1);
    let composer = Shortcut::new(Some(HOTKEY_COMPOSER.0), HOTKEY_COMPOSER.1);

    if shortcut == &reply {
        // Workflow 1: clipboard one-shot.
        let snapshot = {
            let state = app.state::<AppState>();
            state.snapshot()
        };
        if snapshot.api_key.is_none() {
            notify("Cal.ai", "API key missing — open Settings to configure.");
            let _ = show_or_create_window(app, WindowKind::Settings);
            return;
        }
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            run_clipboard_oneshot(app_clone).await;
        });
    } else if shortcut == &composer {
        // Workflow 2: spotlight composer.
        let _ = show_or_create_window(app, WindowKind::Composer);
    }
}
