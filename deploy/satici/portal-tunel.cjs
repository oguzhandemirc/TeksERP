#!/usr/bin/env node
// =============================================================================
// Portal GERİ DÖNGÜ İLETİCİSİ — yalnız geri döngü kipi (docker-compose.loopback.yml), GEÇİCİ.
// =============================================================================
// Tailscale onaylanana dek portal VDS'ten SSH tüneliyle açılır. Docker'ın köprü/vekil yolu kaynak
// adresi ağ geçidine çevirir (tailnet kapısı 404 verir); bu yüzden satıcının tailnet dinleyicisi
// konteynerin KENDİ 127.0.0.1'ine bağlanır ve bu iletici, satıcıyla AYNI ağ ad alanında
// (`network_mode: service:satici`) tailnet köprü adresini dinleyip bağlantıyı 127.0.0.1'e aktarır —
// portal kaynağı 127.0.0.1 görür (TAILNET_LOOPBACK=1). Bağımlılıksız; yalnız node:net.
// Satıcı konteyneri yeniden başlarsa bu iletici eski ağ ad alanında kalır (Docker `service:` ağ
// kipinin sınırı): hedef art arda ulaşılamazsa süreç çıkar, `restart` onu yeni ad alanına bağlar.
// Ortam: TUNEL_DINLE (zorunlu, joker DEĞİL) · TUNEL_PORT (4611) · TUNEL_HEDEF_PORT (4611)
// =============================================================================
"use strict";
const net = require("node:net");

const dinle = (process.env.TUNEL_DINLE || "").trim();
const port = Number(process.env.TUNEL_PORT || 4611);
const hedefPort = Number(process.env.TUNEL_HEDEF_PORT || 4611);

if (!net.isIP(dinle) || ["0.0.0.0", "::"].includes(dinle) || dinle.startsWith("127.")) {
  console.error(`[portal-tunel] TUNEL_DINLE tek bir köprü adresi olmalı (joker/geri döngü değil): "${dinle}"`);
  process.exit(1);
}

const sunucu = net.createServer((gelen) => {
  const giden = net.connect({ host: "127.0.0.1", port: hedefPort });
  const kapat = () => {
    gelen.destroy();
    giden.destroy();
  };
  gelen.on("error", kapat).on("close", kapat);
  giden.on("error", kapat).on("close", kapat);
  gelen.pipe(giden).pipe(gelen);
});
sunucu.maxConnections = 64;
sunucu.on("error", (err) => {
  console.error(`[portal-tunel] dinlenemedi: ${err.message}`);
  process.exit(1);
});
sunucu.listen(port, dinle, () => console.log(`[portal-tunel] ${dinle}:${port} → 127.0.0.1:${hedefPort}`));

// Öz denetim: 30 sn'de bir hedefe bağlan; üç ardışık ret = eski ad alanı → çık (yeniden başlatılır).
let ret = 0;
setInterval(() => {
  const s = net.connect({ host: "127.0.0.1", port: hedefPort });
  s.setTimeout(5000);
  s.once("connect", () => {
    ret = 0;
    s.destroy();
  });
  const dus = () => {
    s.destroy();
    if (++ret >= 3) {
      console.error(`[portal-tunel] 127.0.0.1:${hedefPort} üç kez ulaşılamadı — çıkılıyor (yeniden başlatılacak)`);
      process.exit(1);
    }
  };
  s.once("error", dus);
  s.once("timeout", dus);
}, 30_000).unref();

for (const sinyal of ["SIGTERM", "SIGINT"]) process.on(sinyal, () => process.exit(0));
