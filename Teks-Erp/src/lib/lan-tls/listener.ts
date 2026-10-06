// LAN TLS dinleyicisi: HTTP'nin yanında aynı Express uygulamasını HTTPS'ten sunar (docs/design/LAN-TLS.md §5).
// Keşif yükündeki `tls` alanı yalnız dinleyici GERÇEKTEN dinlerken dolar — istemciye kapalı portu duyurmamak için.
import https from "node:https";
import type { RequestListener } from "node:http";
import type { LanTlsConfig } from "./config";
import { loadOrCreateLanTlsStore } from "./store";

export interface LanTlsAdvert {
  port: number;
  /** Sertifika DER'inin SHA-256'sı (küçük harf hex). GÜVEN KAYNAĞI DEĞİL: istemci bunu eşleştirmede doğrular. */
  fingerprint: string;
}

export interface LanTlsLog {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, err?: unknown): void;
}

let advert: LanTlsAdvert | null = null;
let server: https.Server | null = null;

/** Keşif ucunun okuduğu bellek kopyası (DB'siz, senkron). */
export function getLanTlsAdvert(): LanTlsAdvert | null {
  return advert;
}

/** `off`ta hiçbir şey yapmaz. Hata sunucuyu DÜŞÜRMEZ: `dual` HTTP ile sürer, `required`da LAN kapalı kalır. */
export function startLanTlsListener(
  app: RequestListener,
  cfg: LanTlsConfig,
  bindHost: string,
  log: LanTlsLog,
): https.Server | null {
  if (cfg.mode === "off") return null;
  const failNote = cfg.mode === "required" ? " — ZORUNLU kipte LAN'a hiçbir bağlantı açık değil" : " — HTTP ile sürüyor";
  if (!cfg.dir) {
    log.error(`TLS deposu çözülemedi (${cfg.dirProblem ?? "bilinmiyor"})${failNote}`);
    return null;
  }
  const store = loadOrCreateLanTlsStore(cfg.dir);
  if (!store.ok) {
    log.error(`TLS sertifikası yüklenemedi: ${store.problem}${failNote}`);
    return null;
  }
  if (store.setAside.length) {
    log.warn(`bozuk TLS dosyaları kenara alındı (${store.setAside.join(", ")}); YENİ parmak izi — istemciler yeniden eşleştirilmeli`);
  } else if (store.generated) {
    log.info("yeni TLS sertifikası üretildi");
  }
  const srv = https.createServer({ key: store.keyPem, cert: store.certPem, minVersion: "TLSv1.2" }, app);
  srv.on("error", (err) => {
    advert = null;
    log.error(`HTTPS dinleyici ${bindHost}:${cfg.port} açılamadı${failNote}`, err);
  });
  srv.listen(cfg.port, bindHost, () => {
    const addr = srv.address();
    const port = addr && typeof addr === "object" ? addr.port : cfg.port;
    advert = { port, fingerprint: store.fingerprint };
    log.info(`HTTPS ${bindHost}:${port} · kip ${cfg.mode} · parmak izi ${store.fingerprint}`);
  });
  server = srv;
  return srv;
}

export function stopLanTlsListener(): void {
  advert = null;
  server?.close();
  server = null;
}

/** Yalnız bekçi: bellek durumunu sıfırlar. */
export function __setLanTlsAdvertForTests(next: LanTlsAdvert | null): void {
  advert = next;
}
