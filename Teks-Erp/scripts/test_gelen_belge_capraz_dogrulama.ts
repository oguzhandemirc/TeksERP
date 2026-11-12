// =============================================================================
// BEKÇİ — GELEN BELGE: ana veri eşleme + alan tipine göre karakter düzeltme + çapraz doğrulama (2026-11-09)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts gelen_belge_capraz_dogrulama   (DB'ye YAZMAZ, sorgu atmaz)
//
// ⭐ NEDEN VAR: OCR motoru değişmeden tanıma iyileştirmesi — kod alanında "lSM1439770" → "ISM1439770" ve
//    "ISM14397O0" → "ISM1439700" (biçim kuralına uyan TEK aday); belgede ikinci metre ("Müşteri MT 238" ↔ TOPLAM 241)
//    ve makul olmayan kg/metre oranı UYARI olur (değer değişmez); OCR karışıklığıyla okunan cari adı ("HH1 MC")
//    öneri listesine girer ama sahip alanına sessizce yazılmaz (0,92 < 0,95).
//
// ⭐ NEGATİF SONDA (2026-11-09, elle, geri alındı): `extract.ts`te `canonicalizeField` yerine `canonicalizeValue`
//    konunca §4a/§4b düşer; `document.ts`te `crossCheckWarnings` çağrısı kaldırılınca §4c/§4d düşer;
//    `labeledMeterValues` sol-etiket koşulu kaldırılınca §2b (TOPLAM satırındaki "MT 734,00") düşer;
//    `fixCodeByShape` tekillik koşulları gevşetilince (≥ 1 aday) §1f düşer; bağlam şartı (`swappable`) kaldırılınca §1f2 +
//    §4 v8 negatifi düşer (doğru 'ISM…' → '1SM…'); `rank`ta `ocrEqualScore` kaldırılınca §3c düşer.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clientOcrToResult, type ClientOcr } from "../src/lib/gelen-belge/istemci-ocr";
import { extractDocument, parseNumber, type DocumentTemplate, type FieldSpec, type OcrRect } from "../src/lib/gelen-belge/motor";
import { canonicalizeField, fieldShapes, fixCodeByShape, fixLowerLInCode } from "../src/lib/gelen-belge/motor/char-fix";
import { KG_METER_RATIO, METER_VALUES_DIFFER, labeledMeterValues, meterDiffWarning, ratioWarning } from "../src/lib/gelen-belge/motor/cross-check";
import { draftFromExtraction } from "../src/lib/gelen-belge/taslak";
import { noteNotices } from "../src/lib/gelen-belge/uyari";
import { OCR_EQUAL_SCORE, ocrEqualScore } from "../src/services/helpers/master-match.helper";
import { foldNameForCompare } from "../src/services/helpers/name-normalize.helper";
import { rank } from "../src/services/gelen-belge-eslestirme.service";
import prisma from "../src/lib/prisma";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const batchField: FieldSpec = { key: "partiNo", label: "Parti No", type: "alnum", strategies: [{ kind: "anchor", labels: ["İş Emri"], direction: "right", valueShape: "^\\p{L}+\\d+$", maxWords: 1 }] };

// ── §1 karakter düzeltme ───────────────────────────────────────────────────────
{
  check("§1a 'lSM1439770' → küçük l büyük I", fixLowerLInCode("lSM1439770").text === "ISM1439770");
  check("§1b rakam komşulu l → 1 ('12l4' → '1214'); 'Ali'/'lot' dokunulmaz", fixLowerLInCode("12l4").text === "1214" && fixLowerLInCode("Ali lot").text === "Ali lot");
  const shapes = fieldShapes(batchField);
  check("§1c 'ISM14397O0' + öğrenilmiş biçim → 'ISM1439700'", fixCodeByShape("ISM14397O0", shapes) === "ISM1439700");
  check("§1d biçime uyan değere dokunulmaz", fixCodeByShape("ISM1439700", shapes) === null);
  check("§1e biçim yoksa dokunulmaz", fixCodeByShape("ISM14397O0", []) === null);
  // "12O4S6": O (rakamlar arası) ve S (rakamlar arası) tek tek düzeltilebilir; iki biçimin her biri birine uyar → iki aday.
  const two = [(v: string) => /^120\dS6$/u.test(v), (v: string) => /^12O\d{1}56$/u.test(v)];
  check("§1f iki eşit aday → dokunulmaz (sessiz seçim yok)", fixCodeByShape("12O4S6", two) === null, String(fixCodeByShape("12O4S6", two)));
  check("§1f2 yanlış öğrenilmiş biçim (^\\d+\\p{L}+\\d+$) doğru 'ISM1439770'yu '1SM…'ye çevirmez (bağlam şartı)", fixCodeByShape("ISM1439770", [(v) => /^\d+\p{L}+\d+$/u.test(v)]) === null);
  const a = canonicalizeField(batchField, "lSM1439770");
  const b = canonicalizeField(batchField, "ISM14397O0");
  check("§1g canonicalizeField: 'lSM1439770' → 'ISM1439770' + corrected-by-shape", a.value === "ISM1439770" && a.corrected && a.issues.includes("corrected-by-shape"), JSON.stringify(a));
  check("§1h canonicalizeField: 'ISM14397O0' → 'ISM1439700'", b.value === "ISM1439700" && b.corrected, JSON.stringify(b));
  const text = canonicalizeField({ key: "musteri", label: "Müşteri", type: "text", strategies: [] }, "HHL MC");
  check("§1i metin alanı eski yoldan (değişmez)", text.value === "HHL MC" && !text.corrected);
  check("§1j sayısal alan: '24l,0O' → 241, '1.2O5,5O' → 1205.5 (parseNumber, rakam bağlamı)", parseNumber("24l,0O").value === "241" && parseNumber("1.2O5,5O").value === "1205.5");
}

// ── §2 çapraz doğrulama (saf) ─────────────────────────────────────────────────
{
  check("§2a 'Müşteri MT 238,00' → [238]", JSON.stringify(labeledMeterValues("Müşteri MT  238,00")) === "[238]");
  check("§2b 'TOPLAM 241,00 MT 734,00 KG 0,00 MT' → [] (birim ekinden sonraki sayı etiketli değil)", labeledMeterValues("TOPLAM  241,00 MT  734,00 KG  0,00 MT").length === 0);
  const w = meterDiffWarning(241, ["İş Emri ISM1439770", "Müşteri MT  238,00", "TOPLAM  241,00 MT  734,00 KG"]);
  check("§2c iki farklı metre uyarısı '238 / 241'", !!w && w.startsWith(METER_VALUES_DIFFER) && w.includes("238 / 241"), String(w));
  check("§2d aynı metre (yuvarlama payı) → uyarı yok", meterDiffWarning(241, ["Toplam Metre: 241,40"]) === null);
  check("§2e 734 kg / 241 m / en 350 → makul (870 g/m²), uyarı yok", ratioWarning(734, 241, 350) === null);
  const r = ratioWarning(734, 24.1, 350);
  check("§2f 734 kg / 24,1 m / en 350 → oran uyarısı", !!r && r.startsWith(KG_METER_RATIO), String(r));
  check("§2g en yok: 5 kg / 2410 m → 2 g/m uyarı; 734/241 → yok", !!ratioWarning(5, 2410, null) && ratioWarning(734, 241, null) === null);
  const n = noteNotices([`${METER_VALUES_DIFFER}: belgede iki farklı metre: 238 / 241`]);
  check("§2h uyarı şeridi başlığı tanınır", n.length === 1 && n[0]!.title === "Belgede iki farklı metre" && n[0]!.detail.startsWith("Belgede iki farklı metre"), JSON.stringify(n));
}

// ── §3 ana veri eşleme ────────────────────────────────────────────────────────
{
  check("§3a OCR anahtarı eşit: 'HH1 MC' ≡ 'HHL MC'", ocrEqualScore(foldNameForCompare("HH1 MC"), foldNameForCompare("HHL MC")) === OCR_EQUAL_SCORE);
  check("§3b farklı ad eşit değil; kısa anahtar sayılmaz", ocrEqualScore("abc tekstil", "hhl mc") === 0 && ocrEqualScore("a1", "al") === 0);
  const rows = [{ id: "c1", code: null, name: "HHL MC" }, { id: "c2", code: null, name: "ABC TEKSTİL" }, { id: "c3", code: null, name: "HHL" }];
  const r1 = rank("HH1 MC", rows, "SENDER");
  check("§3c 'HH1 MC' okuması → HHL MC listede, puan 0,92 (öneri eşiği üstü, sahip 'çok güçlü' 0,95 altı)", r1[0]?.id === "c1" && r1[0]!.score === OCR_EQUAL_SCORE, JSON.stringify(r1));
  const r2 = rank("HHLMC", rows, "SENDER");
  check("§3d 'HHLMC' (boşluksuz) → HHL MC tam puan", r2[0]?.id === "c1" && r2[0]!.score === 1, JSON.stringify(r2));
}

// ── §4 motor: 0247 fikstürü (kurulum şablonu, çıkış çeki listesi) ────────────
interface FxWord { t: string; rect: OcrRect; l: number; p: number | null }
const fx = JSON.parse(readFileSync(join(__dirname, "../src/lib/gelen-belge/motor/__tests__/fikstur/kelime/0247-cikis-ceki-dik.json"), "utf8")) as { imageWidth: number; imageHeight: number; words: FxWord[]; template: DocumentTemplate };
const quad = (r: OcrRect): Array<[number, number]> => [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]];
function frame(edit: (t: string) => string): ClientOcr {
  const n = Math.max(...fx.words.map((w) => w.l)) + 1;
  const lines = Array.from({ length: n }, (_, l) => {
    const ws = fx.words.filter((w) => w.l === l);
    const x0 = Math.min(...ws.map((w) => w.rect.x)), y0 = Math.min(...ws.map((w) => w.rect.y));
    const x1 = Math.max(...ws.map((w) => w.rect.x + w.rect.width)), y1 = Math.max(...ws.map((w) => w.rect.y + w.rect.height));
    return { c: quad({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }), p: 0.9 };
  });
  return { engine: "mlkit", width: fx.imageWidth, height: fx.imageHeight, rotation: 0, words: fx.words.map((w) => ({ t: edit(w.t), c: quad(w.rect), l: w.l, p: w.p })), lines } as ClientOcr;
}
// Kurulumun güncel şablonu (v10) parti no biçimini "^\p{L}+\d+$" öğrendi; fikstürdeki v8 "1SM…" okumasından "^\d+\p{L}+\d+$".
const tplV10: DocumentTemplate = { ...fx.template, fields: fx.template.fields.map((f) => (f.key !== "partiNo" ? f : { ...f, strategies: f.strategies.map((s) => (s.kind === "anchor" ? { ...s, valueShape: "^\\p{L}+\\d+$" } : s)) })) };
const run = (edit: (t: string) => string, tpl: DocumentTemplate = tplV10) => {
  const doc = extractDocument(clientOcrToResult(frame(edit)), [tpl], null);
  return { doc, f: doc.regions[0]?.fields?.fields ?? {}, warnings: doc.regions[0]?.warnings ?? [] };
};
{
  const base = run((t) => t);
  check("§4 ön koşul: şablon eşleşti, metre 241, parti no 'ISM9439770'", base.doc.regions[0]?.templateId === fx.template.id && base.f.toplamMetre?.value === "241" && base.f.partiNo?.value === "ISM9439770", `${base.doc.regions[0]?.templateId} m=${base.f.toplamMetre?.value} p=${base.f.partiNo?.value}`);
  const v8 = run((t) => t, fx.template);
  check("§4 negatif: v8'in yanlış öğrenilmiş biçimi doğru okunan parti no'yu bozmaz", v8.f.partiNo?.value === "ISM9439770", String(v8.f.partiNo?.value));
  const l = run((t) => (t === "ISM9439770" ? "lSM9439770" : t));
  check("§4a ⭐ okunan 'lSM9439770' → parti no 'ISM9439770'", l.f.partiNo?.value === "ISM9439770", String(l.f.partiNo?.value));
  const o = run((t) => (t === "ISM9439770" ? "ISM94397O0" : t));
  check("§4b ⭐ okunan 'ISM94397O0' → parti no 'ISM9439700'", o.f.partiNo?.value === "ISM9439700", String(o.f.partiNo?.value));
  const diff = base.warnings.find((w) => w.startsWith(METER_VALUES_DIFFER));
  check("§4c ⭐ 'Müşteri MT 238,00' ↔ TOPLAM 241 → uyarı '238 / 241'", !!diff && diff.includes("238 / 241"), JSON.stringify(base.warnings));
  const draft = draftFromExtraction(base.doc, { templates: [fx.template] });
  check("§4d taslak uyarılarına ve şeridine taşınır", noteNotices(draft.header.warnings).some((x) => x.code === METER_VALUES_DIFFER));
  const same = run((t) => (t === "238,00" ? "241,00" : t));
  check("§4e negatif: iki metre aynıysa uyarı yok", !same.warnings.some((w) => w.startsWith(METER_VALUES_DIFFER)), JSON.stringify(same.warnings));
  check("§4f 734 kg / 241 m / en 350 → oran uyarısı yok (değer değişmez)", !base.warnings.some((w) => w.startsWith(KG_METER_RATIO)) && base.f.toplamKg?.value === "734");
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
void prisma.$disconnect();
