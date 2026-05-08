import type { Voice } from "./tauri";

// "Default" reads cleaner than whatever the backend ships in `name`
// for the canonical voice. Other voices keep their backend-provided
// display names.
export function voiceDisplayName(voice: { key: string; name: string }): string {
  return voice.key === "default" ? "Default" : voice.name;
}

// Deterministic per-key color so the same voice always renders with
// the same accent across launches.
export function voiceColor(key: string): string {
  const hue = hashString(key) % 360;
  return `oklch(0.74 0.16 ${hue})`;
}

function hashString(s: string): number {
  // djb2
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) + h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function voiceFor(
  voices: Voice[],
  selectedKey: string,
): Voice | undefined {
  return voices.find((v) => v.key === selectedKey) ?? voices[0];
}
