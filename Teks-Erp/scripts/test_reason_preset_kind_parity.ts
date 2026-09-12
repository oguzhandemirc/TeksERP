// =============================================================================
// SEBEP ÖN AYARI — "kind" KÜMESİ EŞİTLİĞİ (K4)
// =============================================================================
// `ReasonPresetKind` bugün ON İKİ ayrı yerde yazılı: Prisma enum'u, backend'in
// üç tablosu, panelin üçü, tabletin beşi. Hiçbir derleyici bunları birbirine
// bağlamıyor — üç ayrı TypeScript projesi, aralarında paylaşılan tip YOK — yani
// enum'a değer eklemek DERLEMEYİ KIRMAZ, yalnız uzaktaki aynayı sessizce eksik
// bırakır. Ölçüldü (2026-09-12): `ORDER_CANCEL` 2026-08-26'da eklendi, tabletin
// union'ına hiç girmedi; sunucu o satırı `/reason-presets` yükünde GÖNDERDİĞİ
// için tabletin tipi bir YALAN — `BUILTIN[kind]` ve `KIND_LABELS[kind]` o satır
// için `undefined` döner ve ekran sebebi adsız çizer.
//
// Bölümler:
//   §1 Körlük zemini — beş dosya da bulundu ve ayrıştırıcı gerçekten değer
//      buldu (boş küme ile "eşit" demek en sessiz yalandır).
//   §2 Kaynak kümeleri basılır (yeşilken de görünür: kapsam ölçülebilsin).
//   §3 Her kümenin Prisma enum'una EŞİT olması — eksik ve fazla ayrı raporlanır.
//   §4 İki yönlü: hiçbir ayna enum'da olmayan bir değer taşıyamaz.
//   §5 `KIND_STORES_TEXT` DEĞER eşitliği (yalnız anahtar değil) — bir kind
//      sunucuda metin saklarken tablette saklamıyorsa satır metinsiz gider.
//   §6 Negatif sonda (bellek içi): ayrıştırıcıların gerçekten kırmızı verdiği
//      ölçülür — eksik değer, fazla değer ve bozuk blok.
// =============================================================================

import { readFileSync } from "fs";
import { join } from "path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const SEMA = join(__dirname, "../prisma/schema.prisma");
const BACKEND = join(__dirname, "../src/constants/reason-presets.ts");
const PANEL = join(__dirname, "../../Electron/src/pages/ReasonPresets/service.ts");
const TABLET_SERVIS = join(__dirname, "../../mobil/src/services/reasonPreset.service.ts");
const TABLET_HOOK = join(__dirname, "../../mobil/src/hooks/useReasonPresets.ts");

// ── Ayrıştırıcılar — hepsi SAF, §6 onları bellek içi metinle sınar ────────────

/** Yorumları siler: süslü parantez sayımı yorumdaki `{`'a takılmasın. */
function yorumsuz(metin: string): string {
  return metin.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Bildirimin GÖVDESİ `=`'den sonra başlar. Tip açıklaması gövdeden önce gelir ve
 * kendi parantezini taşır (`KIND_TABS: {...}[] = [...]`) — `=`'i atlamayan bir
 * arama tipin boş `[]`'ini gövde sanır ve SIFIR anahtar bulur (ölçüldü).
 */
function govdeBasi(temiz: string, basla: number, acilisKarakteri: string): number {
  const satirSonu = temiz.indexOf("\n", basla);
  const satir = temiz.slice(basla, satirSonu < 0 ? temiz.length : satirSonu);
  // Atama işareti bildirim SATIRINDA aranır: tip açıklamasının kendi parantezi
  // `=`'ten ÖNCE gelebilir (`KIND_TABS: {...}[] = [`), o yüzden "ilk parantez"
  // ölçütü yanlıştır. `=` yoksa (enum, fonksiyon) ilk parantez zaten doğrudur.
  const esit = satir.search(/[^=!<>]=[^=>]/);
  const aramaBasi = esit >= 0 ? basla + esit + 1 : basla;
  return temiz.indexOf(acilisKarakteri, aramaBasi);
}

/** `ad` ile başlayan bildirimin `{...}` gövdesini dengeleyerek alır. */
export function blokAl(metin: string, ad: string): string | null {
  const temiz = yorumsuz(metin);
  const basla = temiz.indexOf(ad);
  if (basla < 0) return null;
  const acilis = govdeBasi(temiz, basla, "{");
  if (acilis < 0) return null;
  let derinlik = 0;
  for (let i = acilis; i < temiz.length; i += 1) {
    if (temiz[i] === "{") derinlik += 1;
    else if (temiz[i] === "}") {
      derinlik -= 1;
      if (derinlik === 0) return temiz.slice(acilis + 1, i);
    }
  }
  return null;
}

/** Prisma `enum X { ... }` — çıplak tanımlayıcı satırları. */
export function enumDegerleri(metin: string, ad: string): string[] {
  const blok = blokAl(metin, `enum ${ad}`);
  if (!blok) return [];
  return blok
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => /^[A-Z][A-Z0-9_]*$/.test(s));
}

/** `export type X = | 'A' | 'B';` — tırnaklı literaller. */
export function unionDegerleri(metin: string, ad: string): string[] {
  const temiz = yorumsuz(metin);
  const basla = temiz.indexOf(`type ${ad} =`);
  if (basla < 0) return [];
  const son = temiz.indexOf(";", basla);
  if (son < 0) return [];
  const govde = temiz.slice(basla, son);
  return [...govde.matchAll(/['"]([A-Z][A-Z0-9_]*)['"]/g)].map((m) => m[1] as string);
}

/** `const X = { A: ..., B: ... }` — YALNIZ birinci seviye anahtarlar. */
export function haritaAnahtarlari(metin: string, ad: string): string[] {
  const blok = blokAl(metin, ad);
  if (!blok) return [];
  const bulunan: string[] = [];
  let derinlik = 0;
  for (const satir of blok.split("\n")) {
    const eslesme = derinlik === 0 ? /^\s*([A-Z][A-Z0-9_]*)\s*:/.exec(satir) : null;
    if (eslesme) bulunan.push(eslesme[1] as string);
    for (const ch of satir) {
      if (ch === "{" || ch === "[") derinlik += 1;
      else if (ch === "}" || ch === "]") derinlik -= 1;
    }
  }
  return bulunan;
}

/** `const X = [{ kind: "A" }, ...]` — dizi içindeki `kind:` alanları. */
export function kindAlanlari(metin: string, ad: string): string[] {
  const temiz = yorumsuz(metin);
  const basla = temiz.indexOf(ad);
  if (basla < 0) return [];
  const acilis = govdeBasi(temiz, basla, "[");
  if (acilis < 0) return [];
  let derinlik = 0;
  let son = -1;
  for (let i = acilis; i < temiz.length; i += 1) {
    if (temiz[i] === "[") derinlik += 1;
    else if (temiz[i] === "]") {
      derinlik -= 1;
      if (derinlik === 0) {
        son = i;
        break;
      }
    }
  }
  if (son < 0) return [];
  const govde = temiz.slice(acilis, son);
  return [...govde.matchAll(/kind\s*:\s*['"]([A-Z][A-Z0-9_]*)['"]/g)].map((m) => m[1] as string);
}

/** `switch (kind) { case 'A': ... }` — fonksiyon gövdesindeki case etiketleri. */
export function caseDegerleri(metin: string, fnAdi: string): string[] {
  const blok = blokAl(metin, fnAdi);
  if (!blok) return [];
  return [...blok.matchAll(/case\s+['"]([A-Z][A-Z0-9_]*)['"]\s*:/g)].map((m) => m[1] as string);
}

/** `const X = { A: true, B: false }` — anahtar → boolean. */
export function boolHaritasi(metin: string, ad: string): Record<string, boolean> {
  const blok = blokAl(metin, ad);
  if (!blok) return {};
  const sonuc: Record<string, boolean> = {};
  for (const m of blok.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*(true|false)\s*,?\s*$/gm)) {
    sonuc[m[1] as string] = m[2] === "true";
  }
  return sonuc;
}

// ── Kümeler ───────────────────────────────────────────────────────────────────

interface Kaynak {
  ad: string;
  dosya: string;
  degerler: string[];
}

function eksikFazla(beklenen: string[], gelen: string[]): { eksik: string[]; fazla: string[] } {
  const b = new Set(beklenen);
  const g = new Set(gelen);
  return {
    eksik: beklenen.filter((k) => !g.has(k)),
    fazla: gelen.filter((k) => !b.has(k)),
  };
}

async function main(): Promise<void> {
  const sema = readFileSync(SEMA, "utf8");
  const backend = readFileSync(BACKEND, "utf8");
  const panel = readFileSync(PANEL, "utf8");
  const tabletServis = readFileSync(TABLET_SERVIS, "utf8");
  const tabletHook = readFileSync(TABLET_HOOK, "utf8");

  const enumDeger = enumDegerleri(sema, "ReasonPresetKind");

  const kaynaklar: Kaynak[] = [
    { ad: "backend KIND_STORES_TEXT", dosya: "src/constants/reason-presets.ts", degerler: haritaAnahtarlari(backend, "KIND_STORES_TEXT") },
    { ad: "backend KIND_LABELS", dosya: "src/constants/reason-presets.ts", degerler: haritaAnahtarlari(backend, "KIND_LABELS") },
    { ad: "backend REASON_PRESET_CATALOG", dosya: "src/constants/reason-presets.ts", degerler: haritaAnahtarlari(backend, "REASON_PRESET_CATALOG") },
    { ad: "panel union", dosya: "Electron/.../ReasonPresets/service.ts", degerler: unionDegerleri(panel, "ReasonPresetKind") },
    { ad: "panel KIND_STORES_TEXT", dosya: "Electron/.../ReasonPresets/service.ts", degerler: haritaAnahtarlari(panel, "KIND_STORES_TEXT") },
    { ad: "panel KIND_TABS", dosya: "Electron/.../ReasonPresets/service.ts", degerler: kindAlanlari(panel, "KIND_TABS") },
    { ad: "tablet union", dosya: "mobil/src/services/reasonPreset.service.ts", degerler: unionDegerleri(tabletServis, "ReasonPresetKind") },
    { ad: "tablet KIND_STORES_TEXT", dosya: "mobil/src/services/reasonPreset.service.ts", degerler: haritaAnahtarlari(tabletServis, "KIND_STORES_TEXT") },
    { ad: "tablet KIND_LABELS", dosya: "mobil/src/services/reasonPreset.service.ts", degerler: haritaAnahtarlari(tabletServis, "KIND_LABELS") },
    // Çapa `const BUILTIN`: çıplak `BUILTIN` dosyada ÖNCE şablon literalinde
    // geçiyor (`BUILTIN_${i}`) ve ayrıştırıcı onun `${}` parantezine giriyor.
    { ad: "tablet BUILTIN", dosya: "mobil/src/hooks/useReasonPresets.ts", degerler: haritaAnahtarlari(tabletHook, "const BUILTIN") },
    { ad: "tablet builtin() switch", dosya: "mobil/src/hooks/useReasonPresets.ts", degerler: caseDegerleri(tabletHook, "function builtin") },
  ];

  // ── §1 Körlük zemini ───────────────────────────────────────────────────────
  console.log("\n── §1 Körlük zemini ──");
  check("Prisma enum ReasonPresetKind okunabildi", enumDeger.length >= 5, `${enumDeger.length} değer`);
  for (const k of kaynaklar) {
    check(`ayrıştırıcı değer buldu: ${k.ad}`, k.degerler.length >= 4, `${k.degerler.length} değer`);
  }

  // ── §2 Kümeler ─────────────────────────────────────────────────────────────
  console.log("\n── §2 Kaynak kümeleri ──");
  console.log(`   Prisma enum (${enumDeger.length}): ${enumDeger.join(", ")}`);
  for (const k of kaynaklar) {
    console.log(`   ${k.ad} (${k.degerler.length}): ${k.degerler.join(", ")}`);
  }

  // ── §3/§4 Eşitlik, iki yönlü ───────────────────────────────────────────────
  console.log("\n── §3 Her ayna Prisma enum'una EŞİT ──");
  for (const k of kaynaklar) {
    const { eksik, fazla } = eksikFazla(enumDeger, k.degerler);
    check(
      `${k.ad} kümesi enum'a eşit`,
      eksik.length === 0 && fazla.length === 0,
      [eksik.length ? `EKSİK: ${eksik.join(", ")}` : "", fazla.length ? `FAZLA: ${fazla.join(", ")}` : ""]
        .filter(Boolean)
        .join(" · ") || k.dosya,
    );
  }

  // ── §5 KIND_STORES_TEXT değer eşitliği ─────────────────────────────────────
  console.log("\n── §5 KIND_STORES_TEXT DEĞERLERİ üç yüzeyde aynı ──");
  const bBool = boolHaritasi(backend, "KIND_STORES_TEXT");
  const pBool = boolHaritasi(panel, "KIND_STORES_TEXT");
  const tBool = boolHaritasi(tabletServis, "KIND_STORES_TEXT");
  check("körlük zemini: backend tablosunda boolean okundu", Object.keys(bBool).length >= 5, `${Object.keys(bBool).length} satır`);
  for (const kind of enumDeger) {
    const sapan: string[] = [];
    if (kind in pBool && pBool[kind] !== bBool[kind]) sapan.push(`panel=${pBool[kind]}`);
    if (kind in tBool && tBool[kind] !== bBool[kind]) sapan.push(`tablet=${tBool[kind]}`);
    check(`${kind}: metin saklama bayrağı aynı`, sapan.length === 0, sapan.length ? `backend=${bBool[kind]} ↔ ${sapan.join(", ")}` : `${bBool[kind]}`);
  }

  // ── §6 Negatif sonda (bellek içi) ──────────────────────────────────────────
  console.log("\n── §6 Negatif sonda: ayrıştırıcılar gerçekten kırmızı veriyor ──");
  const sahteEnum = "enum K {\n  A\n  B\n  C\n}\n";
  check("§6a enum ayrıştırıcısı üç değer buluyor", enumDegerleri(sahteEnum, "K").join(",") === "A,B,C");
  const sahteUnion = "export type K =\n  | 'A'\n  | 'B';\n";
  check("§6b union'da EKSİK değer yakalanıyor", eksikFazla(["A", "B", "C"], unionDegerleri(sahteUnion, "K")).eksik.join(",") === "C");
  const sahteHarita = "export const M: R = {\n  A: 1,\n  B: 2,\n  ZZZ: 3,\n};\n";
  check("§6c haritada FAZLA değer yakalanıyor", eksikFazla(["A", "B"], haritaAnahtarlari(sahteHarita, "const M")).fazla.join(",") === "ZZZ");
  const icIce = "export const M: R = {\n  A: { B: 1 },\n  C: 2,\n};\n";
  check("§6d iç içe nesnenin anahtarı ÜST seviye sayılmıyor", haritaAnahtarlari(icIce, "const M").join(",") === "A,C");
  const yorumlu = "export const M: R = {\n  // B: 1,\n  A: 2,\n};\n";
  check("§6e yorum satırındaki anahtar sayılmıyor", haritaAnahtarlari(yorumlu, "const M").join(",") === "A");
  check("§6f bulunamayan blok BOŞ küme döndürüyor (sessiz yeşil değil)", haritaAnahtarlari(yorumlu, "const YOK").length === 0);
  const sahteSwitch = "function builtin(k) {\n  switch (k) {\n    case 'A':\n      return 1;\n    case 'B':\n      return 2;\n  }\n}\n";
  check("§6g switch case ayrıştırıcısı çalışıyor", caseDegerleri(sahteSwitch, "function builtin").join(",") === "A,B");
  const sahteBool = "export const M: R = {\n  A: true,\n  B: false,\n};\n";
  check("§6h boolean haritası değer okuyor", boolHaritasi(sahteBool, "const M").A === true && boolHaritasi(sahteBool, "const M").B === false);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
