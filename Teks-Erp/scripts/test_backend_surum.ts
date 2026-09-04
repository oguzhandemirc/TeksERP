// =============================================================================
// Bekçi: backend sürüm numarası
// =============================================================================
// Çalıştır: npx tsx scripts/test_backend_surum.ts
//
// Backend sürümü 2026-09-04'e kadar `package.json`da ELLE duruyordu ve aylarca
// 2.9.0'da sabit kaldı: `/health` her kurulumda aynı sayıyı basıyordu, "sunucuda
// hangi kod var" sorusunun tek cevabı commit kısaltmasıydı. Panel/tablet zaten
// yama hanesini otomatik artırıyordu; backend o hattın dışındaydı.
// =============================================================================
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const KOK = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(KOK, "scripts", "backend-surum.mjs");
const PKG = path.join(KOK, "Teks-Erp", "package.json");

let gecti = 0;
let kaldi = 0;
function check(ad: string, ok: boolean, ek = ""): void {
  if (ok) { gecti++; console.log(`✅ ${ad}${ek ? ` — ${ek}` : ""}`); }
  else { kaldi++; console.log(`❌ ${ad}${ek ? ` — ${ek}` : ""}`); }
}
const kos = (...a: string[]): string =>
  execFileSync("node", [SCRIPT, ...a], { cwd: KOK, encoding: "utf8" }).trim();

console.log("=== §1 Körlük zemini ===");
check("hesaplayıcı dosyası var", fs.existsSync(SCRIPT));
const pkgSurum = JSON.parse(fs.readFileSync(PKG, "utf8")).version as string;
check("package.json sürüm okunuyor", /^\d+\.\d+\.\d+$/.test(pkgSurum), pkgSurum);

console.log("\n=== §2 Yama hanesi ARTAR ===");
const sonraki = kos();
check("çıktı x.y.z biçiminde", /^\d+\.\d+\.\d+$/.test(sonraki), sonraki);
const [a1, b1, c1] = pkgSurum.split(".").map(Number);
const [a2, b2, c2] = sonraki.split(".").map(Number);
check(
  "yalnız YAMA hanesi arttı (küçük/büyük hane KARARDIR, elle verilir)",
  a2 === a1 && b2 === b1 && c2 === c1 + 1,
  `${pkgSurum} → ${sonraki}`,
);

console.log("\n=== §3 Elle sürüm KAZANIR ===");
check("`--surum 4.1.2` verilince o basılır", kos("--surum", "4.1.2") === "4.1.2");

console.log("\n=== §4 `--uygula` package.json'ı BOZMADAN yazar ===");
// ⚠️ Asıl risk regex'in dosyayı bozması: JSON kırılırsa backend HİÇ açılmaz.
const yedek = fs.readFileSync(PKG, "utf8");
try {
  kos("--uygula", "--surum", "9.9.9");
  const ham = fs.readFileSync(PKG, "utf8");
  check("dosya hâlâ geçerli JSON", (() => { try { JSON.parse(ham); return true; } catch { return false; } })());
  check("sürüm yazıldı", JSON.parse(ham).version === "9.9.9");
  // Yalnız version satırı değişmeli — script alanları vb. korunmalı.
  const oncekiScripts = JSON.stringify(JSON.parse(yedek).scripts);
  check("`scripts` bloğu bozulmadı", JSON.stringify(JSON.parse(ham).scripts) === oncekiScripts);
} finally {
  fs.writeFileSync(PKG, yedek);
}
check("yedek geri yüklendi", JSON.parse(fs.readFileSync(PKG, "utf8")).version === pkgSurum);

console.log("\n=== §5 Paketleme script'i bunu ÇAĞIRIYOR ===");
// Hesaplayıcı doğru olup çağrılmazsa sürüm yine sabit kalır — 2026-08-25
// "kutu var / uç yok" sınıfı. Bu yüzden metin taranıyor.
const paketle = fs.readFileSync(path.join(KOK, "deploy", "paketle.ps1"), "utf8");
check("paketle.ps1 hesaplayıcıyı çağırıyor", paketle.includes("backend-surum.mjs"));
check("`--uygula` ile package.json'a yazıyor", /backend-surum\.mjs[\s\S]{0,80}--uygula/.test(paketle));
check("paket DOĞRULANDIKTAN sonra etiketliyor", /--etiketle/.test(paketle));
check(
  "elle sürüm için `-Surum` parametresi var",
  /\[string\]\$Surum/.test(paketle),
);

console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
process.exit(kaldi > 0 ? 1 : 0);
