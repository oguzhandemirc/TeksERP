// =============================================================================
// MANDAL — `process.exit(` YENİ ÇAĞRI YOK: betik/bekçi doğal çıkışla biter
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts process_exit_kalibi
//
// ⭐ NEDEN VAR (2026-10-26): Node v26'da `process.exit` platform kapanışında arka plan
//    iş parçacığını bekler; o iş parçacığı eşzamanlı Sparkplug derlemesinde ana iş
//    parçacığının GC'sini bekliyorsa süreç ASILIR (`fd3b6fe00`: kimlik_sizintisi 120
//    koşuda 22 asılma → doğal çıkışla 200'de 0). Kalıp: sonucu bas → `process.exitCode = n`
//    → açık handle'ları kapat (`$disconnect` + `pool.end()`, zamanlayıcı, sunucu) → doğal çıkış.
//
// KAPSAM: `Teks-Erp/scripts/` altındaki her .ts/.mjs/.cjs/.js (izlenen + izlenmeyen,
//    .gitignore hariç). Sayılan şey AST'deki `process.exit(...)` ÇAĞRISIDIR — yorum ve
//    metin sayılmaz, `process.exitCode` sayılmaz.
// İSTİSNA: `lib/process-exit-istisnalari.json` — dosya başına bugünkü çağrı sayısı (uç
//    konumda olmayan erken çıkışlar, elle koşulan bakım betikleri). Taban YALNIZ AŞAĞI:
//    sayı tabanı aşarsa kırmızı; tabandan AZSA da kırmızı (tabanı düşür) — iki yönlü.
// KALICI SONDA (✓K3, her koşumda): bellekteki örnek kaynakta çağrı sayılır; yorumdaki ve
//    `exitCode` ataması sayılmaz.
// =============================================================================
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { git } from "./lib/git";

const KOK = join(__dirname, "..");
const ISTISNA_YOLU = join(__dirname, "lib", "process-exit-istisnalari.json");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

/** Kaynaktaki `process.exit(...)` çağrı sayısı (AST; yorum/metin sayılmaz). */
function exitCagrisiSay(ad: string, kaynak: string): number {
  const sf = ts.createSourceFile(ad, kaynak, ts.ScriptTarget.Latest, false, ad.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  let n = 0;
  const gez = (d: ts.Node): void => {
    if (ts.isCallExpression(d) && ts.isPropertyAccessExpression(d.expression) && d.expression.name.text === "exit"
      && ts.isIdentifier(d.expression.expression) && d.expression.expression.text === "process") n++;
    ts.forEachChild(d, gez);
  };
  gez(sf);
  return n;
}

function main(): void {
  console.log("§0 — kalıcı sonda");
  check("§0a sonda: çağrı sayılır", exitCagrisiSay("a.ts", "main().finally(() => process.exit(fail > 0 ? 1 : 0));") === 1);
  check("§0b sonda: yorum ve metin sayılmaz", exitCagrisiSay("b.ts", "// process.exit(1)\nconst s = 'process.exit(2)';") === 0);
  check("§0c sonda: exitCode ataması sayılmaz", exitCagrisiSay("c.ts", "process.exitCode = 1;") === 0);

  const dosyalar = git(["ls-files", "--cached", "--others", "--exclude-standard", "--", "scripts"], { cwd: KOK })
    .split("\n").filter((f) => /\.(ts|mjs|cjs|js)$/.test(f) && existsSync(join(KOK, f)));
  const taban = JSON.parse(readFileSync(ISTISNA_YOLU, "utf8")) as Record<string, number>;

  console.log("\n§1 — tarama");
  check("§1a körlük zemini: ≥ 900 betik tarandı", dosyalar.length >= 900, String(dosyalar.length));
  const sayim = new Map<string, number>();
  for (const f of dosyalar) {
    const n = exitCagrisiSay(f, readFileSync(join(KOK, f), "utf8"));
    if (n > 0) sayim.set(f, n);
  }
  const toplam = [...sayim.values()].reduce((a, b) => a + b, 0);
  const tabanToplam = Object.values(taban).reduce((a, b) => a + b, 0);
  console.log(`   ${sayim.size} dosyada ${toplam} çağrı · taban ${Object.keys(taban).length} dosya / ${tabanToplam} çağrı`);

  const yeni = [...sayim].filter(([f, n]) => n > (taban[f] ?? 0)).map(([f, n]) => `${f} ${taban[f] ?? 0}→${n}`);
  check("§2 ⭐ yeni `process.exit(` yok — `process.exitCode` + doğal çıkış kullan", yeni.length === 0, yeni.join(" · "));

  const dusen = Object.entries(taban).filter(([f, n]) => (sayim.get(f) ?? 0) < n && existsSync(join(KOK, f)))
    .map(([f, n]) => `${f} ${n}→${sayim.get(f) ?? 0}`);
  check("§3 taban güncel (azalan dosyada tabanı düşür — taban yalnız aşağı)", dusen.length === 0, dusen.join(" · "));

  const hayalet = Object.keys(taban).filter((f) => !existsSync(join(KOK, f)));
  check("§4 istisna listesinde silinmiş dosya yok", hayalet.length === 0, hayalet.join(" · "));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
