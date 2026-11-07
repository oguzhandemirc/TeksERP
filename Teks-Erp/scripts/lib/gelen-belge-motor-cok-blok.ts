// test_gelen_belge_motor §16 (Gülkesim çok blok, 2026-11-06): 0245'ten sentetik varyantlar — ara toplamın yeri/yokluğu/yanlışı,
// sütun taşması (V6: blok 2'nin sıra 15–21'i sağ sütunun üstüne), aynı işlem iki blok, sıra no ↔ konum çelişkisi. Saf (DB'siz).
import { extractDocument, suggestTemplate, type DocumentTemplate, type OcrLine, type OcrResult } from "../../src/lib/gelen-belge/motor";
import { draftFromExtraction } from "../../src/lib/gelen-belge/taslak";

type Check = (label: string, ok: boolean, detay?: string) => void;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Satır + kutularını taşı/değiştir; `null` dönen satır silinir. */
function edit(src: OcrResult, fn: (l: OcrLine) => OcrLine | null): OcrResult {
  const o = clone(src);
  o.blocks = o.blocks.map((b) => ({ ...b, lines: b.lines.map(fn).filter((l): l is OcrLine => l !== null) })).filter((b) => b.lines.length > 0);
  return o;
}
const move = (l: OcrLine, dx: number, dy: number): OcrLine => {
  const r = (x: { x: number; y: number }) => { x.x += dx; x.y += dy; };
  r(l.rect);
  l.elements.forEach((e) => r(e.rect));
  return l;
};
const retext = (l: OcrLine, text: string): OcrLine => ({ ...l, text, elements: l.elements.map((e, i) => ({ ...e, text: i === 0 ? text : "" })).filter((e) => e.text) });

/** Sağ üstteki "T.Adet 16 819,20 3.935,00" (blok 2'nin ara toplamı) satırı. */
const topRight = (l: OcrLine) => l.rect.y < 300 && l.rect.y > 260 && l.rect.x > 780 && l.rect.x < 1300;
/** Blok 1'in kendi "T.Adet 5 141,70 586,00" satırı. */
const block1Total = (l: OcrLine) => l.rect.y > 930 && l.rect.y < 960;
/** Blok 2'nin sıra 15–21 satırları. */
const tail = (l: OcrLine) => l.rect.y >= 1920 && l.rect.y < 2240 && l.rect.x < 800;
/** Taşma: sıra 15–21 sağ sütuna, sayfanın üstüne (y 400'den). */
const spilled = (l: OcrLine) => (tail(l) ? move(l, 900, 400 - 1920) : l);

function run(ocr: OcrResult, sablonlar: DocumentTemplate[]) {
  const d = draftFromExtraction(extractDocument(ocr, sablonlar));
  const per = [1, 2].map((b) => d.lines.filter((l) => l.blockNo === b).length);
  const tb = d.header.totalsDeclared.blocks;
  const w = d.header.warnings;
  const has = (code: string, blok?: number) => w.some((x) => x.startsWith(code) && (blok === undefined || x.includes(`blok ${blok}`)));
  return { d, per, tb, w, has, info: JSON.stringify({ per, tb: tb.map((b) => [b.blockNo, b.count, b.m, b.batchNo]), w: w.map((x) => x.slice(0, 60)) }) };
}

export function cokBlok(check: Check, gercek: (ad: string) => OcrResult, sablonlar: DocumentTemplate[]): void {
  const base = gercek("0245-ceki-listesi-a");
  const X: Record<string, number> = { "T.Adet": 234, "16": 345, "819,20": 572, "3.935,00": 704 };
  const v1 = run(edit(base, (l) => (topRight(l) ? move(l, (X[l.text] ?? l.rect.x) - l.rect.x, 2270 - l.rect.y) : l)), sablonlar);
  check("§16a V1 ara toplam SOL ALTTA: yine blok 2'ye (Σ), 5 + 16 satır, uyarısız toplam",
    v1.per.join() === "5,16" && v1.tb[1]?.m === "3935" && v1.tb[0]?.m === "586" && !v1.has("TOTAL_"), v1.info);
  const v2 = run(edit(base, (l) => (l.text === "3.935,00" ? retext(l, "3.936,00") : l)), sablonlar);
  check("§16b V2 ara toplam 1 m yanlış: blok 2'ye bağlanır, TOTAL_MISMATCH (sert kapı) + SECTION_SUBTOTAL_MISMATCH",
    v2.per.join() === "5,16" && v2.has("TOTAL_MISMATCH", 2) && v2.has("SECTION_SUBTOTAL_MISMATCH") && !v2.has("TOTAL_MISMATCH", 1), v2.info);
  const v3 = run(edit(base, (l) => (block1Total(l) ? null : l)), sablonlar);
  check("§16c V3 blok 1'in ara toplamı yok: blok 1 TOTAL_UNVERIFIED, sağ üst yine blok 2'de",
    v3.per.join() === "5,16" && v3.has("TOTAL_UNVERIFIED", 1) && v3.tb[1]?.m === "3935", v3.info);
  const v4 = run(edit(base, (l) => (topRight(l) ? null : l)), sablonlar);
  check("§16d V4 sağ üst toplam yok: blok 2 TOTAL_UNVERIFIED, blok 1 doğrulandı",
    v4.per.join() === "5,16" && v4.has("TOTAL_UNVERIFIED", 2) && !v4.has("TOTAL_UNVERIFIED", 1), v4.info);
  const v6 = run(edit(base, spilled), sablonlar);
  check("§16e ⭐ V6 sütun taşması: 21/21 satır doğru blokta (5 + 16), Σ blok 2 = 3935 tutar, TOTAL_MISMATCH yok",
    v6.per.join() === "5,16" && v6.tb[1]?.m === "3935" && !v6.has("TOTAL_MISMATCH") && !v6.has("SECTION_SUBTOTAL_MISMATCH")
      && v6.d.lines.filter((l) => l.blockNo === 2).map((l) => l.senderRollNo).includes("99210046"), v6.info);
  // Taşan sütunun başında başlık tekrarı ("Sıra No Top No Kilo Metre") → kayma başlıktan ölçülür
  const header = edit(base, (l) => (l.rect.y > 1420 && l.rect.y < 1450 ? move(l, 900, 360 - l.rect.y) : null)).blocks;
  const withHeader = edit(base, spilled);
  withHeader.blocks.push(...header);
  const v6h = run(withHeader, sablonlar);
  check("§16f V6 taşan sütunda başlık tekrarı: yine 5 + 16, Σ tutar", v6h.per.join() === "5,16" && !v6h.has("TOTAL_MISMATCH"), v6h.info);
  const v6s = run(edit(base, (l) => (tail(l) && l.text === "21" ? null : spilled(l))), sablonlar);
  check("§16g taşan satırın sıra no'su okunamadı: satır kaybolmaz (blok yedeği) + SECTION_ROW_ORDER_AMBIGUOUS",
    v6s.per.join() === "5,16" && v6s.has("SECTION_ROW_ORDER_AMBIGUOUS"), v6s.info);
  const v7 = run(edit(base, (l) => (l.text.includes("YUMUŞAK APRE") ? retext(l, l.text.replace("YUMUŞAK APRE", "KDK APRE")) : l)), sablonlar);
  check("§16h V7 iki blok aynı işlem: yine 2 blok (birleşmez)", v7.per.join() === "5,16" && v7.tb.length === 2, v7.info);
  const v8 = run(edit(base, (l) => (l.rect.y > 800 && l.rect.y < 830 && l.rect.x < 300 && /^\d$/.test(l.text) ? retext(l, "9") : l)), sablonlar);
  check("§16i sıra no konumla çelişirse konum kalır + SECTION_ROW_ORDER_AMBIGUOUS (OCR rakam düşürebilir)",
    v8.per.join() === "5,16" && v8.has("SECTION_ROW_ORDER_AMBIGUOUS"), v8.info);
  const clean = run(base, sablonlar);
  check("§16j özgün 0245: sıra uyarısı yok, taşma satırı yok", !clean.has("SECTION_ROW_ORDER_AMBIGUOUS") && clean.per.join() === "5,16", clean.info);
}

/** §16k: iki beyansız blokta Σ'sı tutmayan sahipsiz toplam "en yakın" bloğa yapıştırılmaz (R2). */
export function cokBlokSahipsiz(check: Check, gercek: (ad: string) => OcrResult, sablonlar: DocumentTemplate[]): void {
  const ocr = edit(gercek("0245-ceki-listesi-a"), (l) => (block1Total(l) ? null : l.text === "3.935,00" ? retext(l, "3.936,00") : l));
  const r = run(ocr, sablonlar);
  check("§16k iki beyansız blok + Σ tutmayan toplam: hiçbir bloğa bağlanmaz, TABLE_TOTALS_ORPHAN; TOTAL_MISMATCH yanlış partide doğmaz",
    r.has("TABLE_TOTALS_ORPHAN") && !r.has("TOTAL_MISMATCH") && r.has("TOTAL_UNVERIFIED", 1) && r.has("TOTAL_UNVERIFIED", 2), r.info);
}

/** §16l–n (D2): tanıtılmış (`u-`) şablonla 0245 — bölüm başına parti/sipariş/işlem/gönderen İE no + tablo + toplam (S9). */
export function cokBlokTanit(check: Check, gercek: (ad: string) => OcrResult, sablonlar: DocumentTemplate[]): void {
  const ocr = gercek("0245-ceki-listesi-a");
  const els = ocr.blocks.flatMap((b) => b.lines).flatMap((l) => l.elements);
  const rect = (...texts: string[]) => {
    const rs = texts.map((t) => els.find((e) => e.text === t)!.rect);
    const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
    return { x, y, width: Math.max(...rs.map((r) => r.x + r.width)) - x, height: Math.max(...rs.map((r) => r.y + r.height)) - y };
  };
  const base = {
    code: "u-cok-blok", name: "Çok blok çeki", ocr, identifiers: ["KUMAŞ ÇEKİ LİSTESİ", "FIŞ NO", "Ham PartiNo"], sectionStartLabel: "Sipariş No",
    table: { columns: [{ key: "topNo" as const, header: "Top No" }, { key: "kg" as const, header: "Kilo" }, { key: "m" as const, header: "Metre" }], totalsLabel: "T.Adet" },
  };
  const sug = suggestTemplate({
    ...base,
    assignments: [
      { field: "evrakNo", rect: rect("914279") },
      { field: "partiNo", rect: rect("P9918733"), section: true }, { field: "siparisNo", rect: rect("96967"), section: true },
      { field: "islem", rect: rect("KDK", "APRE"), section: true }, { field: "gonderenIsEmriNo", rect: rect("99K-24749"), section: true },
    ],
  });
  const d = draftFromExtraction(extractDocument(ocr, [sug.template, ...sablonlar.filter((t) => t.id === "genel")]), { templates: [sug.template] });
  const tb = d.header.totalsDeclared.blocks;
  check("§16l ⭐ S9 tanıtılmış şablon: 21 satır (5 + 16), 2 parti dolu kimlik (parti/sipariş/işlem/gönderen İE no), kurşun 4521 OUTPUT",
    sug.errors.length === 0 && d.lines.filter((l) => l.blockNo === 1).length === 5 && d.lines.filter((l) => l.blockNo === 2).length === 16
      && tb[0]?.batchNo === "P9918733" && tb[1]?.batchNo === "P9918734" && tb[0]?.orderNo === "96967" && tb[1]?.orderNo === "96966"
      && tb[0]?.processText === "KDK APRE" && tb[1]?.processText === "YUMUŞAK APRE" && tb[0]?.senderWorkOrderNo === "99K-24749" && tb[1]?.senderWorkOrderNo === "99K-24750"
      && d.header.kursun.meters === "4521" && d.header.kursun.source === "OUTPUT",
    JSON.stringify({ e: sug.errors, tb, k: d.header.kursun }));
  const yanlis = suggestTemplate({ ...base, assignments: [{ field: "partiNo", rect: rect("P9918733"), section: true }, { field: "toplamMetre", rect: rect("16") }] });
  check("§16m 'Gelen metre' T.Adet'in sağındaki adede atanırsa öneri reddedilir (Türkçe: Metre sütununu işaretleyin)",
    yanlis.errors.some((e) => e.includes("T.Adet") && e.includes("Metre sütununu")), JSON.stringify(yanlis.errors));
  const tablolu = suggestTemplate({ ...base, assignments: [{ field: "toplamMetre", rect: rect("3.935,00") }] });
  const tablosuz = suggestTemplate({ ...base, table: undefined, sectionStartLabel: null, assignments: [{ field: "toplamMetre", rect: rect("3.935,00") }] });
  check("§16n toplam satırının METRE değeri ('3.935,00'): tablolu belgede reddedilir (tablo toplamı okunur), tablosuz belgede serbest",
    tablolu.errors.some((e) => e.includes("T.Adet")) && tablosuz.errors.length === 0, JSON.stringify({ a: tablolu.errors, b: tablosuz.errors }));
}

/**
 * §16o–p (Gülkesim 214279 provası, 2026-11-06): cihaz OCR'ı (ML Kit) sağ üst ara toplamı iki satıra birleştirir — "|T.Adet 16"
 * (etiket + adet) ve "819,20 3.935,00" (iki sayı tek satır). Toplam yine blok 2'ye bağlanır; satır kaçsa da (Σ tutmaz) tek açık
 * bloğa konumla bağlanır, sahipsiz kalmaz.
 */
export function cokBlokBirlesikToplam(check: Check, gercek: (ad: string) => OcrResult, sablonlar: DocumentTemplate[]): void {
  const base = gercek("0245-ceki-listesi-a");
  const lines = base.blocks.flatMap((b) => b.lines).filter(topRight);
  const el = (t: string) => lines.find((l) => l.text === t)!.elements[0]!;
  const join = (els: OcrLine["elements"], text: string): OcrLine => {
    const x = Math.min(...els.map((e) => e.rect.x)), y = Math.min(...els.map((e) => e.rect.y));
    const rect = { x, y, width: Math.max(...els.map((e) => e.rect.x + e.rect.width)) - x, height: Math.max(...els.map((e) => e.rect.y + e.rect.height)) - y };
    return { text, rect, confidence: null, angle: null, elements: els };
  };
  const merge = (l: OcrLine): OcrLine | null => {
    if (!topRight(l)) return l;
    if (l.text === "T.Adet") return join([{ ...el("T.Adet"), text: "|T.Adet" }, el("16")], "|T.Adet 16");
    if (l.text === "819,20") return join([el("819,20"), el("3.935,00")], "819,20 3.935,00");
    return null;
  };
  const v = run(edit(base, merge), sablonlar);
  check("§16o ⭐ ML Kit birleşik ara toplam ('|T.Adet 16' + '819,20 3.935,00'): blok 2'ye bağlanır (16 · 819.2 · 3935), sahipsiz yok",
    v.per.join() === "5,16" && v.tb[1]?.m === "3935" && v.tb[1]?.kg === "819.2" && v.tb[1]?.count === "16" && !v.has("TABLE_TOTALS_ORPHAN") && !v.has("TOTAL_MISMATCH"), v.info);
  const kacan = run(edit(base, (l) => (tail(l) ? null : merge(l))), sablonlar);
  check("§16p ⭐ birleşik ara toplam + blok 2 satır kaçırdı (Σ tutmaz): tek açık bloğa bağlanır, beyan 3935 korunur, fark TOTAL_MISMATCH blok 2",
    kacan.tb[1]?.m === "3935" && !kacan.has("TABLE_TOTALS_ORPHAN") && kacan.has("TOTAL_MISMATCH", 2) && kacan.tb[0]?.m === "586", kacan.info);
}
