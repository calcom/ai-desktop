import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Composer } from "./windows/Composer";
import { Settings } from "./windows/Settings";

type Route = "composer" | "settings" | "unknown";

function detectRoute(): Route {
  // Prefer the Tauri webview label — set when the window was created.
  try {
    const label = getCurrentWebviewWindow().label;
    if (label === "composer" || label === "settings") return label;
  } catch {
    // not running under Tauri (vite preview, e.g.)
  }
  // Fall back to query param so vite preview / direct URLs still work.
  const params = new URLSearchParams(window.location.search);
  const w = params.get("w");
  if (w === "composer" || w === "settings") return w;
  return "unknown";
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => detectRoute());

  useEffect(() => {
    setRoute(detectRoute());
  }, []);

  // Settings has decorations (real titlebar). Anything that overflows the
  // body should fall back to a dark color, not the system default white.
  // The composer window must stay transparent so the rounded inner div
  // doesn't sit on top of an opaque rectangle.
  useEffect(() => {
    if (route === "settings") {
      document.documentElement.style.background = "oklch(0.18 0 0)";
      document.body.style.background = "oklch(0.18 0 0)";
    } else {
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
    }
  }, [route]);

  if (route === "composer") return <Composer />;
  if (route === "settings") return <Settings />;

  return (
    <div className="h-full w-full flex items-center justify-center text-[oklch(0.62_0_0)] text-[12px]">
      Unknown window.
    </div>
  );
}
