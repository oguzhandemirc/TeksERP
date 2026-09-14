#!/usr/bin/env node
// =============================================================================
// AĞIR İŞ SARMALAYICISI — kapı-DIŞI tsc/eslint/tsx paketi kapı semaforundan geçer
// =============================================================================
// Çalıştır (herhangi bir çalışma ağacından):
//   node scripts/agir-is.mjs -- npx tsc --noEmit -p tsconfig.scripts.json
//   node scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts <ad>
//   node scripts/agir-is.mjs -- npm test
// Çıkış kodu = sarmalanan komutun çıkış kodu (sinyalle ölürse 1). Argüman yoksa 2.
//
// ⭐ NEDEN VAR (saha ölçümü 2026-09-14, d5; 1e hükmü): semafor yalnız commit KAPILARINI
//    sayıyordu. 0c'nin semaforda TEK BAŞINA koşan kapısı 365 sn sürdü (boşta 38) —
//    o anda üç oturumun kapı-dışı tsc'si ve bir bekçi paketi koşuyordu (load 44,
//    kompresör 3 → 11,9 GB). Semaforun birimi kapı değil AĞIR SÜREÇ olmalı: aynı slot
//    havuzu (KAPASITE, lib/semafor.mjs), aynı defter (lib/kapi-defteri.mjs) — bekleme
//    "semafor bekleme", koşum "ağır iş · <komut>" satırıyla düşer.
//
// ⚠️ Sarmalayıcı KOMUTU DEĞİŞTİRMEZ: stdio miras, env miras, sinyal iletilir.
//    Slot süreç nasıl biterse bitsin düşer (`exit`), öldürülürse sonraki giriş süpürür.
// =============================================================================
import { execFileSync, spawn } from "node:child_process";
import { basename } from "node:path";
import { deftereYaz } from "./hooks/lib/kapi-defteri.mjs";
import { agirSurecSayisi, slotAl } from "./hooks/lib/semafor.mjs";

const ayrac = process.argv.indexOf("--");
const komut = ayrac >= 0 ? process.argv.slice(ayrac + 1) : process.argv.slice(2);
if (komut.length === 0) {
  process.stderr.write("agir-is: kullanım  node scripts/agir-is.mjs -- <komut> [arg…]\n");
  process.exit(2);
}

function wtAdi() {
  try {
    return basename(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {
    return basename(process.cwd());
  }
}
const WT = wtAdi();
// Defter etiketi: mutlak yollar basename'e iner, 80 karakterde kesilir.
const ETIKET = komut.map((a) => (a.startsWith("/") ? basename(a) : a)).join(" ").slice(0, 80);

const t0 = Date.now();
const slotBirak = slotAl();
deftereYaz({ wt: WT, adim: `semafor bekleme · ağır ${agirSurecSayisi()}`, sonuc: "✅", sn: (Date.now() - t0) / 1000, cikis: 0 });

const t1 = Date.now();
const cocuk = spawn(komut[0], komut.slice(1), { stdio: "inherit", env: process.env });
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => cocuk.kill(sig));
cocuk.on("error", (e) => {
  process.stderr.write(`agir-is: komut başlatılamadı — ${e.message}\n`);
  deftereYaz({ wt: WT, adim: `ağır iş · ${ETIKET}`, sonuc: "❌", sn: (Date.now() - t1) / 1000, cikis: e.code ?? "ERR" });
  slotBirak();
  process.exit(1);
});
cocuk.on("exit", (kod, sinyal) => {
  const cikis = kod ?? 1;
  deftereYaz({ wt: WT, adim: `ağır iş · ${ETIKET}`, sonuc: cikis === 0 ? "✅" : "❌", sn: (Date.now() - t1) / 1000, cikis: sinyal ?? cikis });
  slotBirak();
  process.exit(cikis);
});
