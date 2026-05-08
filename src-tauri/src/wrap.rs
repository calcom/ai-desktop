// Wrapping a customer message into a question for the RAG backend.
// Mirror of `src/lib/wrap.ts` on the frontend — keep in sync.

const MAX_MESSAGE_LEN: usize = 1800;
const TEMPLATE: &str =
    "Compose a reply to this customer message, drawing only on Cal.com Help Desk documentation:\n\n";

pub fn wrap_customer_message(text: &str) -> String {
    let trimmed = text.trim();
    let body: String = if trimmed.chars().count() > MAX_MESSAGE_LEN {
        let mut s: String = trimmed.chars().take(MAX_MESSAGE_LEN).collect();
        s.push('…');
        s
    } else {
        trimmed.to_string()
    };
    format!("{TEMPLATE}{body}")
}
