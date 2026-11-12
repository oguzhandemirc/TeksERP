import "./lib/terim-acilis";
import { Buffer } from "buffer";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { bootstrapApiBaseUrl } from "@/lib/api-config";
import { installGlobalErrorReporting } from "@/lib/error-report";
import "@/lib/theme/fonts";
import "./index.css";

/* exceljs'in tarayıcı bundle'ı Node `Buffer` global'ini bekliyor; yokken
   uyarı fırlatıp devam ediyor ama console'u dolduruyor. Polyfill'i global'e
   bağlayınca Excel içe/dışa aktarma yolu temiz çalışıyor. */
(window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

const platform = window.api?.appInfo.platform();
if (platform) document.documentElement.classList.add(`platform-${platform === "darwin" ? "mac" : platform}`);

/* İlk istekten önce yerel kayıtlı API adresini axios baseURL'ine uygula.
   Hızlı yerel okuma; render'ı yalnız bu süre kadar bekletir. */
async function bootstrap(): Promise<void> {
  await bootstrapApiBaseUrl();
  installGlobalErrorReporting();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
