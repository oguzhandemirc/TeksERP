// test_gelen_belge_motor §13 (canlı tablet tanıtma hatası, 2026-11-04): aynı etiket metni sayfada birden çok kez geçince
// ("Müşteri KG" · "Müşteri MT" · "Müşteri:") okuyucu eşitlikte en üsttekini seçip "KG" okuyordu. Saf (DB'siz); dosya boyu yüzünden ayrı.
import { extractDocument, mergeTemplateForUpdate, suggestTemplate, type AnchorStrategy, type DocumentTemplate, type OcrBlock, type OcrRect, type OcrResult } from "../../src/lib/gelen-belge/motor";

type Check = (label: string, ok: boolean, detay?: string) => void;
type Word = [text: string, x: number, y: number, w: number];

/** Tek satırlık blok: kelimeler soldan sağa, yükseklik 30 px. */
function line(words: Word[]): OcrBlock {
  const elements = words.map(([text, x, y, w]) => ({ text, rect: { x, y, width: w, height: 30 }, confidence: 0.99 }));
  const x0 = Math.min(...elements.map((e) => e.rect.x));
  const x1 = Math.max(...elements.map((e) => e.rect.x + e.rect.width));
  const rect: OcrRect = { x: x0, y: elements[0]!.rect.y, width: x1 - x0, height: 30 };
  const text = words.map((w) => w[0]).join(" ");
  return { text, rect, lines: [{ text, rect, confidence: 0.99, angle: 0, elements }] };
}

/** Sentetik form: sağ üstte iki başlık parçası "Müşteri KG/MT" (rakip), solda asıl "Müşteri" + değer "HH". */
function form(opts: { colon: boolean; rivals: boolean }): OcrResult {
  const blocks: OcrBlock[] = [line([["KUMAŞ", 300, 40, 90], ["GİRİŞ", 400, 40, 80], ["FORMU", 490, 40, 90]])];
  if (opts.rivals) {
    blocks.push(line([["Müşteri", 600, 120, 100], ["KG", 710, 120, 30]]), line([["0,00", 780, 120, 60]]));
    blocks.push(line([["Müşteri", 600, 170, 100], ["MT", 710, 170, 30]]), line([["238,00", 780, 170, 90]]));
  }
  blocks.push(line([[opts.colon ? "Müşteri:" : "Müşteri", 60, 300, opts.colon ? 110 : 100]]), line([["HH", 220, 300, 40]]));
  blocks.push(line([["Cinsi:", 600, 300, 80]]), line([["PAMUK", 700, 300, 90]]));
  return { text: blocks.map((b) => b.text).join("\n"), blocks, imageWidth: 1000, imageHeight: 1400 };
}

const rectOf = (ocr: OcrResult, text: string): OcrRect => ocr.blocks.flatMap((b) => b.lines).find((l) => l.text === text)!.rect;
const anchorOf = (t: DocumentTemplate, key: string) => t.fields.find((f) => f.key === key)!.strategies[0] as AnchorStrategy;
const musteriOf = (ocr: OcrResult, t: DocumentTemplate) => extractDocument(ocr, [t], null).regions[0]?.fields?.fields.musteri?.value ?? null;

function teach(ocr: OcrResult, valueText: string, section = false): DocumentTemplate {
  const s = suggestTemplate({
    code: "u-etiket-pencere", name: "Etiket pencere", ocr, identifiers: ["KUMAŞ GİRİŞ FORMU", "Cinsi"],
    assignments: [{ field: "musteri", rect: rectOf(ocr, valueText), section }],
    ...(section ? { sectionStartLabel: "KUMAŞ GİRİŞ FORMU" } : {}),
  });
  if (s.errors.length) throw new Error(`öneri doğrulanmadı: ${s.errors.join(",")}`);
  return s.template;
}

export function etiketPencere(check: Check, gercek: (ad: string) => OcrResult): void {
  // §13a: ayraçsız üç "Müşteri" — eşitlik bozucu yardım edemez, yalnız pencere doğru etiketi seçer.
  const duz = form({ colon: false, rivals: true });
  const tA = teach(duz, "HH");
  check("§13a ⭐ etiket 3 kez geçer (ayraçsız) → öneri pencere ekler, rakip merkezler dışarıda; okuma 'HH' (KG değil)",
    anchorOf(tA, "musteri").window !== undefined && musteriOf(duz, tA) === "HH",
    JSON.stringify({ s: anchorOf(tA, "musteri"), v: musteriOf(duz, tA) }));

  // §13b: tek eşleşme → pencere YOK (kaymış/kırpılmamış fotoğrafta konum bağımlılığı istenmez).
  const tek = form({ colon: false, rivals: false });
  const tB = teach(tek, "HH");
  check("§13b tek eşleşmede pencere eklenmez, değer okunur", anchorOf(tB, "musteri").window === undefined && musteriOf(tek, tB) === "HH",
    JSON.stringify(anchorOf(tB, "musteri")));

  // §13c: pencere öncesi kaydedilmiş şablon (penceresiz) — ayraçlı "Müşteri:" eşitlikte üstteki "Müşteri KG"yi geçer.
  const iki = form({ colon: true, rivals: true });
  const eski: DocumentTemplate = { ...teach(iki, "HH") };
  eski.fields = eski.fields.map((f) => ({ ...f, strategies: f.strategies.map((s) => (s.kind === "anchor" ? { kind: "anchor", labels: s.labels, direction: s.direction } : s)) }));
  check("§13c ⭐ penceresiz eski şablon: ayraçlı etiket ('Müşteri:') eşitlik bozucusu → 'HH'",
    anchorOf(eski, "musteri").window === undefined && musteriOf(iki, eski) === "HH", String(musteriOf(iki, eski)));

  // §13d: bölüm alanı her bölümde ayrı okunur → pencere almaz (ilk bölüme çivilenmez).
  const tD = teach(duz, "HH", true);
  check("§13d bölüm alanına pencere eklenmez", anchorOf(tD, "musteri").window === undefined, JSON.stringify(anchorOf(tD, "musteri")));

  // §13f: "Şablonu güncelle" bölümsüz yeniden atanan alanı (pencereli) eski bölüm kümesinde tutar → bölüm okuması pencereyi yok sayar.
  const c45 = gercek("0245-ceki-listesi-a");
  const el = (t: string) => c45.blocks.flatMap((b) => b.lines).flatMap((l) => l.elements).find((e) => e.text === t)!.rect;
  const ids = ["KUMAŞ ÇEKİ LİSTESİ", "FIŞ NO", "Ham PartiNo"];
  const eskiB = suggestTemplate({ code: "u-45", name: "45", ocr: c45, identifiers: ids, sectionStartLabel: "Sipariş No",
    assignments: [{ field: "partiNo", rect: el("P9918733"), section: true }, { field: "siparisNo", rect: rectOf(c45, "96967"), section: true }],
    table: { columns: [{ key: "topNo", header: "Top No" }, { key: "kg", header: "Kilo" }, { key: "m", header: "Metre" }], totalsLabel: "T.Adet" } }).template;
  const yeniB = suggestTemplate({ code: "u-45", name: "45", ocr: c45, identifiers: ids, assignments: [{ field: "partiNo", rect: el("P9918733") }] }).template;
  const birlesik = mergeTemplateForUpdate(eskiB, yeniB, ["tables", "sections"]);
  const bs = extractDocument(c45, [birlesik], null).regions[0]?.sections?.sections.map((x) => x.batchNo);
  check("§13f ⭐ güncellemede pencereli alan bölüm alanı kalırsa bölüm okuması pencereyi yok sayar (2 parti no)",
    anchorOf(birlesik, "partiNo").window !== undefined && JSON.stringify(bs) === JSON.stringify(["P9918733", "P9918734"]), JSON.stringify(bs));

  // §13e: gerçek 0246 (iki belgeli fotoğraf, anonim "MA"): pencere BÖLGE çerçevesinde kurulur; bölge 1 müşteri 'MA'.
  const g = gercek("0246-iki-belge");
  const tE = suggestTemplate({ code: "u-0246", name: "0246", ocr: g, identifiers: ["Müşteri", "Cinsi", "Mamül En"], assignments: [{ field: "musteri", rect: rectOf(g, "MA") }] }).template;
  const r1 = extractDocument(g, [tE], null).regions[0];
  check("§13e ⭐ gerçek 0246: 'Müşteri KG/MT' rakipken pencere bölge koordinatında, bölge 1 müşteri 'MA'",
    anchorOf(tE, "musteri").window !== undefined && r1?.fields?.fields.musteri?.value === "MA",
    JSON.stringify({ s: anchorOf(tE, "musteri"), v: r1?.fields?.fields.musteri?.value }));
}
