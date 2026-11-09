// test_gelen_belge_motor §18 (belge tanıt 3 aşama B1, 2026-11-09): metre ↔ kg aynı hücre. Demo ölçümü (u-komurhan-ceki-listesi
// v3): "Hedef kg" ve "Gelen metre" aynı etiketten ("TOPLAM" → sağ) okunuyordu, kg = metre = 241. Sentetik fikstür aynı satır
// düzenini kurar: "TOPLAM | 241,00 MT | 734,00 KG | 0,00 MT". Saf (DB'siz).
// Negatif sondalar: `learnAnchorSkip` 0 döndürülünce §18a/§18b ❌ · `meterKgClashes` boş döndürülünce §18c/§18d/§18f ❌.
// §18i–l (2026-11-09 tablet, Gülkesim 214279 çok blok): "T.Adet 5 | 141,70 | 586,00" ayrı OCR satırları (gerçek taramanın
// koordinatları), kg → 141,70, metre → 586,00, bölüm alanı. Ölçülen kök neden: etiket "T.Adet 5" (adet dahil), atlama probu
// sütun aralığında kesiyordu → iki alan skip 0 → "aynı kutu" reddi. Sondalar (2026-11-09, hepsi ❌ görüldü): eski prob
// (tek skip 0, sütunda keser) → §18i–l · okuyucuda aynı satır atlaması banda devredilmeyince → §18i · bant satır merkezi
// yerine kelime merkezi → §18j · ölçü alanı roi yedeği kaldırılınca → §18l · bölüm alanı adet satırı gevşetmesi → §18i.
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
  adetSatiri(check);
}

type Box = [text: string, x: number, y: number, w: number, h: number];

function satir(els: Box[]): OcrBlock {
  const elements = els.map(([text, x, y, w, h]) => ({ text, rect: { x, y, width: w, height: h }, confidence: 0.99 }));
  const rect = { x: Math.min(...elements.map((e) => e.rect.x)), y: Math.min(...elements.map((e) => e.rect.y)), width: 0, height: 0 };
  rect.width = Math.max(...elements.map((e) => e.rect.x + e.rect.width)) - rect.x;
  rect.height = Math.max(...elements.map((e) => e.rect.y + e.rect.height)) - rect.y;
  const text = els.map((e) => e[0]).join(" ");
  return { text, rect, lines: [{ text, rect, confidence: 0.99, angle: 0, elements }] };
}

/** 214279 taramasının (dik çerçeve, 1944x2592) ilgili satırları; kimlikler anonim, geometri gerçek. */
function cekiAdet(): OcrResult {
  const blocks = [
    satir([["KUMAŞ", 300, 120, 160, 40], ["ÇEKİ", 470, 120, 110, 40], ["LİSTESİ", 590, 120, 180, 40]]),
    satir([["Sipariş", 185, 312, 82, 37], ["No", 277, 312, 31, 34]]),
    satir([["Ham", 230, 700, 50, 24], ["PartiNo", 290, 700, 90, 24], ["P9918733", 400, 700, 120, 24]]),
    satir([["T.Adet", 230, 1098, 76, 24], ["5", 343, 1102, 12, 18]]),
    satir([["141,70", 556, 1097, 74, 28]]),
    satir([["586,00", 681, 1100, 72, 24]]),
    satir([["|Sipariş", 230, 1140, 82, 27], ["No", 321, 1142, 27, 26]]),
    satir([["Ham", 230, 1500, 50, 24], ["PartiNo", 290, 1500, 90, 24], ["P9918734", 400, 1500, 120, 24]]),
  ];
  return { text: blocks.map((b) => b.text).join("\n"), blocks, imageWidth: 1944, imageHeight: 2592 };
}

function adetSatiri(check: Check): void {
  const ocr = cekiAdet();
  const ogret = (section: boolean, o: OcrResult = ocr) => suggestTemplate({
    code: "u-adet", name: "Adet satırı", ocr: o, identifiers: ["KUMAŞ ÇEKİ LİSTESİ"],
    ...(section ? { sectionStartLabel: "Sipariş No", table: { columns: [{ key: "kg" as const, header: "Kilo" }, { key: "m" as const, header: "Metre" }], totalsLabel: null } } : {}),
    assignments: [
      { field: "partiNo", rect: wordRect(o, "P9918733"), ...(section ? { section: true } : {}) },
      { field: "toplamMetre", rect: wordRect(o, "586,00"), ...(section ? { section: true } : {}) },
      { field: "toplamKg", rect: wordRect(o, "141,70"), ...(section ? { section: true } : {}) },
    ],
  });
  const strat = (t: DocumentTemplate, k: string) => t.fields.find((f) => f.key === k)?.strategies[0];
  const sec = ogret(true);
  const m = strat(sec.template, "toplamMetre");
  const kg = strat(sec.template, "toplamKg");
  const ok = m?.kind === "anchor" && kg?.kind === "anchor" && m.labels[0] === "T.Adet" && kg.labels[0] === "T.Adet" && m.skipWords === 2 && kg.skipWords === 1;
  check("§18i ⭐ adet satırında yan yana iki toplam (bölüm alanı): etiket 'T.Adet' (adetsiz), kg skip 1 · metre skip 2, kayıt geçer", sec.errors.length === 0 && ok,
    JSON.stringify({ e: sec.errors, m, kg }));
  const reg = extractDocument(ocr, [sec.template], null).regions[0];
  const s1 = reg?.sections?.sections[0]?.fields;
  check("§18j ⭐ bölüm 1 okuması kg = 141,7 · metre = 586 (sınırdaki satır iki banda bölünmez)", Number(s1?.toplamKg?.value) === 141.7 && Number(s1?.toplamMetre?.value) === 586,
    `${String(s1?.toplamKg?.value)} / ${String(s1?.toplamMetre?.value)}`);
  const hdr = ogret(false);
  const f = extractDocument(ocr, [hdr.template], null).regions[0]?.fields?.fields;
  check("§18k ⭐ başlık alanı (bölümsüz, tablosuz): hata yok, kg = 141,7 · metre = 586", hdr.errors.length === 0 && Number(f?.toplamKg?.value) === 141.7 && Number(f?.toplamMetre?.value) === 586,
    JSON.stringify({ e: hdr.errors, kg: f?.toplamKg?.value, m: f?.toplamMetre?.value }));
  // Etiket bulunur (sol satırla dikey kesişim) ama okuyucu bandı dışında kalan uzun hücreler: çapa dokunulana ulaşamaz.
  const uzun: OcrResult = { ...ocr, blocks: ocr.blocks.map((b) => (b.text === "141,70" || b.text === "586,00" ? satir([[b.text, b.rect.x, 1098, b.rect.width, 150]]) : b)) };
  const roi = ogret(false, uzun);
  check("§18l ⭐ çapa dokunulan kutuya ulaşamıyorsa ölçü alanı konumla (roi) kaydedilir, çakışma yok, değerler ayrı",
    roi.errors.length === 0 && strat(roi.template, "toplamMetre")?.kind === "roi" && strat(roi.template, "toplamKg")?.kind === "roi"
      && Number(extractDocument(uzun, [roi.template], null).regions[0]?.fields?.fields.toplamMetre?.value) === 586,
    JSON.stringify({ e: roi.errors, m: strat(roi.template, "toplamMetre"), kg: strat(roi.template, "toplamKg") }));
}

