// =============================================================================
// BEKÇİ — KOMUT KAPISI YASAĞI KENDİ KOMUTUNDA ARIYOR MU
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bash_guard_scope
//
// ⭐ NEDEN VAR (2026-09-13): `scripts/claude-hooks/bash-guard.mjs` yasakları TÜM
//    KOMUT SATIRINDA arıyordu. Vaka:
//      git push -q origin main && … && stat -f '%m %N' …
//      ⛔ `git push --force` YASAK
//    `--force` YOKTU: yüklem `git push`u ve BAŞKA bir komuttaki `-f`i aynı satırda
//    görüp birleştirdi (`[^\n]*` satırın tamamını yutuyor). Kullanıcı komutu ikiye
//    bölünce geçti.
//
// ⚠️ YANLIŞ KIRMIZI DA BİR ARIZADIR ve maliyeti ölçülebilir: kapının kendi mesajı
//    kaçışı (`TEKSERP_HOOK_SKIP=1`) yazıyor ⇒ yanlış pozitif üreten bir kapı
//    KAÇIŞI NORMALLEŞTİRİR. "Kapı yanlış durdurdu" ile "kapı yanlış geçirdi"
//    farklı yönler ama aynı sınıf: SINIRINI BEYAN ETMEYEN DESEN.
//
// ⚠️ BU BEKÇİ İKİ YÖNÜ DE ÖLÇER. Yalnız "yanlış pozitif gitti" ölçülseydi, yasağı
//    tamamen silmek de bekçiyi yeşil yapardı — gerçek ihlallerin HÂLÂ kırmızı
//    olduğu her yasak için ayrıca ölçülür.
//
// ⚠️ BÖLME KEŞKİNLEŞTİRİR, YALNIZ DARALTMAZ: `&&`/`;`/`|` ile ayrılmış parçalara
//    bakmak iki yanlış NEGATİFİ de kapatır (aşağıda §3).
// =============================================================================
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const KAPI = join(__dirname, "..", "..", "scripts", "claude-hooks", "bash-guard.mjs");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`);
  }
}

/** Kapıyı gerçek hook sözleşmesiyle çağırır; çıkış 2 = DURDURDU. */
function kapiKos(command: string): { durdurdu: boolean; mesaj: string } {
  const r = spawnSync("node", [KAPI], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    encoding: "utf8",
    // ⚠️ Kaçış değişkeni MİRAS ALINMAMALI: ortamda `TEKSERP_HOOK_SKIP=1` varsa
    // kapı ilk satırda çıkar ve bekçi VAKUMEN yeşil olur.
    env: { ...process.env, TEKSERP_HOOK_SKIP: "0" },
  });
  return { durdurdu: r.status === 2, mesaj: `${r.stderr ?? ""}` };
}

function durdurmali(label: string, command: string): void {
  const { durdurdu, mesaj } = kapiKos(command);
  check(label, durdurdu, durdurdu ? mesaj.split("\n")[0]!.slice(0, 70) : "GEÇTİ (durdurmalıydı)");
}
function gecmeli(label: string, command: string): void {
  const { durdurdu, mesaj } = kapiKos(command);
  check(label, !durdurdu, durdurdu ? `DURDURDU: ${mesaj.split("\n")[0]!.slice(0, 70)}` : "geçti");
}

console.log("=== Komut kapısı — yasak kendi komutunda mı aranıyor ===\n");

// KÖRLÜK ZEMİNİ: kapı hiç koşmuyorsa her "geçmeli" yeşil olur.
const zemin = kapiKos("prisma migrate reset");
check("§0 körlük zemini: kapı GERÇEKTEN koşuyor ve durdurabiliyor", zemin.durdurdu, zemin.mesaj.split("\n")[0]!.slice(0, 60));

console.log("\n§1 — GERÇEK ihlaller HÂLÂ kırmızı (bölme yasağı öldürmedi)");
durdurmali("§1a `git push --force`", "git push --force origin main");
durdurmali("§1b `git push -f`", "git push -f origin main");
durdurmali("§1c `prisma migrate reset`", "npx prisma migrate reset");
durdurmali("§1d WHERE'siz `DELETE FROM`", 'psql -c "DELETE FROM rolls"');
durdurmali("§1e `TRUNCATE`", 'psql -c "TRUNCATE rolls"');
durdurmali("§1f zincirin İKİNCİ halkasındaki ihlal de görülür", "echo ok && git push --force");

console.log("\n§2 — YANLIŞ POZİTİFLER gitti (yasak başka komutun argümanına takılmıyor)");
gecmeli(
  "§2a ⭐ vaka: `git push -q` + başka komutta `-f` (bildirilen yanlış kırmızı)",
  "git push -q origin main && stat -f '%m %N' /tmp/x",
);
gecmeli("§2b `git push` + sonraki komutta `--force` kelimesi", "git push origin main && echo '--force kullanma'");
gecmeli("§2c WHERE'li DELETE", 'psql -c "DELETE FROM rolls WHERE id = 1"');

console.log("\n§3 — BÖLME İKİ YANLIŞ NEGATİFİ DE KAPATTI (keskinleşme, gevşeme değil)");
durdurmali(
  "§3a ⭐ `prisma migrate dev` + ALAKASIZ `--create-only` artık susturamıyor",
  "npx prisma migrate dev && echo --create-only",
);
durdurmali(
  "§3b ⭐ çok ifadeli SQL'de WHERE'siz ilk DELETE artık görülüyor",
  'psql -c "DELETE FROM a; DELETE FROM b WHERE c = 1"',
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
