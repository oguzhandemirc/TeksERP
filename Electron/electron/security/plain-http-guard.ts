// Panel yalnız şifreli (docs/design/LAN-TLS.md §6): oturumun şifresiz (http/ws) isteği yalnız döngü adresine
// gider. Arayüz kapısının arkasındaki ağ kapısı — kayıtlı eski http adresi ya da atlanmış bir yol düz metin taşıyamaz.
import type { Session } from "electron";
import log from "electron-log";
import { plainRequestAllowed } from "../../shared/lan-tls.js";

export function installPlainHttpGuard(ses: Session): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = plainRequestAllowed(details.url);
    if (!allowed) log.warn(`[lan-tls] şifresiz ağ isteği kesildi: ${details.url.split("?")[0]}`);
    callback({ cancel: !allowed });
  });
}
