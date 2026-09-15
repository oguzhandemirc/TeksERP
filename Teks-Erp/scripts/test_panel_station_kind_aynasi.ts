// =============================================================================
// PANEL İSTASYON TÜRÜ AYNASI — backend `enum StationKind` ↔ Electron `StationKind`/`stationKindLabels`/form zod
// enum'u iki yönlü + İstasyonlar sayfasının tür kümesi formun şemasından TÜRETİLMİŞ (sabit liste YOK)
// =============================================================================
// NEDEN (kullanıcı testi 2026-09-16, kırmızı): panel Üretim İstasyonları sayfası türleri sabit
// `["RAW_QC","PROCESS_QC","TAMBUR","SUBCONTRACTOR"]` listesiyle süzüyordu; dokuma şemasıyla doğan
// `WEAVING` listeye girmemişti ⇒ kullanıcı "Dokuma Tezgahı" istasyonu kaydediyor (DB'de var, aktif),
// kart çizilmiyor, dışa aktarımda yok, tezgah (makine) eklenemiyor — "altıncı enum değeri unutuldu".
// Ayna (`stationKindLabels`) tamdı; kusur SAYFANIN kendi sabitiydi. Kullanıcı: "sevkiyat ekleyebiliyorsam
// neden göstermiyorum?" ⇒ dışlama listesi de yok; form hangi türü kaydettiriyorsa sayfa listeler. Kilitler:
//   §1 ayna iki yönlü: şemadaki her StationKind değeri Electron `StationKind` nesnesinde, `stationKindLabels`ta
//      VE formun zod enum'unda (`schema.ts`); fazlası da yok (bayat değer).
//   §2 sayfa tür kümesini `visibleStationKinds.ts`ten TÜRETİR (kaynak `stationFormSchema.shape.kind.options`):
//      sayfada sabit liste YOK, dışlama listesi YOK; tek gizleme bayrak (`FLAG_GATED_STATION_KINDS` ⊂ şema).
// Koşum: npx tsx scripts/test_panel_station_kind_aynasi.ts   (DB'siz, statik)
// NEGATİF SONDA (2026-09-16, kırmızı görüldü): `stationKindLabels`tan WEAVING silinince §1b ❌;
//   sayfaya `const PRODUCTION_KINDS = [...]` geri konunca §2a ❌.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";

// `test_mobil_enum_aynasi`nin ayrıştırıcısı (yorumlar ÖNCE soyulur) — o dosya import edilince `main()`
// koşup çıkıyor, bu yüzden iki küçük fonksiyon burada tekrarlanır.
function yorumlariSoy(kaynak: string): string {
  return kaynak.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}
function backendEnum(sema: string, ad: string): Set<string> {
  const m = new RegExp(`^enum ${ad} \\{(.*?)^\\}`, "ms").exec(sema);
  if (!m) return new Set();
  return new Set([...yorumlariSoy(m[1]).matchAll(/^\s{2}([A-Z][A-Z0-9_]*)/gm)].map((x) => x[1]));
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const ROOT = path.resolve(__dirname, "..");
const ELECTRON = path.resolve(ROOT, "../Electron/src");
const oku = (p: string): string => readFileSync(p, "utf8");

function nesneAnahtarlari(kaynak: string, ad: string): Set<string> {
  const m = new RegExp(`export const ${ad}[^=]*=\\s*\\{(.*?)^\\}`, "ms").exec(yorumlariSoy(kaynak));
  if (!m) return new Set();
  return new Set([...m[1].matchAll(/^\s+([A-Z][A-Z0-9_]*)\s*:/gm)].map((x) => x[1]));
}

function main(): void {
  console.log("=== PANEL İSTASYON TÜRÜ AYNASI ===\n");
  const sema = backendEnum(oku(path.join(ROOT, "prisma/schema.prisma")), "StationKind");
  check("§0 şema `StationKind` okundu (≥ 6 değer)", sema.size >= 6, [...sema].join(","));

  console.log("\n── §1 Ayna iki yönlü ──");
  const enums = oku(path.join(ELECTRON, "types/enums.ts"));
  const nesne = nesneAnahtarlari(enums, "StationKind");
  const etiket = nesneAnahtarlari(enums, "stationKindLabels");
  const eksikNesne = [...sema].filter((v) => !nesne.has(v));
  const fazlaNesne = [...nesne].filter((v) => !sema.has(v));
  check("§1a Electron `StationKind` nesnesi ≡ şema (eksik yok, bayat yok)", eksikNesne.length === 0 && fazlaNesne.length === 0, `eksik: ${eksikNesne.join(",") || "-"} · bayat: ${fazlaNesne.join(",") || "-"}`);
  const eksikEtiket = [...sema].filter((v) => !etiket.has(v));
  const fazlaEtiket = [...etiket].filter((v) => !sema.has(v));
  check("§1b ⭐ `stationKindLabels` her şema değerini taşır; bayat etiket yok", eksikEtiket.length === 0 && fazlaEtiket.length === 0, `eksik: ${eksikEtiket.join(",") || "-"} · bayat: ${fazlaEtiket.join(",") || "-"}`);
  const formSema = yorumlariSoy(oku(path.join(ELECTRON, "pages/Stations/schema.ts")));
  const formTur = new Set([...(/kind: z\.enum\(\s*\[(.*?)\]/s.exec(formSema)?.[1] ?? "").matchAll(/StationKind\.([A-Z_]+)/g)].map((x) => x[1]));
  const eksikForm = [...sema].filter((v) => !formTur.has(v));
  const fazlaForm = [...formTur].filter((v) => !sema.has(v));
  check("§1c form zod enum'u (`schema.ts kind`) ≡ şema — formun kaydettirdiği = sayfanın listelediği", formTur.size > 0 && eksikForm.length === 0 && fazlaForm.length === 0, `eksik: ${eksikForm.join(",") || "-"} · bayat: ${fazlaForm.join(",") || "-"}`);

  console.log("\n── §2 İstasyonlar sayfası tür kümesi TÜRETİLMİŞ ──");
  const sayfa = yorumlariSoy(oku(path.join(ELECTRON, "pages/Stations/ProductionStationsPage.tsx")));
  check("§2a ⭐ sayfada sabit tür listesi YOK (`PRODUCTION_KINDS` / `[\"RAW_QC\", …]` literali); `isVisibleStationKind` import edilir ve süzgeçte kullanılır",
    !/PRODUCTION_KINDS/.test(sayfa) && !/\[\s*"RAW_QC"\s*,/.test(sayfa) && /import \{[^}]*isVisibleStationKind[^}]*\} from "\.\/visibleStationKinds"/.test(sayfa) && /isVisibleStationKind\(s\.kind/.test(sayfa));
  const kume = yorumlariSoy(oku(path.join(ELECTRON, "pages/Stations/visibleStationKinds.ts")));
  check("§2b küme formun zod enum'undan türetilir (`stationFormSchema.shape.kind.options`); elle sayım ve dışlama listesi YOK", /stationFormSchema\.shape\.kind\.options/.test(kume) && !/\[\s*"RAW_QC"/.test(kume) && !/NON_PRODUCTION|EXCLUDED|DISLAMA/i.test(kume));
  const gorunurluk = yorumlariSoy(oku(path.join(ELECTRON, "pages/Stations/stationKindVisibility.ts")));
  const kapili = [...(/FLAG_GATED_STATION_KINDS[^=]*=\s*\{(.*?)\}/s.exec(gorunurluk)?.[1] ?? "").matchAll(/\[StationKind\.([A-Z_]+)\]/g)].map((x) => x[1]);
  check("§2d bayrağa bağlı türler şemada var (WEAVING dahil)", kapili.includes("WEAVING") && kapili.every((v) => sema.has(v)), kapili.join(","));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
