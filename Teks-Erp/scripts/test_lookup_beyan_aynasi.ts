// =============================================================================
// LOOKUP BEYANI ↔ ÇAĞRI AYNASI — beyan edilip hiç çağrılmayan çözücü YOK
// =============================================================================
// ⭐ NEDEN VAR (ölçüldü 2026-09-14): `LOOKUP_SOURCES` **12 entity** beyan
// ediyordu, çağrılar yalnız **8**'ini kullanıyordu. Kalan dördü (`machine` ·
// `qualityGrade` · `defectType` · `returnReason`) yalnız KENDİ adaptörlerinde
// `entity:`/`nameGuard.model` olarak geçiyordu; hiçbir adaptör onlara REFERANS
// vermiyordu ⇒ *okunmayan mekanizma = çıkışsız kapının veri tarafı.*
// 1e hükmü (şık b): dördü SİLİNDİ, bu kapı yenisinin eklenmesini önler.
//
// ⚠️ VE BİR YAN SONUÇ: `qualityGrade` referansı hiç olmadığı için "içe
// aktarımda yetim kalite kodu" senaryosu OLUŞAMIYORDU — çakılı-varsayım
// taramasının C3 kalemi bu yüzden hayali çıktı (top adaptörü de yok: 18
// adaptörün hiçbiri top değil).
//
// ⚠️ YÜKLEMİN YÖNÜ BEYAN EDİLMİŞTİR: dinamik çağrılarda (entity bir DEĞİŞKEN)
// çözüm bilerek CÖMERTTİR — çağrının üstündeki pencerede geçen her beyan
// anahtarı "kullanılmış" sayılır. ⇒ Yanılma yönü TEK: "kullanılan" kümesi
// olduğundan GENİŞ, "çağrılmayan" DAR çıkar. Bu kapı bu yüzden YANLIŞ POZİTİF
// üretmez; kaçırabilir. Sert taban 0 ancak bu yönle meşrudur.
//
// Koşum: npx tsx scripts/test_lookup_beyan_aynasi.ts   (DB GEREKMEZ)
// =============================================================================
import { execFileSync } from "node:child_process";
import { git } from "./lib/git";
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const KOK = path.resolve(__dirname, "..");
const REPO = path.resolve(KOK, "..");
const LOOKUP = "Teks-Erp/src/services/import/import-lookup.ts";
/** Çağrının üstünde demet tablosu aranacak pencere (karakter). */
export const DINAMIK_PENCERE = 1200;

/** `LOOKUP_SOURCES` bloğunun ÜST DÜZEY anahtarları (iç içe nesneler sayılmaz). */
export function beyanAnahtarlari(kaynak: string): string[] {
  const bas = kaynak.indexOf("LOOKUP_SOURCES");
  if (bas < 0) return [];
  const acilis = kaynak.indexOf("{", bas);
  let derinlik = 0;
  let son = acilis;
  for (let i = acilis; i < kaynak.length; i++) {
    if (kaynak[i] === "{") derinlik++;
    else if (kaynak[i] === "}") {
      derinlik--;
      if (derinlik === 0) {
        son = i;
        break;
      }
    }
  }
  const govde = kaynak.slice(acilis + 1, son);
  const out: string[] = [];
  let d = 0;
  for (const m of govde.matchAll(/[{}]|(^|\n)\s*([a-zA-Z][a-zA-Z0-9]*)\s*:/g)) {
    if (m[0] === "{") d++;
    else if (m[0] === "}") d--;
    else if (d === 0 && m[2]) out.push(m[2]);
  }
  return out;
}

export type Cagrilar = { statik: Set<string>; dinamik: Set<string>; olculemedi: string[] };

/**
 * Çağrılardaki entity argümanı. İlk argüman literalse STATİK; değişkense
 * çağrının üstündeki pencerede beyan anahtarları aranır (DİNAMİK, cömert);
 * hiçbiri bulunamazsa ÖLÇÜLEMEDİ — *"araç yok" ile "ihlal yok" aynı değildir.*
 */
export function cagrilar(kaynaklar: Array<{ ad: string; metin: string }>, beyan: string[]): Cagrilar {
  const statik = new Set<string>();
  const dinamik = new Set<string>();
  const olculemedi: string[] = [];
  for (const { ad, metin } of kaynaklar) {
    for (const m of metin.matchAll(/\bresolveReference(?:List)?\s*\(/g)) {
      let d = 0;
      let i = m.index + m[0].length - 1;
      let kapanis = i;
      for (; i < metin.length; i++) {
        if (metin[i] === "(") d++;
        else if (metin[i] === ")") {
          d--;
          if (d === 0) {
            kapanis = i;
            break;
          }
        }
      }
      const argListesi = metin.slice(m.index + m[0].length, kapanis);
      const virgul = argListesi.indexOf(",");
      const ilk = (virgul < 0 ? argListesi : argListesi.slice(0, virgul)).trim();
      const satir = metin.slice(0, m.index).split("\n").length;
      const lit = /^["'`]([a-zA-Z][a-zA-Z0-9]*)["'`]$/.exec(ilk);
      if (lit) {
        statik.add(lit[1]);
        continue;
      }
      const oncesi = metin.slice(Math.max(0, m.index - DINAMIK_PENCERE), m.index);
      const adaylar = [...new Set([...oncesi.matchAll(/["'`]([a-zA-Z][a-zA-Z0-9]*)["'`]/g)].map((x) => x[1]))].filter(
        (x) => beyan.includes(x),
      );
      if (adaylar.length > 0) for (const e of adaylar) dinamik.add(e);
      else olculemedi.push(`${ad}:${satir} → ${ilk.slice(0, 40)}`);
    }
  }
  return { statik, dinamik, olculemedi };
}

function main(): void {
  console.log("\n=== LOOKUP beyanı ↔ çağrı aynası ===\n");
  const lookupKaynak = readFileSync(path.join(REPO, LOOKUP), "utf8");
  const beyan = beyanAnahtarlari(lookupKaynak);
  const dosyalar = git(["ls-files", "--cached", "--others", "--exclude-standard", "Teks-Erp/src"], { cwd: REPO })
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".ts") && f !== LOOKUP);
  const kaynaklar = dosyalar.map((f) => ({ ad: f.replace("Teks-Erp/src/", ""), metin: readFileSync(path.join(REPO, f), "utf8") }));
  const c = cagrilar(kaynaklar, beyan);
  const kullanilan = new Set([...c.statik, ...c.dinamik]);

  // ── §0 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  console.log("§0 — körlük zemini");
  check("§0a beyan okundu", beyan.length > 0, `${beyan.length} entity`);
  check("§0b çağrı bulundu", kullanilan.size > 0, `${kullanilan.size} entity kullanılıyor`);
  console.log("");

  // ── §1 SERT — beyan edilip çağrılmayan YOK (taban 0) ──────────────────────
  console.log("§1 — beyanlı ama ÇAĞRILMAYAN entity (SERT, taban 0)");
  const cagrilmayan = beyan.filter((b) => !kullanilan.has(b));
  check(
    "§1 ⭐ her beyan edilen entity ÇAĞRILIYOR",
    cagrilmayan.length === 0,
    cagrilmayan.length === 0
      ? `${beyan.length} beyan, hepsi çağrılıyor`
      : `${cagrilmayan.join(", ")} ⇒ ya bir adaptör REFERANS versin ya beyan SİLİNSİN ` +
          "(çağrısız çözücü = okunmayan mekanizma). ⛔ Bu kapı borçsuz kuruldu, muafiyeti YOK",
  );
  check(
    "§1b çağrılıyor ama BEYANDA yok (çalışma anında 'Bilinmeyen referans türü')",
    [...kullanilan].every((k) => beyan.includes(k)),
    [...kullanilan].filter((k) => !beyan.includes(k)).join(", ") || "yok",
  );
  // ⚠️ ÜÇÜNCÜ SONUÇ: ölçülemeyen çağrı varsa SESSİZ kalmaz.
  if (c.olculemedi.length > 0) {
    console.log(`⏭ §1c ${c.olculemedi.length} çağrının entity'si ÖLÇÜLEMEDİ (değişken, pencerede beyan anahtarı yok):`);
    for (const o of c.olculemedi) console.log(`     ${o}`);
  }
  console.log("");

  // ── §2 SONDALAR ───────────────────────────────────────────────────────────
  console.log("§2 — sondalar");
  check(
    "§2a ⭐ üst düzey anahtar okunur, İÇ İÇE nesne anahtarı sayılmaz",
    beyanAnahtarlari('export const LOOKUP_SOURCES = {\n  a: { model: "x", codeField: "code" },\n  b: { model: "y" },\n};').join() === "a,b",
  );
  const B = ["a", "b", "c"];
  check(
    "§2b ⭐ literal ilk argüman STATİK sayılır",
    cagrilar([{ ad: "t", metin: 'resolveReference("a", v, ctx)' }], B).statik.has("a"),
  );
  check(
    "§2c ⭐ değişken argüman + üstte demet tablosu ⇒ DİNAMİK çözülür",
    cagrilar([{ ad: "t", metin: 'const T = [["k","b"]] as const;\nresolveReferenceList(entity, v, ctx)' }], B).dinamik.has("b"),
    "cömert yön: kaçırmaz, fazla sayar",
  );
  check(
    "§2d ⭐ değişken argüman + üstte HİÇBİR beyan anahtarı ⇒ ÖLÇÜLEMEDİ (sessiz değil)",
    cagrilar([{ ad: "t", metin: "resolveReference(entity, v, ctx)" }], B).olculemedi.length === 1,
  );
  check(
    "§2e beyanda olmayan literal STATİK'e girer (§1b onu yakalar)",
    cagrilar([{ ad: "t", metin: 'resolveReference("yok", v, ctx)' }], B).statik.has("yok"),
  );
  console.log("");

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
