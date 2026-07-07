// =============================================================================
// dev_slow_proxy — fabrika ağını MASADA taklit eden gecikme/jitter/drop proxy'si
// =============================================================================
// Koşum:
//   npx tsx scripts/dev_slow_proxy.ts --profile kotu
//   npx tsx scripts/dev_slow_proxy.ts --rtt 300 --jitter 200 --drop 0.08 --port 4100
//
// Ne işe yarar: tablet/panel bu proxy'ye bağlanınca (aşağıya bakın) tüm API
// trafiği yapılandırılmış gecikme + jitter'la, isteğe bağlı paket-drop'la
// (soket kesilir → timeout/retry/offline-kuyruk yolları GERÇEKÇİ tetiklenir)
// backend'e iletilir. Faz-1/2 dayanıklılık davranışlarını sahaya gitmeden test
// etmenin standart yolu (SAHA-DAYANIKLILIK-FAZ3.md §P3).
//
// Bağlama:
//   TABLET  → login ekranı sağ-alt dişli → Sunucu adresi → http://<LAN-IP>:4100
//   ELECTRON→ Sistem → Genel Ayarlar → API adresi → http://<LAN-IP>:4100
//   (Testten sonra adresi 4000'e geri almayı unutmayın.)
//
// NOT: İstek/cevap gövdeleri BUFFERLANIR (JSON API'ler için doğru ve basit);
// çok büyük indirmeler (yedek dosyası vb.) için tasarlanmadı — dev aracı.
// Saf Node (paket yok) — Allowed Packages listesi etkilenmez.

import http from "node:http";
import os from "node:os";

interface Profile {
  rtt: number;
  jitter: number;
  drop: number; // 0..1 — isteğin soketini kesme olasılığı
}

const PROFILES: Record<string, Profile> = {
  // Faz-1 saha simülasyonundaki kalibrasyonla hizalı:
  orta: { rtt: 80, jitter: 60, drop: 0 },
  kotu: { rtt: 250, jitter: 160, drop: 0.02 },
  felaket: { rtt: 500, jitter: 300, drop: 0.05 },
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const profileName = arg("profile") ?? "kotu";
const base = PROFILES[profileName];
if (!base && !arg("rtt")) {
  console.error(`Bilinmeyen profil '${profileName}'. Seçenekler: ${Object.keys(PROFILES).join(", ")} veya --rtt/--jitter/--drop`);
  process.exit(1);
}
const cfg: Profile = {
  rtt: Number(arg("rtt") ?? base?.rtt ?? 250),
  jitter: Number(arg("jitter") ?? base?.jitter ?? 160),
  drop: Number(arg("drop") ?? base?.drop ?? 0),
};
const PORT = Number(arg("port") ?? 4100);
// NaN/aralık doğrulaması — bozuk argüman simülatörü sessizce etkisizleştirmesin.
if (!Number.isFinite(cfg.rtt) || cfg.rtt < 0) {
  console.error(`Geçersiz --rtt: '${arg("rtt")}' (ms, ≥0 sayı olmalı)`);
  process.exit(1);
}
if (!Number.isFinite(cfg.jitter) || cfg.jitter < 0) {
  console.error(`Geçersiz --jitter: '${arg("jitter")}' (ms, ≥0 sayı olmalı)`);
  process.exit(1);
}
if (!Number.isFinite(cfg.drop) || cfg.drop < 0 || cfg.drop > 1) {
  console.error(`Geçersiz --drop: '${arg("drop")}' (0..1 arası oran olmalı, ör. 0.05)`);
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Geçersiz --port: '${arg("port")}' (1-65535)`);
  process.exit(1);
}
let TARGET: URL;
try {
  TARGET = new URL(arg("target") ?? "http://127.0.0.1:4000");
} catch {
  console.error(`Geçersiz --target: '${arg("target")}' (ör. http://192.168.1.50:4000)`);
  process.exit(1);
}

const oneWay = () => cfg.rtt / 2 + Math.random() * (cfg.jitter / 2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let served = 0;
let dropped = 0;

const proxy = http.createServer((req, res) => {
  // Drop: istek gövdesi okunmadan soket kesilir — istemci timeout/ECONNRESET
  // yollarına düşer (offline kuyruk, NoAuth bekleme, poll backoff test edilir).
  if (cfg.drop > 0 && Math.random() < cfg.drop) {
    dropped++;
    setTimeout(() => req.socket.destroy(), oneWay());
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", async () => {
    await sleep(oneWay()); // istek uçuşu
    const body = Buffer.concat(chunks);
    const upstream = http.request(
      {
        host: TARGET.hostname,
        port: TARGET.port || 80,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `${TARGET.hostname}:${TARGET.port}` },
      },
      (ures) => {
        const rchunks: Buffer[] = [];
        ures.on("data", (c: Buffer) => rchunks.push(c));
        ures.on("end", async () => {
          await sleep(oneWay()); // cevap uçuşu
          served++;
          if (served % 25 === 0) {
            console.log(`  … ${served} istek iletildi${dropped ? `, ${dropped} düşürüldü` : ""}`);
          }
          // Gövde bufferlandı → content-length'i gerçek boyutla yeniden yaz
          // (upstream chunked gönderdiyse uzunluk başlığı hiç yoktu).
          const out = Buffer.concat(rchunks);
          const headers = { ...ures.headers };
          delete headers["transfer-encoding"];
          headers["content-length"] = String(out.length);
          res.writeHead(ures.statusCode ?? 502, headers);
          res.end(out);
        });
      },
    );
    upstream.on("error", (err) => {
      console.error(`  ! backend'e ulaşılamadı (${TARGET.origin}): ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, message: "dev_slow_proxy: backend kapalı" }));
      } else {
        res.destroy();
      }
    });
    upstream.end(body);
  });
});

proxy.listen(PORT, "0.0.0.0", () => {
  const lanIps = Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
  console.log("┌─────────────────────────────────────────────────────────────");
  console.log("│ dev_slow_proxy — fabrika ağı simülatörü");
  console.log(`│ Profil: ${base ? profileName : "(elle)"} → RTT ~${cfg.rtt}ms ±${cfg.jitter}, drop %${(cfg.drop * 100).toFixed(0)}`);
  console.log(`│ Hedef backend: ${TARGET.origin}`);
  console.log("│");
  console.log("│ Bağlanma adresleri:");
  for (const ip of lanIps) console.log(`│   http://${ip}:${PORT}   (tablet: login dişlisi → Sunucu adresi)`);
  console.log(`│   http://localhost:${PORT}   (Electron: Sistem → Genel Ayarlar → API adresi)`);
  console.log("│");
  console.log("│ Test bitince adresi http://<sunucu>:4000'e GERİ ALIN.");
  console.log("│ Durdurmak için Ctrl+C.");
  console.log("└─────────────────────────────────────────────────────────────");
});
