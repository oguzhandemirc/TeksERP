// test_gelen_belge_motor §18 (belge tanıt 3 aşama B1, 2026-11-09): metre ↔ kg aynı hücre. Demo ölçümü (u-komurhan-ceki-listesi
// v3): "Hedef kg" ve "Gelen metre" aynı etiketten ("TOPLAM" → sağ) okunuyordu, kg = metre = 241. Sentetik fikstür aynı satır
// düzenini kurar: "TOPLAM | 241,00 MT | 734,00 KG | 0,00 MT". Saf (DB'siz).
// Negatif sondalar: `learnAnchorSkip` 0 döndürülünce §18a/§18b ❌ · `meterKgClashes` boş döndürülünce §18c/§18d/§18f ❌.
import { extractDocument, mergeTemplateForUpdate, meterKgClashErrors, meterKgClashes, suggestTemplate, validateTemplate, type AssignableField, type DocumentTemplate, type OcrBlock, type OcrRect, type OcrResult } from "../../src/lib/gelen-belge/motor";
import { guardKgFields } from "../../src/lib/gelen-belge/kg-koruma";
import { setUserTemplates } from "../../src/lib/gelen-belge/sablon-bul";

type Check = (label: string, ok: boolean, detay?: string) => void;
type Word = [text: string, x: number, w: number];

function line(y: number, words: Word[]): OcrBlock {
  const elements = words.map(([text, x, w]) => ({ text, rect: { x, y, width: w, height: 60 }, confidence: 0.99 }));
  const x0 = Math.min(...elements.map((e) => e.rect.x));
  const x1 = Math.max(...elements.map((e) => e.rect.x + e.rect.width));
  const rect: OcrRect = { x: x0, y, width: x1 - x0, height: 60 };
  const text = words.map((w) => w[0]).join(" ");
  return { text, rect, lines: [{ text, rect, confidence: 0.99, angle: 0, elements }] };
}

function belge(): OcrResult {
  const blocks = [
    line(100, [["KÖMÜRHAN", 300, 300], ["ÇEKİ", 620, 150], ["LİSTESİ", 790, 220]]),
    line(1280, [["TOPLAM", 194, 219]]),
    line(1277, [["241,00", 547, 170], ["MT", 730, 77]]),
    line(1276, [["734,00", 879, 170], ["KG", 1060, 67]]),
    line(1275, [["0,00", 1252, 120], ["MT", 1380, 61]]),
  ];
  return { text: blocks.map((b) => b.text).join("\n"), blocks, imageWidth: 2592, imageHeight: 1944 };
}

const wordRect = (ocr: OcrResult, text: string): OcrRect => ocr.blocks.flatMap((b) => b.lines).flatMap((l) => l.elements ?? []).find((e) => e.text === text)!.rect;

function teach(ocr: OcrResult, assignments: Array<{ field: AssignableField; word: string }>) {
  return suggestTemplate({ code: "u-olcu", name: "Ölçü", ocr, identifiers: ["KÖMÜRHAN", "ÇEKİ LİSTESİ"], assignments: assignments.map((a) => ({ field: a.field, rect: wordRect(ocr, a.word) })) });
}

export function olcuCakisma(check: Check): void {
  const ocr = belge();
  for (const kgField of ["toplamKg", "hedefKg"] as const) {
    const s = teach(ocr, [{ field: "toplamMetre", word: "241,00" }, { field: kgField, word: "734,00" }]);
    const st = s.template.fields.find((f) => f.key === kgField)?.strategies[0];
    const skip = st?.kind === "anchor" ? st.skipWords : undefined;
    check(`§18a ⭐ ${kgField}: aynı etiketin sağındaki ikinci değer — atlama öğrenildi (skipWords 2), hata yok`, s.errors.length === 0 && skip === 2, `${JSON.stringify(s.errors)} skip=${String(skip)}`);
    const f = extractDocument(ocr, [s.template], null).regions[0]?.fields?.fields;
    check(`§18b ⭐ ${kgField}: okuma kg = 734, metre = 241 (241 = 241 yok)`, Number(f?.[kgField]?.value) === 734 && Number(f?.toplamMetre?.value) === 241, `${String(f?.[kgField]?.value)} / ${String(f?.toplamMetre?.value)}`);
  }
  // Eski bozuk şablon (atlamasız aynı anchor) — demo v3'ün biçimi.
  const good = teach(ocr, [{ field: "toplamMetre", word: "241,00" }, { field: "hedefKg", word: "734,00" }]).template;
  const bad: DocumentTemplate = JSON.parse(JSON.stringify(good));
  const kgSt = bad.fields.find((f) => f.key === "hedefKg")!.strategies[0]!;
  if (kgSt.kind === "anchor") delete kgSt.skipWords;
  check("§18c ⭐ eski şablon (aynı etiket + yön, atlamasız) çakışma sayılır", JSON.stringify(meterKgClashes(bad)) === JSON.stringify([{ kg: "hedefKg", meter: "toplamMetre" }]) && meterKgClashes(good).length === 0);
  const same = teach(ocr, [{ field: "toplamMetre", word: "241,00" }, { field: "hedefKg", word: "241,00" }]);
  check("§18d ⭐ aynı kutu iki alana → tanıtma hatası (iki alan adı)", same.errors.some((e) => e.includes("Aynı kutu") && e.includes("Gelen metre") && e.includes("Hedef kg")), JSON.stringify(same.errors));
  check("§18e skipWords doğrulaması fail-closed (0 ve 21 reddedilir)", [0, 21, 1.5].every((n) => {
    const t: DocumentTemplate = JSON.parse(JSON.stringify(good));
    const a = t.fields.find((f) => f.key === "hedefKg")!.strategies[0]!;
    if (a.kind === "anchor") a.skipWords = n;
    return !validateTemplate(t).ok;
  }) && validateTemplate(good).ok);
  // Güncelleme birleşimi: eski bozuk kg alanı korunur → birleşik şablon da kapıya takılır.
  const nextOnlyMeter = teach(ocr, [{ field: "toplamMetre", word: "241,00" }]).template;
  check("§18f ⭐ güncelleme birleşimi eski çakışan kg alanını taşırsa hata verir", meterKgClashErrors(mergeTemplateForUpdate(bad, nextOnlyMeter, [])).length === 1);
  // Okuma koruması: şablon çakışması ya da kayıtlı değer eşitliği.
  setUserTemplates([{ ...bad, id: "u-olcu-bozuk" }]);
  const g1 = guardKgFields({ templateId: "u-olcu-bozuk", fields: { hedefKg: "241.00", toplamMetre: "241.00", en: "350" } });
  const g2 = guardKgFields({ templateId: null, fields: { toplamKg: "241", hedefMetraj: "241" } });
  const g3 = guardKgFields({ templateId: null, fields: { toplamKg: "734", toplamMetre: "241" } });
  setUserTemplates([]);
  check("§18g ⭐ okuma koruması: çakışan şablonda kg düşer, öteki alan kalır", JSON.stringify(g1.dropped) === '["hedefKg"]' && g1.fields.hedefKg === undefined && g1.fields.en === "350");
  check("§18h ⭐ şablon bilinmese de kg = metre birebir → düşer; farklı değer kalır", JSON.stringify(g2.dropped) === '["toplamKg"]' && g3.dropped.length === 0 && g3.fields.toplamKg === "734");
}
