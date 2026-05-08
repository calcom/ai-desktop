// Mirror of `src-tauri/src/wrap.rs` — keep in sync.

const MAX_MESSAGE_LEN = 1800;
const TEMPLATE =
  "Compose a reply to this customer message, drawing only on Cal.com Help Desk documentation:\n\n";

export function wrapCustomerMessage(text: string): string {
  const trimmed = text.trim();
  const body =
    trimmed.length > MAX_MESSAGE_LEN
      ? trimmed.slice(0, MAX_MESSAGE_LEN) + "…"
      : trimmed;
  return TEMPLATE + body;
}
