# AGENTS.md

A guide for AI agents (and humans) working in this repo. Read end-to-end before making changes.

## What this is

A macOS menu-bar app that turns customer messages on the clipboard into doc-grounded replies, without leaving Slack/Gmail. It's a thin desktop client over a separate RAG backend (`~/Development/ai/`) that does retrieval + generation against the Cal.com Help Desk docs.

Two hotkey-driven workflows:

- **Clipboard one-shot — ⌘⌥R.** Read clipboard → call `/ask` → buffer the streamed reply → write it back to the clipboard → notification. No window. ~2s round-trip.
- **Spotlight composer — ⌘⇧R.** Always-on-top, frameless, auto-sizing window pre-filled from clipboard. Edit, Generate (⌘↵), watch the stream, see citations, Copy (⌘⇧C). Toggles closed if already open.

Plus a menu-bar tray with a voice picker, "Open composer", "Settings…", and Quit.

## Stack

- **Tauri 2** (Rust shell, macOS-first; Windows/Linux later)
- **Bun** as package manager + Vite runner
- **React 19** + **TypeScript** for UI
- **Tailwind CSS v4** via `@tailwindcss/vite` (no `tailwind.config.js` needed; theme tokens live in `src/index.css` under `@theme`)
- **Vite** as the bundler

### Tauri plugins

Both Rust and JS sides are listed; versions track v2.

| Purpose | Rust crate | JS package |
|---|---|---|
| Global hotkeys | `tauri-plugin-global-shortcut` | `@tauri-apps/plugin-global-shortcut` |
| Read/write clipboard | `tauri-plugin-clipboard-manager` | `@tauri-apps/plugin-clipboard-manager` |
| Persistent KV store | `tauri-plugin-store` | `@tauri-apps/plugin-store` |
| System notifications | `tauri-plugin-notification` | `@tauri-apps/plugin-notification` |
| HTTP from JS bypassing CORS | `tauri-plugin-http` | `@tauri-apps/plugin-http` |
| Open URLs (default scaffold) | `tauri-plugin-opener` | `@tauri-apps/plugin-opener` |

Tray uses Tauri's built-in tray API (`tauri-plugin-*` not needed) with the `tray-icon` cargo feature on the `tauri` crate.

## Project layout

```
cal.ai/
├── AGENTS.md                  # this file (CLAUDE.md is a symlink → AGENTS.md)
├── index.html                 # single Vite entry point
├── package.json
├── vite.config.ts             # registers @tailwindcss/vite + react
├── tsconfig.json
├── public/                    # static assets served by Vite
├── src/
│   ├── main.tsx               # React root
│   ├── App.tsx                # routes by window label (composer | settings)
│   ├── index.css              # Tailwind v4 import + @theme tokens + globals
│   ├── windows/
│   │   ├── Composer.tsx       # workflow 2 UI (Spotlight-style)
│   │   └── Settings.tsx       # API key + base URL config
│   ├── hooks/
│   │   ├── useAskStream.ts    # SSE streaming state machine
│   │   └── useSettings.ts     # load + reload settings on voice/focus events
│   └── lib/
│       ├── tauri.ts           # invoke() typed wrappers
│       ├── api.ts             # POST /ask SSE consumer (via plugin-http)
│       ├── errors.ts          # error.code → friendly text
│       ├── wrap.ts            # customer-message → /ask question wrapper (mirror of wrap.rs)
│       └── voiceTheme.ts      # voiceColor(key) hash; voiceDisplayName(voice)
├── src-tauri/
│   ├── Cargo.toml             # tauri features + plugin crates
│   ├── tauri.conf.json        # bundle, build hooks, security, app.windows = []
│   ├── build.rs
│   ├── icons/                 # bundle icons + tray.png (22×22 template image)
│   ├── capabilities/
│   │   └── default.json       # plugin permissions + URL allowlist for http
│   └── src/
│       ├── main.rs            # entry → calai_lib::run()
│       ├── lib.rs             # plugin registration, setup, RunEvent::ExitRequested guard
│       ├── state.rs           # AppState (Mutex<inner>) + store I/O helpers
│       ├── api.rs             # reqwest /me, /voices, /ask SSE for workflow 1
│       ├── workflow.rs        # clipboard one-shot orchestration
│       ├── commands.rs        # #[tauri::command] handlers callable from JS
│       ├── tray.rs            # menu-bar icon + dynamic voice submenu
│       ├── shortcuts.rs       # global hotkey registration + dispatch
│       └── wrap.rs            # mirror of src/lib/wrap.ts
└── dist/                      # vite build output (gitignored)
```

## Backend dependency

Lives separately at `~/Development/ai/` (Bun + Hono RAG service). **Default base URL: `http://localhost:3000`.** See `~/Development/ai/AGENTS.md` for backend internals; the surface this app uses:

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | — | DB ping. |
| GET | `/me` | api key | Returns `{name, scopes, rate_limit_per_minute}`. Used to validate API key on Save. |
| GET | `/voices` | api key + `voices:read` | `{voices: [{key, name, description}]}`. Cached in store. |
| POST | `/ask` | api key + `ask` | **`text/event-stream`**. Body: `{question, voice?, top_k?}`. |

Auth header: `Authorization: Bearer cal_<32 url-safe chars>`.

### `/ask` SSE shape

Three streaming patterns:

- **OK**: stream of unnamed `data: <delta>` events, terminated by:
  ```
  event: citations
  data: [{"slug":"...","headingPath":[...]}]
  ```
- **No-context**: single `data: I don't have information about that in the Cal.com docs.` then `event: citations\ndata: []`. Surfaces as `noContext: true`.
- **Stream error**: `event: error\ndata: {"message":"..."}`. No citations.

Auth/scope/validation/rate-limit failures **don't** open the SSE stream — they return JSON in the unified envelope:

```json
{ "error": { "code": "<snake_case>", "message": "<human>", "required_scope": "...", "retry_after_seconds": 30 } }
```

Mapped to friendly text in both `src/lib/errors.ts` and `src-tauri/src/api.rs::ApiError::user_message`.

### Customer-message wrapper

The backend prompt is built around answering questions, not composing replies. Wrap clipboard text client-side before POSTing. Single source of truth in **two places** (must stay in sync):

- `src-tauri/src/wrap.rs::wrap_customer_message`
- `src/lib/wrap.ts::wrapCustomerMessage`

Template: `Compose a reply to this customer message, drawing only on Cal.com Help Desk documentation:\n\n<message>`. Truncates the message at 1800 chars (template + body must fit `/ask`'s 2000-char `question` limit).

## Run / build

```sh
bun install
bun run dev                  # vite dev server only
bun run tauri dev            # vite + Tauri shell (full app, hot reload)
bun run tauri build          # release .app bundle in src-tauri/target/release/bundle/macos/
bun run build                # tsc + vite build, no Rust
cargo check                  # in src-tauri/, fastest Rust feedback
cargo clippy --no-deps       # lints
```

Build target is `app` only (no DMG). Change `bundle.targets` in `tauri.conf.json` if you want a DMG.

After regenerating bundle icons (`bun run tauri icon path/to/source.png`), re-run `tauri build` — the `.icns` and PNG variants change and need a fresh build.

## Architecture

### Window model

`tauri.conf.json` declares **no startup windows** (`app.windows: []`). Windows are created lazily by Rust commands via `WebviewWindowBuilder`. Two labels:

- `composer` — frameless, transparent, always-on-top, no decorations, native shadow on, resizable: true (required for programmatic setSize on macOS — there are no drag handles anyway).
- `settings` — standard decorated window, resizable: true, opens on first run if no API key is configured.

The same `index.html` serves both. `App.tsx` routes by `getCurrentWebviewWindow().label`.

When a window is closed, it's **hidden, not destroyed** — the React tree persists. To force a fresh state on reopen, Rust emits a side-channel event (`composer-prefill`, `settings-opened`) when re-showing an existing window, and the corresponding React component listens and resets state.

### Rust ↔ JS split

| Concern | Lives in |
|---|---|
| Tray icon, menu, voice submenu | Rust (`tray.rs`) |
| Global hotkeys + dispatch | Rust (`shortcuts.rs`) |
| Workflow 1 (clipboard one-shot) | **Entirely Rust** (`workflow.rs`) — no window involved |
| Workflow 2 (composer) | JS (`Composer.tsx` + `useAskStream`) |
| Persisted settings | Rust owns the canonical view (`state.rs` + `tauri-plugin-store`); JS reads via `get_settings` command |
| `/me` validation, `/voices` fetch | Rust (`api.rs`) — easier to share between tray and settings |
| `/ask` SSE for composer | JS (`api.ts`) — needs incremental UI updates |
| `/ask` SSE for clipboard one-shot | Rust (`api.rs::ask_collect`) — buffered, no UI |

Both SSE parsers are intentionally hand-rolled; no `EventSource` (it doesn't support POST).

### Activation policy

`#[cfg(target_os = "macos")] app.set_activation_policy(tauri::ActivationPolicy::Accessory);` — hides dock icon. Tray-only app.

### Run loop

```rust
.run(|_app, event| {
    if let tauri::RunEvent::ExitRequested { api, .. } = event {
        api.prevent_exit();   // last window closing must NOT quit the app
    }
});
```

Quit flows through the tray menu's "Quit" item → `app.exit(0)`.

### Settings store

`tauri-plugin-store` writes to `settings.json` in the app config dir. Keys:

- `api_key` (string)
- `base_url` (string, default `http://localhost:3000`)
- `selected_voice_key` (string, default `"default"`)
- `voices_cache` (last successful `/voices` response — small JSON)

`AppState` mirrors these in memory under a `Mutex` so commands and tray callbacks have a fast read path. Writes go through helpers in `state.rs` that update both the store and the in-memory copy.

### Voice picker

The active voice is shared between tray + composer. When changed (tray menu click or composer footer), Rust:
1. Persists `selected_voice_key`.
2. Rebuilds the tray menu (so the check mark moves).
3. Emits `voice-changed` so the composer's `useSettings` hook reloads.

## Conventions

### Adding a Tauri command

1. Add `#[tauri::command] pub fn|async fn ...` in `commands.rs`.
2. Register it in `lib.rs` inside `tauri::generate_handler![...]`.
3. Call from JS via `invoke<T>("snake_case_name", { ... })` — wrap in `src/lib/tauri.ts` so callers get types.

Tauri auto-converts argument names from `snake_case` (Rust) to `camelCase` (JS) **only** if the field implements Tauri's case mapping. We pass complex args under a single `args` field with `#[derive(Deserialize)]` to keep it explicit.

### Adding a permission

`src-tauri/capabilities/default.json` is the authoritative list. Important: **`core:window:default` only includes read operations.** Write operations (set_size, set_position, etc.) require explicit `core:window:allow-set-*` permissions. Same pattern for other plugins.

For `tauri-plugin-http`, allowed URLs are scoped:

```json
{
  "identifier": "http:default",
  "allow": [
    { "url": "http://localhost:*" },
    { "url": "http://127.0.0.1:*" }
  ]
}
```

If the user changes their backend URL to something outside this list, the request will fail with a Tauri permission error (not a network error). Either widen the allowlist or accept localhost-only.

### Wrap helper duplication

`src-tauri/src/wrap.rs` and `src/lib/wrap.ts` must produce identical strings for the same input. Keep them in sync; both have header comments noting the mirror.

### Voice theming

Use `voiceColor(key)` from `src/lib/voiceTheme.ts` for any per-voice accent (composer indicator, footer dot, streaming caret, textarea caret). Function is deterministic — same key always returns the same OKLCH hue. The "default" voice's display name is overridden to `"Default"` in both `voiceDisplayName()` (JS) and `tray.rs` (Rust).

### Error UX

Surface `error.code` through the friendly mappers, not raw messages. Both error mappers cover the same set of codes:

- `missing_api_key` / `invalid_api_key` → "API key missing or invalid — update in Settings."
- `forbidden` → "API key is missing the `{required_scope}` scope."
- `rate_limited` → "Hit the per-minute limit — try again in {retry_after_seconds}s."
- `voices_not_configured` → "Backend has no voices configured."
- network/`fetch` errors → "Backend offline at {base_url}."

Don't log API keys or full clipboard contents in release builds.

## Gotchas (the painful ones — read these)

1. **Transparent windows on macOS need a Cargo feature.** `tauri = { features = ["macos-private-api"] }` plus `app.macOSPrivateApi: true` in `tauri.conf.json`. Without these, `transparent(true)` on `WebviewWindowBuilder` won't compile (Tauri's build.rs validates the allowlist).

2. **`core:window:default` doesn't include `set_size`.** Programmatic `webviewWindow.setSize(...)` from JS silently no-ops without `core:window:allow-set-size` in capabilities. We hit this on the auto-sizing composer; the ResizeObserver was firing correctly, the IPC was just being denied.

3. **`resizable: false` on macOS blocks programmatic resize.** Setting `resizable: false` on `WebviewWindowBuilder` strips the `.resizable` style mask from the `NSWindow`, which makes AppKit reject `setSize`. We keep `resizable: true` and rely on `decorations: false` to remove drag handles instead.

4. **`field-sizing: content` is unreliable in WKWebView.** The composer's textarea uses manual JS auto-grow (`el.style.height = "auto"; el.style.height = scrollHeight + "px"`) inside a `useLayoutEffect` so the height is finalized before paint. The shell's ResizeObserver picks up the parent change and resizes the window.

5. **Backend has no CORS.** Fetching from a webview origin (`tauri://localhost` in prod, `http://localhost:1420` in dev) to `http://localhost:3000` is blocked by browser CORS — and a `TypeError` from a CORS preflight is indistinguishable from a real network error. **All `/ask` calls from JS go through `@tauri-apps/plugin-http`**, which routes the request through Rust (reqwest under the hood) and returns a real streaming `Response`. Don't switch to native `fetch` for backend calls.

6. **NSUserNotification picks up the bundle icon via Launch Services.** When the app is launched straight out of `target/release/bundle/macos/`, Launch Services may not have indexed the bundle and the notification icon falls back to a generic placeholder. Fix: move `Cal.ai.app` to `/Applications`, or run `lsregister -f path/to/Cal.ai.app`. The notification plugin uses the deprecated `NSUserNotification` (via `notify-rust` → `mac-notification-sys`); switching to `UNUserNotification` would fix this upstream but isn't supported by the plugin yet.

7. **Tray icon must be a template image on macOS.** `src-tauri/icons/tray.png` is a 22×22 PNG with pure black + alpha (no color). `TrayIconBuilder::icon_as_template(true)` makes macOS auto-invert it for dark menu bars. The colored `default_window_icon` rendered as a black square in template mode — that's why we embed `tray.png` explicitly via `Image::from_bytes(include_bytes!("../icons/tray.png"))`.

8. **Tauri's `tauri icon` CLI overwrites only known icon files.** It regenerates `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`, the Windows tile assets, and the iOS/Android icon sets — but it leaves `tray.png` alone because it's not in its name list. Safe to run repeatedly.

9. **Wrapped composer state must be reset on reopen.** Composer + Settings windows are hidden, not destroyed. Rust emits `composer-prefill` (always — payload is the current clipboard) and `settings-opened` (no payload) when re-showing; the React side resets stream state, copy state, and reloads settings/saveState from the store on those events. Without this, you'd see stale "Saved. Closing…" messages or stale stream output.

10. **Auto-sized composer math.** ResizeObserver `contentRect.height` excludes border; use `entry.borderBoxSize[0].blockSize` instead, then add a small buffer (+4px) before passing to `setSize` so hi-dpi rounding doesn't shave off the bottom rounded corner. Single-source the resize logic — both the ResizeObserver callback and the `useLayoutEffect` after each render call into the same `applyHeight` (rAF-debounced).

11. **macOS native window shadow follows the alpha mask of transparent windows.** That's why we use `.shadow(true)` + `transparent(true)` and removed the CSS `box-shadow` — the CSS shadow rendered outside the rounded card and got clipped at the window edge. Native shadow traces the rounded corners cleanly.

## Security notes

- API key is currently stored **plaintext** via `tauri-plugin-store`. Settings UI flags this with a TODO. **Migrate to macOS Keychain (`tauri-plugin-stronghold` or a thin `keyring-rs` wrapper) before sharing the app with anyone else.**
- Don't widen `http:default` `allow` URL list to `http://**` without thinking — that lets any compromised webview content hit any HTTP server.
- `tauri.conf.json` `app.security.csp` is currently `null`. For a release build with remote content, set a real CSP.

## Acceptance recap (from the original brief)

These should all hold; if you're modifying anything in this list, verify it after.

- Fresh launch with no settings → settings window prompts for API key + base URL, validates against `/me`, blocks until both pass.
- Menu-bar icon visible; opening it shows voice dropdown + Open composer + Settings + Quit.
- Voice change in dropdown takes effect immediately for both workflows.
- ⌘⌥R with non-empty clipboard → clipboard reply + notification within ~3s.
- ⌘⇧R opens centered always-on-top window pre-filled with clipboard contents; ⌘↵ streams; ⌘⇧C copies after completion.
- Citations appear in composer after a successful stream.
- Backend offline / 401 / 403 / 429 / SSE `event: error` are all surfaced with actionable messages.
- App restart preserves API key, base URL, and selected voice.
- Voices cache so the menu bar works briefly without network.
- `bun run tauri build` produces a working `.app`.

## TODOs

- [ ] Move API key to Keychain.
- [ ] Switch notifications from `NSUserNotification` to `UNUserNotification` (upstream — file an issue against `tauri-plugin-notification`).
- [ ] Composer voice picker is currently a click-to-cycle button; replace with a popover for >3 voices.
- [ ] Honour `Retry-After` from `429` responses in the composer (currently just shown in the message).
- [ ] Optionally add a Refresh-on-focus interval for `/voices` (currently only refreshes on launch + after Settings save + tray menu).
- [ ] Make the composer's "close on blur" behaviour configurable via Settings.
