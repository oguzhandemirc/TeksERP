#!/usr/bin/env node
// =============================================================================
// SEMAFOR SONDASI — `scripts/hooks/**` değişince kapı bunu koşar (zero-dep)
// =============================================================================
// Çalıştır: node scripts/hooks/lib/semafor-sonda.mjs      Çıkış: 0 geçti · 1 düştü
// Dört davranış, kendi geçici kökünde (gerçek semafora ve deftere DOKUNMAZ):
//   ① ölü PID'li ve pid'siz slot süpürülür  ② al → pid dosyası bizim, bırak → yok
//   ③ kapasite doluyken bekler ve ⏳ basar; bir tutucu ölünce alır  ④ agir-is.mjs sarmalayıcısı
// =============================================================================
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KOK = mkdtempSync(join(tmpdir(), "tekserp-semafor-sonda-"));
process.env.TEKSERP_SEMAFOR_KOK = KOK;
const { KAPASITE, slotAl, supur } = await import("./semafor.mjs");
const BURASI = dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
const check = (label, ok, detay = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
};

// ① süpürme
mkdirSync(join(KOK, "slot-0"));
writeFileSync(join(KOK, "slot-0", "pid"), "999999\n");
mkdirSync(join(KOK, "slot-1")); // pid'siz — yarım kalmış giriş
const canli = supur();
check("① ölü PID'li ve pid'siz slot süpürüldü", canli === 0 && !existsSync(join(KOK, "slot-0")) && !existsSync(join(KOK, "slot-1")), `canlı ${canli}`);

// ② al / bırak
const birak = slotAl(() => {});
const pidDosyasi = join(KOK, "slot-0", "pid");
check("② slot alındı, pid bizim", existsSync(pidDosyasi) && readFileSync(pidDosyasi, "utf8").trim() === String(process.pid));
birak();
check("② bırakıldı, slot yok", !existsSync(join(KOK, "slot-0")));

// ③ dolu semafor: KAPASITE canlı tutucu → çocuk süreç bekler, ⏳ basar; biri ölünce alır
const tutucular = [];
for (let i = 0; i < KAPASITE; i++) {
  const t = spawn("sleep", ["60"], { stdio: "ignore" });
  tutucular.push(t);
  mkdirSync(join(KOK, `slot-${i}`));
  writeFileSync(join(KOK, `slot-${i}`, "pid"), `${t.pid}\n`);
}
const cocuk = spawn(
  process.execPath,
  ["--input-type=module", "-e", `const m = await import(${JSON.stringify(join(BURASI, "semafor.mjs"))}); const t = Date.now(); const b = m.slotAl((s) => process.stdout.write(s)); process.stdout.write("ALINDI " + Math.round((Date.now() - t) / 1000) + "\\n"); b();`],
  { env: { ...process.env, TEKSERP_SEMAFOR_KOK: KOK }, stdio: ["ignore", "pipe", "inherit"] },
);
let cikti = "";
cocuk.stdout.on("data", (d) => (cikti += d));
await new Promise((r) => setTimeout(r, 3000));
const bekliyor = cocuk.exitCode === null;
tutucular[1].kill();
const sonuc = await new Promise((r) => {
  const z = setTimeout(() => r("ZAMAN AŞIMI"), 15_000);
  cocuk.on("exit", (c) => {
    clearTimeout(z);
    r(c);
  });
});
check("③ dolu semaforda bekledi ve ⏳ bastı", bekliyor && /⏳ kapı semaforu: \d+ kapı önde/.test(cikti), cikti.split("\n")[0]?.slice(0, 80));
check("③ tutucu ölünce aldı", sonuc === 0 && /ALINDI \d+/.test(cikti), String(cikti.match(/ALINDI \d+/)?.[0] ?? sonuc));
// Tutucular ÖLÜNCEYE kadar beklenir (kill asenkron; canlı sanılan slot süpürülmez), sonra süpür.
await Promise.all(tutucular.map((t) => new Promise((r) => (t.exitCode !== null || t.signalCode ? r() : (t.on("exit", r), t.kill())))));
supur();
const slotSayisi = () => readdirSync(KOK).filter((a) => a.startsWith("slot-")).length;

// ④ ağır iş sarmalayıcısı (scripts/agir-is.mjs): slotu bu havuzdan alır, çocuğun çıkış
//    kodunu AYNEN taşır, deftere "semafor bekleme" + "ağır iş" satırı düşer. Sonda kendi
//    defter yoluna yazar (gerçek deftere dokunmaz). Çocuk bilerek 3 ile çıkar: 0/1 dışı
//    bir kod, "geçti/düştü"ye indirgenmediğini de ölçer.
const SARMAL = join(BURASI, "..", "..", "agir-is.mjs");
const defterYolu = join(KOK, "defter.tsv");
const sarmal = spawnSync(
  process.execPath,
  [SARMAL, "--", process.execPath, "-e", `const s = require("fs").readdirSync(process.env.TEKSERP_SEMAFOR_KOK).filter(a => a.startsWith("slot-")); process.stdout.write("SLOT " + s.length); process.exit(3)`],
  { env: { ...process.env, TEKSERP_SEMAFOR_KOK: KOK, TEKSERP_KAPI_DEFTERI: defterYolu }, encoding: "utf8", timeout: 20_000 },
);
const defter = existsSync(defterYolu) ? readFileSync(defterYolu, "utf8") : "";
check("④ sarmalayıcı: çocuk slot varken koştu ve çıkış kodu AYNEN taşındı (3)", sarmal.status === 3 && /SLOT 1/.test(sarmal.stdout), `çıkış=${sarmal.status} stdout=${JSON.stringify(sarmal.stdout)}`);
check("④ sarmalayıcı: slot çıkışta bırakıldı", slotSayisi() === 0, `kalan slot ${slotSayisi()}`);
check(
  "④ sarmalayıcı: deftere 'semafor bekleme · ağır N' ✅ + 'ağır iş' ❌ (çıkış 3) satırları düştü",
  /\tsemafor bekleme · ağır -?\d+\t✅\t/.test(defter) && /\tağır iş · [^\t]*\t❌\t[\d.]+\t3\t/.test(defter),
  JSON.stringify(defter.split("\n").filter(Boolean).map((l) => l.split("\t").slice(2, 6).join("|"))),
);
const bos = spawnSync(process.execPath, [SARMAL], { env: { ...process.env, TEKSERP_SEMAFOR_KOK: KOK }, encoding: "utf8" });
check("④ sarmalayıcı: komutsuz çağrı 2 ile düşer ve slot almaz", bos.status === 2 && slotSayisi() === 0, `çıkış=${bos.status}`);

rmSync(KOK, { recursive: true, force: true });

console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
