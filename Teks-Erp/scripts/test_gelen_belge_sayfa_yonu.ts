// =============================================================================
// BEKÇİ — GELEN BELGE SAYFA YÖNÜ + ETİKET DEĞER OLAMAZ (canlı okuma, 2026-11-09)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts gelen_belge_sayfa_yonu   (DB'siz, sunucusuz)
//
// ⭐ NEDEN VAR: tablette kâğıt kadrajda 90° dönük okutuldu; şablon (metin) doğru tanındı ama alanlar geometriyle
//    çıkarıldığından "Gelen renk = Taşıma Tipi", "Parti No = TARİH" KİLİTLENDİ, kg/metre/en boş kaldı. Kâğıt herhangi
//    bir açıda (20°, 35°…) durabilir.
//   §1 dönüşüm: `rectToPhotoFrame` eski çeyrek formülleriyle BİREBİR (tek kaynak `sayfa-yonu.ts`), gidiş-dönüş her açıda
//   §2 ⭐ fikstür 0247 (gerçek demo taraması, anonim; kelime köşeleri ölçülen ~−4,3° sayfa eğimiyle kurulur) her açıda
//      (0/15/30/45/90/135/180/270/−20): baskın açı bulunur, dikleştirilmiş karede kg 734 · metre 241 · en 350 ·
//      kumaş/parti no doğru; ÇEYREK kipte (fotoğraf yüklemesi) 90/270 → `rotation` 90/270
//   §3 dönük kare dikleştirilMEDEN okununca alanlar YANLIŞ/boş (hatanın kendisi — normalizasyonun gerekliliği)
//   §4 değer kutusu kare çerçevesine geri döner (`rectToSource`): kg kutusu döndürülmüş karedeki "734,00" kelimesini kapsar
//   §5 ⭐ etiket değer olamaz: tam etiket ("Tarih", GENEL sözlüğü) · yalnız şablon etiket kelimeleri · ":" ile biten rakamsız
//      ham metin · HAM metni yalnız etiket parçası ("Tarih Müşteri" → stripSpaces "TARİHMÜŞTERİ", §5g/§5h) reddedilir
//      (`label-as-value`, değer null); gerçek değer ve firma adı (tanıma anahtarı) reddedilmez
//   §6 skipWords: "TOPLAM 241,00 MT   734,00 KG" — sütun aralığı atlanan kelimelerde kesmez (kg anchor'dan, konum yedeği değil)
//   §7 makul olmayan değer (`value-guard.ts`): sayısal alanda tarih · en 10–700 dışı · parti no'da virgüllü ondalık → null
// ⭐ NEGATİF SONDA (2026-11-09, elle, geri alındı): `uprightClientOcr` kareyi hep aynen döndürünce §2/§2q/§2r/§4/§6 düşer
//    (22 kırmızı; 0°'de renk "MA 9999-99" = sahadaki komşu alana kayma); `extract.ts`te `rejectLabelValue` kaldırılınca
//    §5d/§5e düşer; `rejectImplausibleValue` kaldırılınca §7d/§7e düşer; `anchor.ts` skip dalı eski hâline (`gap > maxGap`)
//    dönünce §2 (15/30/45/135/−20°) + §6 düşer. `label-guard.ts` ham metin dalı (`onlyLabelWords(rn)`) kaldırılınca
//    §5g/§5h düşer (2026-11-09, GB0911260050).
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clientOcrToResult, type ClientOcr } from "../src/lib/gelen-belge/istemci-ocr";
import { orientationTransform, photoFrameSize, rectToPhotoFrame, rectToSource, uprightClientOcr, signedDeg } from "../src/lib/gelen-belge/sayfa-yonu";
import { extractDocument, extractFields, type DocumentTemplate, type OcrRect, type OcrResult } from "../src/lib/gelen-belge/motor";
import { LABEL_AS_VALUE, isLabelValue, labelGuardFor } from "../src/lib/gelen-belge/motor/label-guard";
import { DATE_AS_NUMBER, NUMBER_AS_BATCH, OUT_OF_PLAUSIBLE_RANGE, implausibleReason } from "../src/lib/gelen-belge/motor/value-guard";
import type { FieldSpec } from "../src/lib/gelen-belge/motor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

type P = [number, number];
interface FxWord { t: string; rect: OcrRect; l: number; p: number | null }
const fx = JSON.parse(readFileSync(join(__dirname, "../src/lib/gelen-belge/motor/__tests__/fikstur/kelime/0247-cikis-ceki-dik.json"), "utf8")) as {
  imageWidth: number; imageHeight: number; words: FxWord[]; template: DocumentTemplate;
};
const tpl = fx.template;
/** Fotoğrafın kendi eğimi: tablo başlık sırası ("Kod … Miktar 3") sağa doğru yükselir; fikstürde yalnız kutu vardı. */
const PAGE_TILT = -4.3;

function rotRect(cx: number, cy: number, len: number, hei: number, deg: number): P[] {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  const u: P = [(c * len) / 2, (s * len) / 2], v: P = [(-s * hei) / 2, (c * hei) / 2];
  return [[cx - u[0] - v[0], cy - u[1] - v[1]], [cx + u[0] - v[0], cy + u[1] - v[1]], [cx + u[0] + v[0], cy + u[1] + v[1]], [cx - u[0] + v[0], cy - u[1] + v[1]]];
}
/** Eksen hizalı kutudan, `deg` eğimli metin dörtgeni (ML Kit gibi: metnin sol-üstünden saat yönünde). */
function tiltedQuad(r: OcrRect, deg: number): P[] {
  const c = Math.abs(Math.cos((deg * Math.PI) / 180)), s = Math.abs(Math.sin((deg * Math.PI) / 180));
  const det = c * c - s * s;
  let len = (r.width * c - r.height * s) / det, hei = (r.height * c - r.width * s) / det;
  if (hei < r.height * 0.5) hei = r.height * 0.8;
  if (len < hei) len = r.width;
  return rotRect(r.x + r.width / 2, r.y + r.height / 2, len, hei, deg);
}

function baseFrame(): ClientOcr {
  const byL = new Map<number, FxWord[]>();
  for (const w of fx.words) byL.set(w.l, [...(byL.get(w.l) ?? []), w]);
  const n = Math.max(...fx.words.map((w) => w.l)) + 1;
  const lines = Array.from({ length: n }, (_, l) => {
    const ws = byL.get(l) ?? [];
    const x0 = Math.min(...ws.map((w) => w.rect.x)), y0 = Math.min(...ws.map((w) => w.rect.y));
    const x1 = Math.max(...ws.map((w) => w.rect.x + w.rect.width)), y1 = Math.max(...ws.map((w) => w.rect.y + w.rect.height));
    return { c: tiltedQuad({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, PAGE_TILT), p: 0.9 };
  });
  const words = fx.words.map((w) => ({ t: w.t, c: tiltedQuad(w.rect, PAGE_TILT), l: w.l, p: w.p }));
  return { engine: "mlkit", width: fx.imageWidth, height: fx.imageHeight, rotation: 0, words, lines };
}

/** Kâğıt kadrajda `deg` kadar saat yönünde dönmüş gibi kare (dörtgen köşe sırası metne göre korunur). */
function turnedFrame(deg: number): ClientOcr {
  const b = baseFrame();
  const t = orientationTransform(deg, b.width, b.height);
  const m = (q: P[]): P[] => q.map((p) => t.toUpright(p).map((v) => Math.round(v * 10) / 10) as P);
  return { ...b, width: Math.ceil(t.width), height: Math.ceil(t.height), words: b.words.map((w) => ({ ...w, c: m(w.c) })), lines: b.lines!.map((l) => ({ ...l, c: m(l.c) })) };
}

function fields(ocr: OcrResult) {
  const r = extractDocument(ocr, [tpl], null).regions[0];
  return { templateId: r?.templateId ?? null, f: r?.fields?.fields ?? {}, regionTop: r?.region.rect.y ?? 0 };
}
const val = (fs: ReturnType<typeof fields>["f"], k: string): string | null => fs[k]?.value ?? null;
const near = (a: number, b: number, tol: number): boolean => Math.abs(signedDeg(a - b)) <= tol;

// ── §1 dönüşüm ────────────────────────────────────────────────────────────────
{
  const old = (r: OcrRect, rot: number, pw: number, ph: number): OcrRect => {
    if (rot === 90) return { x: r.y, y: pw - (r.x + r.width), width: r.height, height: r.width };
    if (rot === 270) return { x: ph - (r.y + r.height), y: r.x, width: r.height, height: r.width };
    if (rot === 180) return { x: pw - (r.x + r.width), y: ph - (r.y + r.height), width: r.width, height: r.height };
    return r;
  };
  const r = { x: 120.5, y: 300, width: 210, height: 44 };
  const same = [0, 90, 180, 270].every((rot) => JSON.stringify(rectToPhotoFrame(r, rot, 1944, 2592)) === JSON.stringify(old(r, rot, 1944, 2592)));
  check("§1a rectToPhotoFrame (sayfa-yonu tek kaynak) eski çeyrek formülleriyle BİREBİR", same);
  check("§1b photoFrameSize 90'da takas, 180'de aynı", JSON.stringify(photoFrameSize(90, 10, 20)) === '{"width":20,"height":10}' && JSON.stringify(photoFrameSize(180, 10, 20)) === '{"width":10,"height":20}');
  const okRound = [15, 33, 90, 135, 200, 270, 345].every((d) => {
    const t = orientationTransform(d, 1000, 700);
    const p: P = [123, 456];
    const q = t.toSource(t.toUpright(p));
    return Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6;
  });
  check("§1c gidiş-dönüş (toUpright→toSource) her açıda aynı nokta", okRound);
}

// ── §2 dönük fikstür → dikleştir → alanlar ───────────────────────────────────
const ANGLES = [0, 15, 30, 45, 90, 135, 180, 270, -20];
for (const d of ANGLES) {
  const frame = turnedFrame(d);
  const up = uprightClientOcr(frame, "ANY");
  const expectTurn = -d - PAGE_TILT;
  const { templateId, f } = fields(clientOcrToResult(up.ocr));
  const got = `açı ${up.turnDeg.toFixed(1)} · kg ${val(f, "toplamKg")} · m ${val(f, "toplamMetre")} · en ${val(f, "en")} · kumaş ${val(f, "desen")} · renk ${val(f, "renk")} · parti ${val(f, "partiNo")}`;
  check(`§2 ${d}° dönük kare: baskın açı bulunur (beklenen ${signedDeg(expectTurn).toFixed(1)}° ±1)`, near(up.turnDeg, expectTurn, 1), got);
  check(`§2 ${d}°: kg 734 · metre 241 · en 350 · kumaş · renk · parti no doğru (komşu alana kayma yok)`,
    templateId === tpl.id && val(f, "toplamKg") === "734" && val(f, "toplamMetre") === "241" && val(f, "en") === "350" &&
      val(f, "desen") === "9999-99 ÖRNEK KUMAŞ BEJ" && val(f, "renk") === "99 ÖRNEK KUMAŞ BEJ" && val(f, "partiNo") === "ISM9439770", got);
}
{
  const q90 = uprightClientOcr(turnedFrame(-90), "QUARTER");
  const q270 = uprightClientOcr(turnedFrame(90), "QUARTER");
  const q30 = uprightClientOcr(turnedFrame(30), "QUARTER");
  check("§2q ÇEYREK kip: −90° dönük → rotation 90, +90° → rotation 270, 30° → dokunulmaz (artık eğim motorda)",
    q90.ocr.rotation === 90 && q270.ocr.rotation === 270 && q30.turnDeg === 0 && q90.ocr.width === fx.imageWidth, `${q90.ocr.rotation}/${q270.ocr.rotation}/${q30.turnDeg}`);
  const fq = fields(clientOcrToResult(q90.ocr)).f;
  check("§2r ÇEYREK kip 90°: kg/metre/en doğru", val(fq, "toplamKg") === "734" && val(fq, "toplamMetre") === "241" && val(fq, "en") === "350");
  const already = uprightClientOcr({ ...turnedFrame(90), rotation: 90 }, "ANY");
  check("§2s cihaz zaten dikleştirdiyse (rotation≠0) kare AYNEN döner", already.turnDeg === 0 && already.transform === null);
}

// ── §3 dikleştirmeden okuma = hata ───────────────────────────────────────────
{
  const { f } = fields(clientOcrToResult(turnedFrame(-90)));
  const wrong = val(f, "toplamKg") !== "734" || val(f, "toplamMetre") !== "241" || val(f, "en") !== "350";
  check("§3 dönük kare dikleştirilmeden okununca kg/metre/en doğru ÇIKMAZ (normalizasyon gerekli)", wrong,
    `kg ${val(f, "toplamKg")} · m ${val(f, "toplamMetre")} · en ${val(f, "en")}`);
}

// ── §4 değer kutusu kare çerçevesine geri döner ──────────────────────────────
{
  const frame = turnedFrame(-90);
  const up = uprightClientOcr(frame, "ANY");
  const { f, regionTop } = fields(clientOcrToResult(up.ocr));
  const rect = f.toplamKg?.source.rect;
  const back = rect && up.transform ? rectToSource({ ...rect, y: rect.y + regionTop }, up.transform) : null;
  const kgWords = frame.words.filter((w) => w.t === "734,00");
  const kgWord = kgWords[kgWords.length - 1]!;
  const cx = kgWord.c.reduce((a, p) => a + p[0], 0) / 4, cy = kgWord.c.reduce((a, p) => a + p[1], 0) / 4;
  const inside = !!back && cx >= back.x && cx <= back.x + back.width && cy >= back.y && cy <= back.y + back.height;
  check("§4 kg kutusu (dik çerçeve) kareye geri çevrilince döndürülmüş karedeki '734,00' kelimesini kapsar", inside, JSON.stringify(back));
}

// ── §5 etiket değer olamaz ───────────────────────────────────────────────────
{
  const g = labelGuardFor(tpl);
  check("§5a tam etiket (GENEL sözlüğü 'Tarih', büyük/küçük + ':' yok sayılır) etikettir", isLabelValue("TARİH", "TARİH", g) && isLabelValue("Tarih", "Tarih:", g));
  check("§5b yalnız şablon etiket kelimeleri ('Parti NO', 'MÜŞTERİ') etikettir; ':' ile biten rakamsız ham ('Taşıma Tipi:') etikettir",
    isLabelValue("Parti NO", "Parti NO", g) && isLabelValue("MÜŞTERİ", "MÜŞTERİ", g) && isLabelValue("Taşıma Tipi", "Taşıma Tipi:", g));
  check("§5c gerçek değerler ve tanıma anahtarındaki firma adı etiket DEĞİL",
    !isLabelValue("58 KOYU BEJ FULAR", "58 KOYU BEJ FULAR", g) && !isLabelValue("ISM9439770", "ISM9439770", g) &&
      !isLabelValue("ÖRNEK TEKSTİL", "ÖRNEK TEKSTİL", g) && !isLabelValue("HAM", "HAM", g) && !isLabelValue("12:30", "12:30", g));
  // Motor ucu: konum yedeği komşu etiketi kapınca alan boş kalır (dönük karede olan buydu).
  const h = 40;
  const line = (text: string, x: number, y: number) => {
    const ws = text.split(" ");
    let cx = x;
    const elements = ws.map((t) => { const r = { x: cx, y, width: t.length * 20, height: h }; cx += t.length * 20 + 16; return { text: t, rect: r, confidence: 0.95 }; });
    const rect = { x, y, width: cx - x - 16, height: h };
    return { text, rect, confidence: 0.95, angle: 0, elements };
  };
  const ls = [line("Taşıma Tipi:", 100, 100), line("Tarih", 100, 300), line("Renk:", 100, 500), line("KOYU BEJ", 260, 500)];
  const ocr: OcrResult = { text: ls.map((l) => l.text).join("\n"), blocks: ls.map((l) => ({ text: l.text, rect: l.rect, lines: [l] })), imageWidth: 1000, imageHeight: 1000 };
  const t: DocumentTemplate = {
    id: "u-etiket-sonda", name: "sonda", version: 1, identifiers: { keywords: ["sonda"] },
    fields: [
      { key: "renk", label: "Gelen renk", type: "text", strategies: [{ kind: "anchor", labels: ["Islem"], direction: "right" }, { kind: "roi", roi: { x: 0.09, y: 0.09, w: 0.3, h: 0.06 }, fallback: true }] },
      { key: "partiNo", label: "Parti No", type: "alnum", strategies: [{ kind: "roi", roi: { x: 0.09, y: 0.29, w: 0.3, h: 0.06 }, fallback: true }] },
      { key: "desen", label: "Gelen kumaş", type: "text", strategies: [{ kind: "anchor", labels: ["Renk"], direction: "right" }] },
    ],
  };
  const r = extractFields(ocr, t).fields;
  check("§5d konum yedeği 'Taşıma Tipi:' etiketini kapınca renk BOŞ + label-as-value", r.renk!.value === null && r.renk!.issues.includes(LABEL_AS_VALUE), JSON.stringify({ v: r.renk!.value, i: r.renk!.issues }));
  check("§5e parti no 'Tarih' etiketini kapınca BOŞ + label-as-value", r.partiNo!.value === null && r.partiNo!.issues.includes(LABEL_AS_VALUE), JSON.stringify({ v: r.partiNo!.value, i: r.partiNo!.issues }));
  check("§5f etiketin sağındaki gerçek değer kabul edilir ('KOYU BEJ')", r.desen!.value === "KOYU BEJ", String(r.desen!.value));
  // §5g: konum yedeği İKİ etiketi birden kapınca `stripSpaces` değeri "TARİHMÜŞTERİ" yapar — ham metin denetlenir (GB0911260050).
  check("§5g ham metni yalnız etiket parçası ('Tarih Müşteri' → 'TARİHMÜŞTERİ') etikettir; rakamlı/gerçek kelimeli ham değil",
    isLabelValue("TARİHMÜŞTERİ", "Tarih Müşteri", g) && isLabelValue("PARTINO", "Parti NO", g) &&
      !isLabelValue("ISM1439770", "ISM 1439770", g) && !isLabelValue("KOYUBEJ", "KOYU BEJ", g) && !isLabelValue("TARIH58", "Tarih 58", g));
  const ls2 = [line("Tarih", 100, 300), line("Müşteri", 100, 345)];
  const ocr2: OcrResult = { text: ls2.map((l) => l.text).join("\n"), blocks: ls2.map((l) => ({ text: l.text, rect: l.rect, lines: [l] })), imageWidth: 1000, imageHeight: 1000 };
  const t2: DocumentTemplate = { id: "u-etiket-sonda2", name: "sonda", version: 1, identifiers: { keywords: ["sonda"] }, fields: [
    { key: "partiNo", label: "Parti No", type: "alnum", postProcess: ["upper", "stripSpaces"], strategies: [{ kind: "anchor", labels: ["İş Emri"], direction: "right" }, { kind: "roi", roi: { x: 0.09, y: 0.29, w: 0.3, h: 0.1 }, fallback: true }] },
  ] };
  const r2 = extractFields(ocr2, t2).fields;
  check("§5h motor: parti no konum yedeği 'Tarih' + 'Müşteri' etiketlerini kapınca BOŞ + label-as-value (TARİHMÜŞTERİ değil)",
    r2.partiNo!.value === null && r2.partiNo!.issues.includes(LABEL_AS_VALUE), JSON.stringify({ v: r2.partiNo!.value, i: r2.partiNo!.issues }));
}

// ── §6 skipWords sütun aralığını aşar ───────────────────────────────────────
{
  const up = uprightClientOcr(turnedFrame(0), "ANY");
  const { f } = fields(clientOcrToResult(up.ocr));
  check("§6 'TOPLAM 241,00 MT   734,00 KG' → kg ANCHOR'dan (konum yedeği değil) 734", val(f, "toplamKg") === "734" && f.toplamKg?.source.strategy === "anchor", `${val(f, "toplamKg")} · ${f.toplamKg?.source.strategy}`);
}

// ── §7 makul olmayan değer reddi ────────────────────────────────────────────
{
  const en: FieldSpec = { key: "en", label: "En (cm)", type: "decimal", strategies: [] };
  const kg: FieldSpec = { key: "toplamKg", label: "Gelen kg", type: "decimal", strategies: [] };
  const parti: FieldSpec = { key: "partiNo", label: "Parti No", type: "alnum", strategies: [] };
  check("§7a sayısal alanda tarih biçimi (20.10.2026 · 20/10/2026) reddedilir", implausibleReason(en, "20102026", "20.10.2026") === DATE_AS_NUMBER && implausibleReason(kg, "20102026", "20/10/2026") === DATE_AS_NUMBER);
  check("§7b en 10–700 dışı reddedilir (20102026 · 5), 350 kabul; şablon max'ı aralığı ezer",
    implausibleReason(en, "20102026", "20102026") === OUT_OF_PLAUSIBLE_RANGE && implausibleReason(en, "5", "5") === OUT_OF_PLAUSIBLE_RANGE &&
      implausibleReason(en, "350", "350,00") === null && implausibleReason({ ...en, max: 300 }, "350", "350,00") === OUT_OF_PLAUSIBLE_RANGE);
  check("§7c parti no'da yalnız virgüllü ondalık ('0,00', '1.234,50') reddedilir; 'ISM9439770', '12.345' kabul",
    implausibleReason(parti, "0,00", "0,00") === NUMBER_AS_BATCH && implausibleReason(parti, "1.234,50", "1.234,50") === NUMBER_AS_BATCH &&
      implausibleReason(parti, "ISM9439770", "ISM9439770") === null && implausibleReason(parti, "12.345", "12.345") === null);
  // Motor ucu: çapanın sağındaki komşu değer (tarih / "0,00") alana girmez.
  const h = 40;
  const mk = (text: string, x: number, y: number) => {
    let cx = x;
    const elements = text.split(" ").map((t) => { const r = { x: cx, y, width: t.length * 20, height: h }; cx += t.length * 20 + 16; return { text: t, rect: r, confidence: 0.95 }; });
    const l = { text, rect: { x, y, width: cx - x - 16, height: h }, confidence: 0.95, angle: 0, elements };
    return { text, rect: l.rect, lines: [l] };
  };
  const blocks = [mk("Mamül En:", 100, 100), mk("20.10.2026", 400, 100), mk("Iş Emri", 100, 300), mk("0,00", 400, 300)];
  const ocr: OcrResult = { text: blocks.map((b) => b.text).join("\n"), blocks, imageWidth: 1000, imageHeight: 1000 };
  const t: DocumentTemplate = { id: "u-deger-sonda", name: "sonda", version: 1, identifiers: { keywords: ["sonda"] }, fields: [
    { ...en, strategies: [{ kind: "anchor", labels: ["Mamül En"], direction: "right" }] },
    { ...parti, postProcess: ["upper", "stripSpaces"], strategies: [{ kind: "anchor", labels: ["Iş Emri"], direction: "right" }] },
  ] };
  const r = extractFields(ocr, t).fields;
  check("§7d motor: 'Mamül En' sağındaki tarih en'e GİRMEZ (null + date-as-number)", r.en!.value === null && r.en!.issues.includes(DATE_AS_NUMBER), JSON.stringify({ v: r.en!.value, i: r.en!.issues }));
  check("§7e motor: parti no çapasının sağındaki '0,00' GİRMEZ (null + number-as-batch)", r.partiNo!.value === null && r.partiNo!.issues.includes(NUMBER_AS_BATCH), JSON.stringify({ v: r.partiNo!.value, i: r.partiNo!.issues }));
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
