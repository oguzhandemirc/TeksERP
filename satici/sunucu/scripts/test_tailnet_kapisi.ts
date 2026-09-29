// =============================================================================
// TAILNET KAPISI — portal ve kök parolası isteyen uçlar YALNIZ tailnet dinleyicisinde; kapı iki
// koşullu ve FAIL-CLOSED: (1) istek tailnet dinleyicisinin soketine gelmiş olmalı, (2) kaynak adres
// geri döngü / Tailscale ağında olmalı. Biri tutmazsa 404 (varlık sızdırılmaz). Yapılandırma
// tailnet dinleyicisini joker adrese (0.0.0.0 / ::) bağlamayı açılışta REDDEDER.
// Ölçüm: yapılandırma · kaynak ağı yüklemi (sınır değerleri) · ara katman sahte soketle · gerçek
// iki sunucu: AYNI uygulama başka bir sokette dinletilince kapı 404 verir (soket koşulu gerçekten
// okunuyor), doğru sokette 200.
// ⭐ KALICI SONDA ✓K1 (her koşumda): kapı doğru soket + doğru kaynakta GEÇİRİR (her şeyi reddeden
//    kör bir kapı da "404" yeşili verirdi).
// Koşum: npx tsx scripts/test_tailnet_kapisi.ts   (DB sorgusu yok)
// =============================================================================
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { KeyStore } from "../src/keys/key-store";
import { createTailnetApp, isTailnetSource, requireTailnet } from "../src/http/tailnet-app";
import { fiksturKur } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { kontrol, sonuc } from "./lib/test-ortam";

function listen(server: http.Server): Promise<AddressInfo> {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address() as AddressInfo)));
}

async function main(): Promise<void> {
  console.log("\n§1 yapılandırma");
  const taban = { DATABASE_URL: "postgresql://x@127.0.0.1:1/x_test" };
  for (const joker of ["0.0.0.0", "::", ""]) {
    let reddedildi = false;
    try {
      loadConfig({ ...taban, TAILNET_BIND: joker });
    } catch {
      reddedildi = true;
    }
    kontrol(`§1 TAILNET_BIND="${joker}" açılışta reddedilir`, reddedildi);
  }
  kontrol("§1d varsayılan tailnet bağı 127.0.0.1", loadConfig(taban).TAILNET_BIND === "127.0.0.1");

  console.log("\n§2 kaynak ağı yüklemi");
  const icerde = ["127.0.0.1", "::1", "100.64.0.1", "100.127.255.254", "::ffff:100.100.1.1", "fd7a:115c:a1e0::1"];
  const disarda = ["100.128.0.1", "100.63.255.255", "10.0.0.1", "192.168.1.10", "8.8.8.8", "fd00::1", "::ffff:8.8.8.8", "", "abc"];
  kontrol("§2a tailnet/geri döngü adresleri içeride", icerde.every((a) => isTailnetSource(a)), icerde.filter((a) => !isTailnetSource(a)).join(","));
  kontrol("§2b diğerleri dışarıda (sınırlar dahil)", disarda.every((a) => !isTailnetSource(a)), disarda.filter((a) => isTailnetSource(a)).join(","));

  console.log("\n§3 ara katman (sahte soket)");
  const dene = (listener: AddressInfo | null, local: string, localPort: number, remote: string): number => {
    let durum = 0;
    const req = { socket: { localAddress: local, localPort, remoteAddress: remote }, method: "GET", path: "/portal/saglik" };
    const res = { status: (s: number) => ((durum = s), res), json: () => res };
    requireTailnet(() => listener)(req as never, res as never, () => (durum = 200));
    return durum;
  };
  const dinleyici: AddressInfo = { address: "127.0.0.1", family: "IPv4", port: 4611 };
  kontrol("§3a dinleyici henüz yok → 404", dene(null, "127.0.0.1", 4611, "127.0.0.1") === 404);
  kontrol("§3b başka port (genel dinleyici) → 404", dene(dinleyici, "127.0.0.1", 4610, "127.0.0.1") === 404);
  kontrol("§3c doğru soket, kaynak internet → 404", dene(dinleyici, "127.0.0.1", 4611, "203.0.113.9") === 404);
  kontrol("§3d ✓K doğru soket + tailnet kaynağı → geçer", dene(dinleyici, "127.0.0.1", 4611, "100.101.102.103") === 200);

  console.log("\n§4 gerçek soketler");
  const dizin = mkdtempSync(path.join(os.tmpdir(), "satici-tailnet-"));
  const f = fiksturKur(Date.now());
  writeFileSync(path.join(dizin, "capa.json"), JSON.stringify(f.kokler));
  const config = loadConfig({ ...taban, ANAHTAR_DIZINI: dizin, GUVEN_CAPASI_DOSYASI: path.join(dizin, "capa.json") });
  let tailnetAdresi: AddressInfo | null = null;
  const app = createTailnetApp({ config, keys: KeyStore.load(config) }, null, () => tailnetAdresi);
  const dogru = http.createServer(app);
  const yanlis = http.createServer(app);
  try {
    tailnetAdresi = await listen(dogru);
    const yanlisAdres = await listen(yanlis);
    const r1 = await fetch(`http://127.0.0.1:${tailnetAdresi.port}/portal/saglik`);
    const r2 = await fetch(`http://127.0.0.1:${yanlisAdres.port}/portal/saglik`);
    kontrol("§4a ✓K tailnet soketinde portal sağlık → 200", r1.status === 200, `${r1.status}`);
    kontrol("§4b aynı uygulama BAŞKA sokette → 404 (soket koşulu gerçekten okunuyor)", r2.status === 404, `${r2.status}`);
    const govde = JSON.stringify(await r1.json());
    kontrol("§4c sağlık gövdesi sır/anahtar taşımaz", !govde.includes(f.kok.x) && !/"d"|privateKey|parola/.test(govde));
  } finally {
    await new Promise((r) => dogru.close(r));
    await new Promise((r) => yanlis.close(r));
    rmSync(dizin, { recursive: true, force: true });
  }
  const { pool } = await import("../src/lib/prisma");
  await pool.end().catch(() => undefined);
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
