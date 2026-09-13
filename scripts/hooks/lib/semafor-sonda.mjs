#!/usr/bin/env node
// =============================================================================
// SEMAFOR SONDASI — `scripts/hooks/**` değişince kapı bunu koşar (zero-dep)
// =============================================================================
// Çalıştır: node scripts/hooks/lib/semafor-sonda.mjs      Çıkış: 0 geçti · 1 düştü
// Üç davranış, kendi geçici kökünde (gerçek semafora DOKUNMAZ):
//   ① ölü PID'li ve pid'siz slot süpürülür  ② al → pid dosyası bizim, bırak → yok
//   ③ kapasite doluyken bekler ve ⏳ basar; bir tutucu ölünce alır
// =============================================================================
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
for (const t of tutucular) t.kill();
rmSync(KOK, { recursive: true, force: true });

console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
