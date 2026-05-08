# Cal.ai

A small macOS menu-bar app that turns customer messages on your clipboard into doc-grounded replies, without leaving Slack or Gmail.

It's a thin desktop client over a RAG backend that does the actual retrieval and generation against the Cal.com Help Desk docs. This repo is the **client only** — production uses `https://api.cal.ai`, and the local backend lives at `~/Development/ai/`.

## What it does

Two hotkey-driven workflows.

### Clipboard one-shot — `⌘⌥R`

You're reading a customer message in Slack or Gmail.

1. Select the message, hit `⌘C`.
2. Press `⌘⌥R`. A "Composing a reply…" notification appears.
3. ~2 seconds later: "Reply ready — paste into Slack/Gmail."
4. `⌘V` in your reply box.

You never see a window. The reply is grounded in the actual docs and styled in the voice you've selected from the menu bar.

### Spotlight composer — `⌘⇧R`

For when you want to edit before sending. A 720-wide always-on-top window opens, pre-filled with your clipboard. Type or paste a message, hit `⌘↵` to generate, watch the reply stream in, see citations to the source docs, and `⌘⇧C` to copy. `Esc` closes it. Hitting `⌘⇧R` again toggles it closed.

The window is auto-sized — it starts compact (just an input + footer) and grows as content appears, like Spotlight or Raycast.

### Menu bar

A monochrome glyph in the menu bar exposes:

- **Voice** submenu — pick the writer persona used by both workflows.
- **Open composer** — same as `⌘⇧R`.
- **Settings…** — API key + backend base URL.
- **Quit**.

## First run

Default base URL is `https://api.cal.ai`. For local development, run the backend from `~/Development/ai/` and point settings at your local URL.

On first launch with no API key configured, Cal.ai opens its Settings window and blocks until you fill it in:

- **Backend base URL** (default `https://api.cal.ai`)
- **API key** — issued by the backend (`bun run keys:create -- --name "Cal.ai" --scopes ask,voices:read --rate-limit 60` over there)

The key is validated against `GET /me` before it's saved. If the backend is unreachable or the key is invalid / missing required scopes, you'll see an inline error and saving is blocked.

## Installing

After building (see below), drag `Cal.ai.app` to **`/Applications`**. This matters: macOS Launch Services only fully indexes apps in standard locations, and notifications won't show your app icon until it's registered. If you want to keep iterating from `target/release/bundle/macos/`, register the bundle manually:

```sh
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister \
  -f path/to/Cal.ai.app
```

The first time you press `⌘⌥R` or `⌘⇧R`, macOS will prompt for **Accessibility permission** (System Settings → Privacy & Security). Cal.ai requests **Notifications permission** on launch so workflow status notifications are ready before you use the shortcuts. Both are required.

## Stack

- [Tauri 2](https://v2.tauri.app/) (Rust shell, macOS-first; Windows/Linux later)
- [Bun](https://bun.com) as package manager + Vite runner
- React 19 + TypeScript
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- Vite

## Building from source

Prerequisites: Bun, Rust toolchain (stable), Xcode Command Line Tools.

```sh
bun install
bun run tauri dev          # vite + Tauri shell, hot reload
bun run tauri build        # release .app at src-tauri/target/release/bundle/macos/
```

Other useful commands:

```sh
bun run build              # tsc + vite build only (no Rust)
cd src-tauri && cargo check
cd src-tauri && cargo clippy --no-deps
bun run tauri icon path/to/source.png   # regenerate bundle icons from a 1024×1024 PNG
```

## Configuration & persistence

Settings are written to `tauri-plugin-store`'s `settings.json` in the macOS app config dir:

- `api_key`
- `base_url`
- `selected_voice_key`
- `voices_cache` (the last successful `/voices` response so the menu bar still works briefly without network)

> The API key is currently **stored in plaintext on disk**. Migrate to the Keychain before sharing this app with anyone else. (See [`AGENTS.md`](./AGENTS.md) TODOs.)

To change settings later: menu-bar icon → Settings…

## Hotkeys

| Shortcut | Where | Action |
|---|---|---|
| `⌘⌥R` | global | Clipboard one-shot reply |
| `⌘⇧R` | global | Toggle composer window |
| `⌘↵` | composer | Generate |
| `⌘⇧C` | composer | Copy reply (after completion) |
| `Esc` | composer | Close window |

If a global shortcut collides with another app, you'll see a notification on launch and the conflicting hotkey won't be registered. There's no in-app remap UI yet — change it in `src-tauri/src/shortcuts.rs::HOTKEY_*` and rebuild.

## Architecture (one-paragraph version)

`tauri.conf.json` declares no startup windows; the menu-bar tray is the only persistent UI. The composer and settings windows are created lazily by Rust commands and routed in React by window label. Workflow 1 (clipboard one-shot) runs **entirely in Rust** — no window involved — using `reqwest` for the SSE stream and Tauri's clipboard + notification plugins for I/O. Workflow 2 (composer) runs in a webview and routes its `/ask` SSE through a Rust command that emits stream events back to React. Settings and the voice list are stored canonically by Rust in `tauri-plugin-store` and mirrored in an in-memory `AppState` for fast tray reads.

For the full picture — module-by-module rundown, conventions for adding commands and permissions, and the list of macOS-specific gotchas we hit while building this — read [`AGENTS.md`](./AGENTS.md).

## Status

Personal-tool quality. Works on the maintainer's machine; the API-key-in-plaintext caveat means it's not ready to hand to a teammate yet.
