// =============================================================================
// BEKÇİ — MÜŞTERİ ADI KODA GÖMÜLMEZ (tripwire, DB'siz)
// =============================================================================
// Koşum: npx tsx scripts/run-all-tests.ts musteri_adi_kodda_yok
//
// Tek gövde, çok fabrika: ekrandaki/belgedeki firma adı bağlanılan sunucunun
// `company.name` ayarından gelir, yedek nötr "TeksERP". Bir müşterinin adı
// ürün kodunda LİTERAL olarak durursa bütün kurulumlara sızar (2026-09-28:
// test sunucusuna bağlanan panel giriş ekranında fabrikanın adını gösteriyordu).
//
// Aranan adlar ELLE yazılmaz: kanal kayıt defterindeki (`deploy/kanallar.json`)
// her ÜRETİM kanalının `ad`ı ve ilk iki kelimesi (kök). Katlama: aksan/büyük
// harf duyarsız ("ŞAHİN" ≡ "sahin"), boşluk normalize.
//
// KAPSAM: yalnız ürün kodu (Teks-Erp/src · Electron/src · Electron/electron ·
// Electron/shared · mobil/src · mobil/App.tsx), yalnız LİTERALLER (string ·
// şablon · JSX metni) — yorumlar değil. Testler, fikstürler, migration'lar
// (değişmez geçmiş) ve sürüm notları kapsam DIŞIDIR. Kanal kodu (`adnansahin`)
// bir dağıtım kimliğidir, ad değildir — boşluksuz olduğu için eşleşmez.
//
// İstisna BEYANLIDIR (`ISTISNA`: "yol::literal" → gerekçe) ve iki yönlüdür:
// eşleşmeyen (ölü) istisna da KIRMIZI. Bugün boştur.
//
// NEGATİF SONDA (ölçüldü 2026-09-28): Electron/src/pages/Login/LoginHero.tsx'e
//   literal ad geri konunca → 1 ❌ (§2 ihlal) · geri alınınca → yeşil (pozitif).
//   ISTISNA'ya eşleşmeyen satır eklenince → 1 ❌ (§3 ölü istisna).
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const REPO = path.resolve(__dirname, "../..");
const KOKLER = ["Teks-Erp/src", "Electron/src", "Electron/electron", "Electron/shared", "mobil/src", "mobil/App.tsx"];
const TEST_DOSYASI = /(\.test\.|\.spec\.|\/__tests__\/|^Electron\/src\/test\/|^mobil\/src\/test\/)/;

/** Beyanlı istisna: "göreli/yol::literal parçası" → gerekçe. */
const ISTISNA: Record<string, string> = {};

function katla(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function adlar(): string[] {
  const kayit = JSON.parse(fs.readFileSync(path.join(REPO, "deploy/kanallar.json"), "utf8")) as {
    kanallar: Record<string, { tur: string; ad: string }>;
  };
  const out = new Set<string>();
  for (const k of Object.values(kayit.kanallar)) {
    if (k.tur !== "uretim") continue;
    const tam = katla(k.ad);
    out.add(tam);
    const kok = tam.split(" ").slice(0, 2).join(" ");
    if (kok.includes(" ")) out.add(kok);
  }
  return [...out];
}

function dosyalar(kok: string): string[] {
  const mutlak = path.join(REPO, kok);
  if (!fs.existsSync(mutlak)) return [];
  if (fs.statSync(mutlak).isFile()) return [kok];
  const out: string[] = [];
  const yuru = (d: string): void => {
    for (const e of fs.readdirSync(path.join(REPO, d), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const g = `${d}/${e.name}`;
      if (e.isDirectory()) yuru(g);
      else if (/\.(ts|tsx|mts|cts)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(g);
    }
  };
  yuru(kok);
  return out;
}

function literaller(dosya: string): string[] {
  const src = fs.readFileSync(path.join(REPO, dosya), "utf8");
  const sf = ts.createSourceFile(dosya, src, ts.ScriptTarget.Latest, true, dosya.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const gez = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    else if (ts.isJsxText(n)) out.push(n.text);
    n.forEachChild(gez);
  };
  gez(sf);
  return out;
}

function main(): void {
  const aranan = adlar();
  console.log(`Aranan (kanal kaydından, katlanmış): ${aranan.map((a) => `"${a}"`).join(" · ")}`);
  check("§1a kanal kaydı en az bir üretim adı verdi (körlük zemini)", aranan.length > 0);

  const ihlal: string[] = [];
  const kullanilanIstisna = new Set<string>();
  let dosyaSay = 0,
    literalSay = 0;
  for (const kok of KOKLER) {
    const liste = dosyalar(kok).filter((f) => !TEST_DOSYASI.test(f));
    check(`§1b ${kok} tarandı`, liste.length > 0, `${liste.length} dosya`);
    for (const f of liste) {
      dosyaSay++;
      for (const lit of literaller(f)) {
        literalSay++;
        const k = katla(lit);
        if (!aranan.some((a) => k.includes(a))) continue;
        const anahtar = Object.keys(ISTISNA).find((i) => {
          const [yol, parca] = i.split("::");
          return yol === f && lit.includes(parca ?? "");
        });
        if (anahtar) kullanilanIstisna.add(anahtar);
        else ihlal.push(`${f}: "${lit.trim().slice(0, 80)}"`);
      }
    }
  }
  console.log(`Taranan: ${dosyaSay} dosya · ${literalSay} literal`);
  check("§2 ürün kodunda müşteri adı literali YOK", ihlal.length === 0, ihlal.length ? `\n   ${ihlal.join("\n   ")}` : "");
  const olu = Object.keys(ISTISNA).filter((i) => !kullanilanIstisna.has(i));
  check("§3 ölü istisna yok (iki yönlü)", olu.length === 0, olu.join(", "));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
