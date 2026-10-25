import { BrowserWindow, session } from "electron";
import type { BrowserWindowConstructorOptions, Session, WebContents } from "electron";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { delegateSubframeGuard } from "../security/web-contents-guard.js";

// =============================================================================
// PDF ÖNİZLEME GÖRÜNTÜLEYİCİSİ (Belge Tasarımcısı T4) — `pdf:preview` baytları burada gösterir.
// Çizim `pdf:save` ile AYNI sertleştirilmiş gizli pencerede/kuyrukta/bayt kapısında yapılır;
// bu pencere yalnız hazır PDF'i Chromium'un yerleşik görüntüleyicisiyle açar (plugins:true).
// Köprü (preload) YOK, Node YOK; ağ yalnız kendi geçici dosyası + görüntüleyici eklentisi.
// =============================================================================

/** Ayrık oturum; `persist:` ZORUNLU: bellek içi oturumda Chromium PDF eklentisi çizmiyor (ölçüldü 2026-10-25).
 * Disk izi kalmasın diye pencere kapanınca önbellek + depo temizlenir. */
export const PDF_VIEWER_PARTITION = "persist:tekserp-pdf-viewer";

export const PDF_VIEWER_WINDOW_OPTIONS = {
  width: 900,
  height: 1100,
  show: true,
  autoHideMenuBar: true,
  webPreferences: {
    // Chromium PDF görüntüleyicisi bir eklentidir (plugins) ve kendi arayüzü JS ister.
    plugins: true,
    javascript: true,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
    navigateOnDragDrop: false,
    partition: PDF_VIEWER_PARTITION,
  },
} satisfies BrowserWindowConstructorOptions;

/** Görüntüleyicinin yükleyebildiği tek şey: kendi geçici PDF'i + yerleşik görüntüleyici kaynakları. */
export function isViewerResourceAllowed(url: string, allowedFile: string | null): boolean {
  if (allowedFile !== null && url === allowedFile) return true;
  return url.startsWith("chrome-extension://") || url.startsWith("chrome://") || url.startsWith("blob:") || url.startsWith("data:");
}

const allowedFiles = new Set<string>();
let viewerSession: Session | null = null;

export function hardenedViewerSession(): Session {
  if (viewerSession) return viewerSession;
  const ses = session.fromPartition(PDF_VIEWER_PARTITION);
  ses.setPermissionRequestHandler((_c, _p, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, callback) => {
    const ok = allowedFiles.has(details.url) || isViewerResourceAllowed(details.url, null);
    callback({ cancel: !ok });
  });
  viewerSession = ses;
  return ses;
}

/** Gezinme/yeni pencere engelli; yalnız görüntüleyicinin kendi eklenti çerçevesi açılabilir. */
export function hardenViewerContents(contents: WebContents, fileUrl: string): void {
  const block = (event: { preventDefault(): void }): void => event.preventDefault();
  contents.on("will-navigate", block);
  contents.on("will-redirect", block);
  contents.on("will-attach-webview", block);
  contents.on("will-frame-navigate", (event: { url: string; preventDefault(): void }) => {
    if (!isViewerResourceAllowed(event.url, fileUrl)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}

const VIEWER_LOAD_TIMEOUT_MS = 15_000;

/**
 * PDF'i 0600 geçici dosyaya yazar ve görüntüleyicide açar; pencere kapanınca dosya silinir.
 * Açılamazsa `false` döner (panel yedek yolu: sayfa sayısı + "PDF Kaydet").
 */
export async function openPdfViewer(pdf: Uint8Array, title: string): Promise<boolean> {
  const file = join(tmpdir(), `tekserp-onizleme-${randomUUID()}.pdf`);
  const fileUrl = pathToFileURL(file).href;
  await writeFile(file, pdf, { mode: 0o600 });
  allowedFiles.add(fileUrl);
  const ses = hardenedViewerSession();
  const cleanup = () => {
    allowedFiles.delete(fileUrl);
    void unlink(file).catch(() => undefined);
    void ses.clearCache().catch(() => undefined);
    void ses.clearStorageData().catch(() => undefined);
  };
  const win = new BrowserWindow({ ...PDF_VIEWER_WINDOW_OPTIONS, title: title.slice(0, 120) });
  hardenViewerContents(win.webContents, fileUrl);
  delegateSubframeGuard(win.webContents);
  win.on("closed", cleanup);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      win.loadURL(fileUrl),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("görüntüleyici zaman aşımı")), VIEWER_LOAD_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    win.destroy();
    cleanup();
    return false;
  } finally {
    clearTimeout(timer);
  }
}
