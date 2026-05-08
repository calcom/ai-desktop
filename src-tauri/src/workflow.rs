use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_notification::NotificationExt;

use crate::api::{ask_collect, ApiError};
use crate::state::AppState;
use crate::wrap::wrap_customer_message;

const APP_TITLE: &str = "Cal.ai";

pub fn notify<R: Runtime>(app: &AppHandle<R>, title: &str, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

pub async fn run_clipboard_oneshot<R: Runtime>(app: AppHandle<R>) {
    // 1. Read clipboard.
    let clipboard_text = match app.clipboard().read_text() {
        Ok(t) => t,
        Err(_) => {
            notify(&app, APP_TITLE, "Nothing to respond to (no text on clipboard).");
            return;
        }
    };
    if clipboard_text.trim().is_empty() {
        notify(&app, APP_TITLE, "Nothing to respond to (clipboard is empty).");
        return;
    }

    // 2. Snapshot settings.
    let snapshot = {
        let state = app.state::<AppState>();
        state.snapshot()
    };

    let Some(api_key) = snapshot.api_key else {
        notify(&app, APP_TITLE, "API key missing — open Settings to configure.");
        return;
    };

    let question = wrap_customer_message(&clipboard_text);

    // 3. Stream + buffer.
    let result = ask_collect(
        &snapshot.base_url,
        &api_key,
        &question,
        &snapshot.selected_voice_key,
    )
    .await;

    match result {
        Ok(reply) if reply.no_context => {
            // We picked: write the fallback so the user has something to paste.
            if app
                .clipboard()
                .write_text(reply.text.clone())
                .is_err()
            {
                notify(&app, APP_TITLE, "Could not write to clipboard.");
                return;
            }
            notify(
                &app,
                APP_TITLE,
                "No matching docs — wrote fallback to clipboard.",
            );
        }
        Ok(reply) => {
            if app.clipboard().write_text(reply.text).is_err() {
                notify(&app, APP_TITLE, "Could not write to clipboard.");
                return;
            }
            notify(&app, APP_TITLE, "Reply ready — paste into Slack/Gmail.");
        }
        Err(err) => {
            handle_error(&app, &snapshot.base_url, err);
        }
    }
}

fn handle_error<R: Runtime>(app: &AppHandle<R>, base_url: &str, err: ApiError) {
    let msg = err.user_message(base_url);
    notify(app, APP_TITLE, &msg);
}
