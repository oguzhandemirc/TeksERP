// =============================================================================
// test_rapor_duzen — özel rapor DÜZENİ yalnız sunumdur (Raporlar v2, R2-DUZEN; DB'siz)
// =============================================================================
// Koşum: npx tsx scripts/run-all-tests.ts test_rapor_duzen   (DB'siz, saf fonksiyonlar)
// §1 şema: `varyant` (tek ölçü × tek boyut, ilk N ≤ 6) ve `donem` (dönem sütunları) blokları + `duzen[].sayfaKesmesi`
//    kabul; zaman boyutlu kırılım / dönem kıyası, çok ölçülü varyant, ızgara taşması, düzende olmayan blok reddedilir
// §2 EŞİTLİK: aynı gövde üç farklı düzenle (sıra · genişlik · sayfa kesmesi · düzensiz) → her bloğun semantik
//    sorgu girdisi BAYT EŞİT (sayı düzene bağlı olamaz) · varyant `tavan = ilkN`, donem `donemler` + kıyassız
// §3 yeni blokların girdileri derleyiciden geçer (izinli ölçü/boyut; zaman tavanı aynı)
//
// NEGATİF SONDALAR (2026-10-25 ÖLÇÜLDÜ; cp + md5 ile birebir geri alındı; taban 17/0):
//   D1 `blockSemanticInputs` tavanı düzen genişliğinden aldı (`body.duzen.find(...).w`) → §2a + §2b + §2c ❌ 3
//   D2 `checkSplitBlock` zaman boyutu denetimi kaldırıldı → §1e + §1f ❌ 2
// =============================================================================
import type { AccessContext } from "../src/services/reports/semantik/izin";
import { compileQuery } from "../src/services/reports/semantik/derleyici";
import { checkReportDefinition, type ReportDefinitionBody } from "../src/services/reports/semantik/rapor-tanimi.schema";
import { blockSemanticInputs, resolveParams } from "../src/services/reports/semantik/definition-run";
import { MODULE_SETTING_KEY_BY_FLAG } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const NOW = new Date("2026-10-20T09:00:00Z");
const sevk = (olculer: string[], boyutlar: string[] = []) => ({ kup: "sevk", olculer, boyutlar, zaman: { param: "donem", kiyas: "$kiyas" } });

function body(duzen: unknown[]) {
  return {
    surum: 1,
    baslik: "Sevk düzeni",
    parametreler: [
      { ad: "donem", tur: "tarihAraligi", varsayilan: "son30gun" },
      { ad: "kiyas", tur: "kiyas", varsayilan: "prev" },
    ],
    bloklar: [
      { id: "a1", tur: "anaSayi", sorgu: sevk(["sevk.brutMetre"]) },
      { id: "g1", tur: "grafik", gorsel: "cubuk", sorgu: sevk(["sevk.brutMetre"], ["musteri"]) },
      { id: "t1", tur: "tablo", sorgu: sevk(["sevk.brutMetre"], ["musteri"]) },
      { id: "v1", tur: "varyant", ilkN: 4, sorgu: sevk(["sevk.brutMetre"], ["musteri"]) },
      { id: "d1", tur: "donem", birim: "ay", adet: 3, sorgu: sevk(["sevk.brutMetre"], ["musteri"]) },
      { id: "m1", tur: "metin", metin: "Sevk rakamları brüttür." },
    ],
    duzen,
  };
}

const LAYOUT_A = [
  { i: "a1", x: 0, y: 0, w: 12, h: 1 },
  { i: "g1", x: 0, y: 1, w: 6, h: 1 },
  { i: "t1", x: 6, y: 1, w: 6, h: 1 },
  { i: "v1", x: 0, y: 2, w: 12, h: 1 },
  { i: "d1", x: 0, y: 3, w: 12, h: 1, sayfaKesmesi: true },
  { i: "m1", x: 0, y: 4, w: 12, h: 1 },
];
const LAYOUT_B = [
  { i: "d1", x: 0, y: 0, w: 4, h: 1 },
  { i: "v1", x: 4, y: 0, w: 8, h: 1, sayfaKesmesi: true },
  { i: "m1", x: 0, y: 1, w: 3, h: 1 },
  { i: "t1", x: 3, y: 1, w: 9, h: 1, sayfaKesmesi: true },
  { i: "g1", x: 0, y: 2, w: 12, h: 1 },
  { i: "a1", x: 0, y: 3, w: 2, h: 1 },
];

function parse(raw: unknown): ReportDefinitionBody | null {
  const r = checkReportDefinition(raw);
  return r.gecerli ? r.govde : null;
}

function issuesOf(raw: unknown): Array<{ yol: string; mesaj: string }> {
  const r = checkReportDefinition(raw);
  return r.gecerli ? [] : r.hatalar;
}

function inputsByBlock(b: ReportDefinitionBody): string {
  const params = resolveParams(b, {}, NOW);
  const out: Record<string, unknown> = {};
  for (const block of b.bloklar) out[block.id] = blockSemanticInputs(block, params, b, false);
  return JSON.stringify(out);
}

// ── §1 Şema ─────────────────────────────────────────────────────────────────
const a = parse(body(LAYOUT_A));
check("§1a varyant + donem blokları + sayfaKesmesi geçerli", a !== null, JSON.stringify(issuesOf(body(LAYOUT_A))));
check("§1b düzensiz gövde geçerli (duzen varsayılanı boş)", parse({ ...body([]), duzen: undefined }) !== null);
const multi = body(LAYOUT_A);
(multi.bloklar[3] as { sorgu: unknown }).sorgu = sevk(["sevk.brutMetre", "sevk.tutar"], ["musteri"]);
check("§1c çok ölçülü varyant reddedilir", issuesOf(multi).some((h) => h.yol === "bloklar[3].sorgu.olculer"), JSON.stringify(issuesOf(multi)));
const tooMany = body(LAYOUT_A);
(tooMany.bloklar[3] as { ilkN: number }).ilkN = 9;
check("§1d varyant ilk N ≤ 6", issuesOf(tooMany).some((h) => h.yol === "bloklar[3].ilkN"));
const timeVariant = body(LAYOUT_A);
(timeVariant.bloklar[3] as { sorgu: unknown }).sorgu = sevk(["sevk.brutMetre"], ["ay"]);
check("§1e zaman boyutlu kırılım reddedilir", issuesOf(timeVariant).some((h) => h.yol === "bloklar[3].sorgu.boyutlar"));
const timePeriods = body(LAYOUT_A);
(timePeriods.bloklar[4] as { sorgu: unknown }).sorgu = sevk(["sevk.brutMetre"], ["ay"]);
check("§1f zaman boyutlu dönem kıyası reddedilir", issuesOf(timePeriods).some((h) => h.yol === "bloklar[4].sorgu.boyutlar"));
const helperPeriods = body(LAYOUT_A);
(helperPeriods.bloklar[4] as { sorgu: unknown }).sorgu = sevk(["sevk.tutar"], ["musteri"]);
check("§1j yardımcı ölçü dönem sütunlarına bölünmez", issuesOf(helperPeriods).some((h) => h.yol === "bloklar[4].sorgu.olculer"));
const overflow = body([{ i: "a1", x: 8, y: 0, w: 6, h: 1 }]);
check("§1g 12 sütun taşması reddedilir", issuesOf(overflow).some((h) => h.yol === "duzen[0].w"));
const ghost = body([{ i: "zz", x: 0, y: 0, w: 12, h: 1 }]);
check("§1h düzende olmayan blok reddedilir", issuesOf(ghost).some((h) => h.yol === "duzen[0].i"));
const extraKey = body([{ i: "a1", x: 0, y: 0, w: 12, h: 1, renk: "kirmizi" }]);
check("§1i düzen öğesi strict (tanınmayan alan)", issuesOf(extraKey).some((h) => h.yol === "duzen[0]" && h.mesaj.includes("renk")), JSON.stringify(issuesOf(extraKey)));

// ── §2 Eşitlik: düzen sayı girdisini değiştirmez ────────────────────────────
const b = parse(body(LAYOUT_B));
const none = parse(body([]));
if (a && b && none) {
  const ia = inputsByBlock(a);
  check("§2a sıra + genişlik + sayfa kesmesi değişince sorgu girdileri bayt eşit", ia === inputsByBlock(b));
  check("§2b düzensiz gövdeyle de bayt eşit", ia === inputsByBlock(none));
  const params = resolveParams(a, {}, NOW);
  const v = blockSemanticInputs(a.bloklar[3]!, params, a, false)[0];
  check("§2c varyant girdisi: tavan = ilkN, tek boyut", v?.tavan === 4 && v.boyutlar.length === 1 && v.boyutlar[0] === "musteri", JSON.stringify(v));
  const d = blockSemanticInputs(a.bloklar[4]!, params, a, false)[0];
  check("§2d dönem girdisi: donemler {ay,3} + kıyassız", d?.donemler?.birim === "ay" && d.donemler.adet === 3 && d.compare === undefined, JSON.stringify(d));
  const t = blockSemanticInputs(a.bloklar[2]!, params, a, false)[0];
  check("§2e tablo girdisi eski yolla aynı (kıyaslı, dönemsiz)", t?.compare === "prev" && t.donemler === undefined, JSON.stringify(t));
  check("§2f metin bloğu sorgu üretmez", blockSemanticInputs(a.bloklar[5]!, params, a, false).length === 0);

  // ── §3 Derleyici ────────────────────────────────────────────────────────────
  const ctx: AccessContext = { userId: "00000000-0000-0000-0000-000000000001", permissions: ["report:*"], openModuleKeys: new Set(Object.values(MODULE_SETTING_KEY_BY_FLAG)) };
  let compiled = 0;
  for (const blk of a.bloklar) for (const input of blockSemanticInputs(blk, params, a, false)) {
    compileQuery(input, ctx);
    compiled++;
  }
  check("§3a beş sorgulu bloğun girdisi derleyiciden geçer", compiled === 5, String(compiled));
} else {
  check("§2 gövdeler ayrıştırılamadı", false, JSON.stringify(issuesOf(body(LAYOUT_B))));
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
