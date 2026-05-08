import { invoke } from "@tauri-apps/api/core";

export type Voice = {
  key: string;
  name: string;
  description: string;
};

export type Settings = {
  api_key: string | null;
  base_url: string;
  selected_voice_key: string;
  voices: Voice[];
  has_api_key: boolean;
};

export type ValidateResult = {
  ok: boolean;
  name: string | null;
  scopes: string[];
  rate_limit_per_minute: number | null;
  error_code: string | null;
  error_message: string | null;
  required_scope: string | null;
  missing_scopes: string[];
};

export type AskStreamCommandArgs = {
  request_id: string;
  base_url: string;
  api_key: string;
  question: string;
  voice: string;
  top_k?: number;
};

export type AskStreamCommandResult = {
  text: string;
  citations: {
    slug: string;
    headingPath: string[];
  }[];
  no_context: boolean;
};

export const tauri = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (api_key: string, base_url: string) =>
    invoke<void>("save_settings", { args: { api_key, base_url } }),
  validateApiKey: (api_key: string, base_url: string) =>
    invoke<ValidateResult>("validate_api_key", { args: { api_key, base_url } }),
  refreshVoices: () => invoke<Voice[]>("refresh_voices"),
  askStream: (args: AskStreamCommandArgs) =>
    invoke<AskStreamCommandResult>("ask_stream", { args }),
  setSelectedVoice: (key: string) => invoke<void>("set_selected_voice", { key }),
  openComposer: () => invoke<void>("open_composer"),
  openSettings: () => invoke<void>("open_settings_window"),
  closeWindow: (label: string) => invoke<void>("close_window", { label }),
  quitApp: () => invoke<void>("quit_app"),
};
