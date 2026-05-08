use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::state::Voice;

#[derive(Debug, Clone, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub required_scope: Option<String>,
    pub retry_after_seconds: Option<u64>,
}

impl ApiError {
    pub fn user_message(&self, base_url: &str) -> String {
        match self.code.as_str() {
            "missing_api_key" | "invalid_api_key" => {
                "API key missing or invalid — update in Settings.".to_string()
            }
            "forbidden" => {
                let scope = self.required_scope.as_deref().unwrap_or("?");
                format!("API key is missing the `{scope}` scope.")
            }
            "rate_limited" => {
                let s = self.retry_after_seconds.unwrap_or(60);
                format!("Hit the per-minute limit — try again in {s}s.")
            }
            "voices_not_configured" => "Backend has no voices configured.".to_string(),
            "validation_error" => format!("Invalid request: {}", self.message),
            "unknown_voice" => "Selected voice doesn't exist on the backend.".to_string(),
            "network" => format!("Backend offline at {base_url}."),
            _ => self.message.clone(),
        }
    }

    fn from_envelope(code: u16, body: &str) -> Self {
        #[derive(Deserialize)]
        struct Envelope {
            error: ErrorBody,
        }
        #[derive(Deserialize)]
        struct ErrorBody {
            code: String,
            message: String,
            required_scope: Option<String>,
            retry_after_seconds: Option<u64>,
        }

        if let Ok(Envelope { error }) = serde_json::from_str::<Envelope>(body) {
            return Self {
                code: error.code,
                message: error.message,
                required_scope: error.required_scope,
                retry_after_seconds: error.retry_after_seconds,
            };
        }
        Self {
            code: format!("http_{code}"),
            message: format!("Request failed: HTTP {code}"),
            required_scope: None,
            retry_after_seconds: None,
        }
    }

    fn network(message: impl Into<String>) -> Self {
        Self {
            code: "network".to_string(),
            message: message.into(),
            required_scope: None,
            retry_after_seconds: None,
        }
    }
}

fn client() -> Result<reqwest::Client, ApiError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| ApiError::network(format!("Could not build HTTP client: {e}")))
}

#[derive(Debug, Deserialize)]
pub struct MeResponse {
    pub name: String,
    pub scopes: Vec<String>,
    pub rate_limit_per_minute: Option<u32>,
}

pub async fn fetch_me(base_url: &str, api_key: &str) -> Result<MeResponse, ApiError> {
    let url = format!("{}/me", base_url.trim_end_matches('/'));
    let res = client()?
        .get(&url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| ApiError::network(e.to_string()))?;

    let status = res.status();
    let body = res
        .text()
        .await
        .map_err(|e| ApiError::network(e.to_string()))?;

    if !status.is_success() {
        return Err(ApiError::from_envelope(status.as_u16(), &body));
    }
    serde_json::from_str::<MeResponse>(&body).map_err(|e| ApiError {
        code: "parse_error".to_string(),
        message: format!("Could not parse /me response: {e}"),
        required_scope: None,
        retry_after_seconds: None,
    })
}

#[derive(Deserialize)]
struct VoicesResponse {
    voices: Vec<Voice>,
}

pub async fn fetch_voices(base_url: &str, api_key: &str) -> Result<Vec<Voice>, ApiError> {
    let url = format!("{}/voices", base_url.trim_end_matches('/'));
    let res = client()?
        .get(&url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| ApiError::network(e.to_string()))?;

    let status = res.status();
    let body = res
        .text()
        .await
        .map_err(|e| ApiError::network(e.to_string()))?;

    if !status.is_success() {
        return Err(ApiError::from_envelope(status.as_u16(), &body));
    }
    let parsed: VoicesResponse = serde_json::from_str(&body).map_err(|e| ApiError {
        code: "parse_error".to_string(),
        message: format!("Could not parse /voices response: {e}"),
        required_scope: None,
        retry_after_seconds: None,
    })?;
    Ok(parsed.voices)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub slug: String,
    #[serde(rename = "headingPath")]
    pub heading_path: Vec<String>,
}

#[derive(Debug, Default)]
pub struct AskResult {
    pub text: String,
    pub citations: Vec<Citation>,
    pub no_context: bool,
}

#[derive(Debug, Clone)]
pub enum AskStreamUpdate {
    Delta(String),
    Citations(Vec<Citation>),
    Error(String),
}

#[derive(Serialize)]
struct AskBody<'a> {
    question: &'a str,
    voice: &'a str,
    top_k: u32,
}

const NO_CONTEXT_REPLY: &str = "I don't have information about that in the Cal.com docs.";

pub async fn ask_collect(
    base_url: &str,
    api_key: &str,
    question: &str,
    voice: &str,
) -> Result<AskResult, ApiError> {
    ask_collect_with_events(base_url, api_key, question, voice, 8, |_| {}).await
}

pub async fn ask_collect_with_events<F>(
    base_url: &str,
    api_key: &str,
    question: &str,
    voice: &str,
    top_k: u32,
    mut on_event: F,
) -> Result<AskResult, ApiError>
where
    F: FnMut(AskStreamUpdate),
{
    let url = format!("{}/ask", base_url.trim_end_matches('/'));
    let body = AskBody {
        question,
        voice,
        top_k,
    };
    let res = client()?
        .post(&url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| ApiError::network(e.to_string()))?;

    let status = res.status();
    let content_type = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    if !status.is_success() || !content_type.contains("text/event-stream") {
        let body = res
            .text()
            .await
            .map_err(|e| ApiError::network(e.to_string()))?;
        return Err(ApiError::from_envelope(status.as_u16(), &body));
    }

    let mut result = AskResult::default();
    let mut buffer = String::new();
    let mut stream = res.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| ApiError::network(e.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(idx) = find_event_boundary(&buffer) {
            let raw = buffer[..idx].to_string();
            // Drop the boundary itself.
            buffer = buffer[idx..].trim_start_matches(['\r', '\n']).to_string();

            let (event, data) = parse_sse_event(&raw);
            match event.as_str() {
                "" | "message" => {
                    result.text.push_str(&data);
                    on_event(AskStreamUpdate::Delta(data));
                }
                "citations" => {
                    if let Ok(parsed) = serde_json::from_str::<Vec<Citation>>(&data) {
                        on_event(AskStreamUpdate::Citations(parsed.clone()));
                        result.citations = parsed;
                    }
                }
                "error" => {
                    #[derive(Deserialize)]
                    struct E {
                        message: String,
                    }
                    let msg = serde_json::from_str::<E>(&data)
                        .map(|e| e.message)
                        .unwrap_or_else(|_| data.clone());
                    on_event(AskStreamUpdate::Error(msg.clone()));
                    return Err(ApiError {
                        code: "stream_error".to_string(),
                        message: msg,
                        required_scope: None,
                        retry_after_seconds: None,
                    });
                }
                _ => {}
            }
        }
    }

    if result.text.trim() == NO_CONTEXT_REPLY {
        result.no_context = true;
    }

    Ok(result)
}

/// Returns the byte index *after* the event boundary if found, else None.
fn find_event_boundary(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    for i in 0..bytes.len().saturating_sub(1) {
        if bytes[i] == b'\n' && bytes[i + 1] == b'\n' {
            return Some(i + 2);
        }
        if i + 3 < bytes.len()
            && bytes[i] == b'\r'
            && bytes[i + 1] == b'\n'
            && bytes[i + 2] == b'\r'
            && bytes[i + 3] == b'\n'
        {
            return Some(i + 4);
        }
    }
    None
}

fn parse_sse_event(raw: &str) -> (String, String) {
    let mut event_name = String::new();
    let mut data_lines: Vec<String> = Vec::new();
    for line in raw.split('\n') {
        let line = line.trim_end_matches('\r');
        if let Some(rest) = line.strip_prefix("event:") {
            event_name = rest.trim_start().to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            // SSE convention: a single leading space after `data:` is consumed.
            let stripped = rest.strip_prefix(' ').unwrap_or(rest);
            data_lines.push(stripped.to_string());
        }
    }
    (event_name, data_lines.join("\n"))
}
