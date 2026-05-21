//! Notification permission + delivery via the modern UserNotifications
//! framework. `tauri-plugin-notification` still delivers through deprecated
//! `NSUserNotification`, which macOS Big Sur+ silently drops, so on macOS we
//! bypass it and schedule through `UNUserNotificationCenter`.

#[cfg(target_os = "macos")]
pub fn request_on_launch() {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::NSError;
    use objc2_user_notifications::{UNAuthorizationOptions, UNUserNotificationCenter};

    let center = UNUserNotificationCenter::currentNotificationCenter();
    let options = UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound;
    let completion = RcBlock::new(|_granted: Bool, _error: *mut NSError| {});
    center.requestAuthorizationWithOptions_completionHandler(options, &completion);
}

#[cfg(not(target_os = "macos"))]
pub fn request_on_launch() {}

#[cfg(target_os = "macos")]
pub fn send(title: &str, body: &str) {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use block2::RcBlock;
    use objc2_foundation::{NSError, NSString};
    use objc2_user_notifications::{
        UNMutableNotificationContent, UNNotificationRequest, UNUserNotificationCenter,
    };

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));

    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let identifier = NSString::from_str(&format!("cal-ai-{stamp}-{seq}"));

    let request =
        UNNotificationRequest::requestWithIdentifier_content_trigger(&identifier, &content, None);

    let center = UNUserNotificationCenter::currentNotificationCenter();
    let completion = RcBlock::new(|err: *mut NSError| {
        if !err.is_null() {
            eprintln!("notifications: add request failed");
        }
    });
    center.addNotificationRequest_withCompletionHandler(&request, Some(&completion));
}

#[cfg(not(target_os = "macos"))]
pub fn send(_title: &str, _body: &str) {}
