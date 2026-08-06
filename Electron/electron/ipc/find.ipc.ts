import { ipcMain, type WebContents } from "electron";

/**
 * Sayfa içi metin arama (Ctrl+F) — Chromium'un kendi `findInPage`'i.
 *
 * Neden yerleşik API: vurgulama, kaydırıp eşleşmeye götürme, "3/17" sayacı ve
 * iframe içlerinde (belge önizlemeleri) arama HAZIR gelir. Kendi DOM tarayıcımızı
 * yazmak React'in yönettiği ağaca işaretleme enjekte etmek demekti — hem kırılgan
 * hem gereksiz.
 */

/**
 * `found-in-page` dinleyicisi webContents BAŞINA bir kez bağlanır.
 *
 * ⚠️ WeakSet şart: her `find:start` çağrısında yeniden bağlansaydı dinleyiciler
 * birikir, tek aramada onlarca sonuç olayı gider ve sayaç titrerdi (Electron
 * `MaxListenersExceededWarning` de basardı). WeakSet, pencere kapanınca kaydı
 * kendiliğinden bırakır.
 */
const wired = new WeakSet<WebContents>();

function ensureWired(wc: WebContents): void {
  if (wired.has(wc)) return;
  wired.add(wc);
  wc.on("found-in-page", (_e, result) => {
    if (wc.isDestroyed()) return;
    wc.send("find:result", {
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches,
    });
  });
}

export function registerFindIpc(): void {
  ipcMain.on(
    "find:start",
    (event, text: unknown, opts?: { forward?: boolean; findNext?: boolean }) => {
      const wc = event.sender;
      if (wc.isDestroyed()) return;
      const q = typeof text === "string" ? text : "";
      // ⚠️ Boş metinle `findInPage` ÇAĞRILMAZ — Chromium hata fırlatır. Kullanıcı
      // kutuyu boşalttığında beklenen davranış zaten "aramayı bırak".
      if (!q) {
        wc.stopFindInPage("clearSelection");
        return;
      }
      ensureWired(wc);
      wc.findInPage(q, {
        forward: opts?.forward ?? true,
        findNext: opts?.findNext ?? false,
      });
    },
  );

  ipcMain.on("find:stop", (event, clearSelection?: unknown) => {
    const wc = event.sender;
    if (wc.isDestroyed()) return;
    // Varsayılan: vurguyu temizle. `false` gelirse seçim kalsın (kullanıcı
    // bulduğu yeri kopyalayacaksa).
    wc.stopFindInPage(clearSelection === false ? "keepSelection" : "clearSelection");
  });
}
