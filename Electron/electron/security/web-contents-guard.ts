// =============================================================================
// Her webContents'e takılan kapılar: gezinme, yönlendirme, yeni pencere, webview ve
// tarayıcı izinleri. Ana çerçeve yalnız uygulamanın KENDİ belgesinde kalır (UNC dahil
// her file:// ve ağ adresi engellenir); alt çerçeve yalnız srcdoc/boş belgeye gider.
// Engellenen gezinme işletim sistemine DEVREDİLMEZ (shell.openExternal çağrılmaz).
// =============================================================================
import type { Session, WebContents } from "electron";
import log from "electron-log/main.js";
import { isAllowedSubframeUrl, isAppDocumentUrl } from "@shared/app-origin";
import { trustedAppEntry } from "./trusted-ipc.js";

/** Uygulama belgesine verilen tarayıcı izinleri — ölçüldü: panel yalnız panoyu okur/yazar. */
export const APP_DOCUMENT_PERMISSIONS: readonly string[] = ["clipboard-read", "clipboard-sanitized-write"];

interface NavigationDetails {
  readonly url: string;
  readonly isMainFrame: boolean;
  preventDefault(): void;
}

export function isNavigationAllowed(url: string, isMainFrame: boolean): boolean {
  if (isMainFrame) return isAppDocumentUrl(url, trustedAppEntry(), process.platform);
  return isAllowedSubframeUrl(url);
}

function guardNavigation(kind: string, details: NavigationDetails): void {
  if (isNavigationAllowed(details.url, details.isMainFrame)) return;
  details.preventDefault();
  log.warn("[guvenlik] gezinme engellendi", {
    kind,
    isMainFrame: details.isMainFrame,
    url: details.url.slice(0, 200),
  });
}

/** `app.on("web-contents-created")` her yeni webContents için çağırır. */
export function guardWebContents(contents: WebContents): void {
  contents.on("will-navigate", (details) => guardNavigation("will-navigate", details));
  contents.on("will-frame-navigate", (details) => {
    // Ana çerçeve `will-navigate`te ölçülür; burada yalnız alt çerçeveler.
    if (!details.isMainFrame) guardNavigation("will-frame-navigate", details);
  });
  contents.on("will-redirect", (details) => guardNavigation("will-redirect", details));
  contents.on("will-attach-webview", (event) => event.preventDefault());
  // Varsayılan: yeni pencere YOK. Ana pencere kendi işleyicisiyle bunu ezer (main.ts).
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function isAppRequest(contents: WebContents | null, requestingUrl: string | undefined): boolean {
  const url = requestingUrl || contents?.getURL() || "";
  return isAppDocumentUrl(url, trustedAppEntry(), process.platform);
}

/**
 * Oturum izinleri varsayılan RED: yalnız uygulama belgesine pano izinleri. İşleyici
 * kurulmazsa Electron her izni VERİR (kamera, konum, bildirim, dış protokol açma…).
 */
export function installPermissionPolicy(ses: Session): void {
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const granted = APP_DOCUMENT_PERMISSIONS.includes(permission) && isAppRequest(contents, details.requestingUrl);
    if (!granted) log.warn("[guvenlik] izin isteği reddedildi", { permission });
    callback(granted);
  });
  ses.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      APP_DOCUMENT_PERMISSIONS.includes(permission) && isAppRequest(contents, details.requestingUrl),
  );
}
