import { Buffer } from "buffer";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

/* react-pdf'in browser bundle'ı data: URL'leri okurken Node `Buffer` global'ini
   bekliyor (warning fırlatıp catch ile devam ediyor ama console'u dolduruyor).
   Buffer polyfill'i global'e bağlayınca temiz çalışıyor. */
(window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

const platform = window.api?.appInfo.platform();
if (platform) document.documentElement.classList.add(`platform-${platform === "darwin" ? "mac" : platform}`);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
