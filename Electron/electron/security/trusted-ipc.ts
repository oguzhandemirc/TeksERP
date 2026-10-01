// =============================================================================
// IPC gönderen denetimi — TEK geçit. Her `ipcMain.handle/on` kaydı buradan geçer
// (bekçi: src/test/trusted-ipc.test.ts); istek yalnız uygulamanın KENDİ belgesinin
// ana çerçevesinden gelirse işlenir. Preload köprüyü zaten yalnız o belgeye açar
// (`electron/preload.ts`); bu ikinci hat, köprüye bir yoldan ulaşan yabancı bir
// belgeyi (ağ paylaşımından yüklenmiş sayfa, alt çerçeve) ana süreçte durdurur.
// =============================================================================
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import log from "electron-log/main.js";
import { isAppDocumentUrl } from "@shared/app-origin";

/** Uygulama giriş adresi (main.ts açılışta yazar). Yazılmadıysa her istek REDDEDİLİR. */
let appEntryUrl: string | null = null;

export function setTrustedAppEntry(url: string): void {
  appEntryUrl = url;
}

export function trustedAppEntry(): string | null {
  return appEntryUrl;
}

/** Gönderen çerçevenin yalnız ölçülen iki niteliği — testte sahte olay kurulabilsin diye dar tip. */
export interface SenderFrameLike {
  readonly url: string;
  readonly parent: unknown;
}

export function isTrustedSender(event: { readonly senderFrame: SenderFrameLike | null }): boolean {
  try {
    const frame = event.senderFrame;
    if (!frame || frame.parent) return false;
    return isAppDocumentUrl(frame.url, appEntryUrl, process.platform);
  } catch {
    // Çerçeve gezinmiş/yok edilmişse erişimciler istisna atar → güvenli yön: RED.
    return false;
  }
}

/** Ret mesajı — renderer'daki promise bununla düşer (gerekçe ana süreç günlüğünde). */
export const UNTRUSTED_SENDER_ERROR = "IPC isteği uygulama belgesinden gelmedi";

function logRejected(channel: string, event: { readonly senderFrame: SenderFrameLike | null }): void {
  let url: string | null = null;
  try {
    url = event.senderFrame?.url ?? null;
  } catch {
    url = null;
  }
  log.warn("[guvenlik] IPC reddedildi", { channel, url });
}

export function handleTrusted<A extends unknown[]>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: A) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) {
      logRejected(channel, event);
      throw new Error(UNTRUSTED_SENDER_ERROR);
    }
    return listener(event, ...(args as A));
  });
}

export function onTrusted<A extends unknown[]>(
  channel: string,
  listener: (event: IpcMainEvent, ...args: A) => void,
): void {
  ipcMain.on(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) {
      logRejected(channel, event);
      return;
    }
    listener(event, ...(args as A));
  });
}
