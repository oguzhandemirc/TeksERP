// Panel yalnız şifreli (docs/design/LAN-TLS.md §6): oturumun şifresiz (http/ws) isteği yalnız döngü adresine
// gider. Arayüz kapısının arkasındaki ağ kapısı — kayıtlı eski http adresi ya da atlanmış bir yol düz metin taşıyamaz.
// Aynı dinleyici connect-src kapısını da uygular (oturum başına TEK `onBeforeRequest` olabilir).
import type { Session } from "electron";
import log from "electron-log";
import { plainRequestAllowed } from "../../shared/lan-tls.js";
import { connectGateCancels } from "./connect-gate.js";

export function installPlainHttpGuard(ses: Session): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (!plainRequestAllowed(details.url)) {
      log.warn(`[lan-tls] şifresiz ağ isteği kesildi: ${details.url.split("?")[0]}`);
      callback({ cancel: true });
      return;
    }
    if (connectGateCancels(details)) {
      log.warn(`[connect-src] yapılandırılmamış kökene istek kesildi: ${details.url.split("?")[0]}`);
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  });
}
