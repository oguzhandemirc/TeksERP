// test_gelen_belge_motor §14 (Gülkesim demo 2026-11-04): tanıtmada yalnız "2008-58"e dokunuldu, önizleme "2008-58KOYUBEJFULAR"
// okudu (etiketin sağında aynı satırdaki her şey alınıyordu). Tanıtma dokunulan kelime sayısını (`maxWords`) ve biçimini
// (`valueShape`) öğrenir; okuyucu adayı keser. Saf (DB'siz); dosya boyu yüzünden ayrı.
import { extractDocument, suggestTemplate, validateTemplate, type AnchorStrategy, type DocumentTemplate, type OcrBlock, type OcrRect, type OcrResult } from "../../src/lib/gelen-belge/motor";
import { valueShapeOf } from "../../src/lib/gelen-belge/motor/value-limit";

type Check = (label: string, ok: boolean, detay?: string) => void;

/** Tek satırlık blok; kelimeler soldan sağa 10 px aralıkla, genişlik harf başına 14 px. */
function line(words: string[], x0: number, y: number): OcrBlock {
  let x = x0;
  const elements = words.map((text) => {
    const e = { text, rect: { x, y, width: Math.max(14, text.length * 14), height: 30 }, confidence: 0.99 };
    x += e.rect.width + 10;
    return e;
  });
  const rect: OcrRect = { x: x0, y, width: x - 10 - x0, height: 30 };
  const text = words.join(" ");
  return { text, rect, lines: [{ text, rect, confidence: 0.99, angle: 0, elements }] };
}

/** Gülkesim benzeri form: başlık + "Müş. Parti NO <değer kelimeleri>" + "Desen: ..." satırı. */
function form(valueWords: string[]): OcrResult {
  const blocks = [line(["KUMAŞ", "GİRİŞ", "FORMU"], 300, 40), line(["Müş.", "Parti", "NO", ...valueWords], 60, 300), line(["Desen:", "DS", "12"], 60, 400)];
  return { text: blocks.map((b) => b.text).join("\n"), blocks, imageWidth: 1000, imageHeight: 1400 };
}

const wordRect = (ocr: OcrResult, ...texts: string[]): OcrRect => {
  const els = ocr.blocks.flatMap((b) => b.lines).flatMap((l) => l.elements ?? []).filter((e) => texts.includes(e.text));
  const x0 = Math.min(...els.map((e) => e.rect.x));
  const x1 = Math.max(...els.map((e) => e.rect.x + e.rect.width));
  return { x: x0, y: els[0]!.rect.y, width: x1 - x0, height: 30 };
};

function teach(ocr: OcrResult, tapped: string[], field: "partiNo" | "desen" = "partiNo"): DocumentTemplate {
  const s = suggestTemplate({ code: "u-deger-sinir", name: "Değer sınırı", ocr, identifiers: ["KUMAŞ GİRİŞ FORMU"], assignments: [{ field, rect: wordRect(ocr, ...tapped) }] });
  if (s.errors.length) throw new Error(`öneri doğrulanmadı: ${s.errors.join(",")}`);
  return s.template;
}
const anchorOf = (t: DocumentTemplate, key: string) => t.fields.find((f) => f.key === key)!.strategies[0] as AnchorStrategy;
const read = (ocr: OcrResult, t: DocumentTemplate, key = "partiNo") => extractDocument(ocr, [t], null).regions[0]?.fields?.fields[key]?.value ?? null;

export function degerSiniri(check: Check): void {
  const saha = form(["2008-58", "KOYU", "BEJ", "FULAR"]);
  const t = teach(saha, ["2008-58"]);
  const s = anchorOf(t, "partiNo");
  check("§14a ⭐ tek kelimeye dokunuldu → maxWords 1 + biçim `^\\d+\\s*-\\s*\\d+$`; aynı belgede '2008-58' (KOYU BEJ FULAR girmez)",
    s.maxWords === 1 && s.valueShape === "^\\d+\\s*-\\s*\\d+$" && read(saha, t) === "2008-58", JSON.stringify({ s, v: read(saha, t) }));

  const sonraki = form(["2011-7", "MAVİ"]);
  check("§14b ⭐ sonraki belge '2011-7 MAVİ' → '2011-7'", read(sonraki, t) === "2011-7", String(read(sonraki, t)));

  const bolunmus = form(["2008", "-", "58", "KOYU"]);
  check("§14c ⭐ OCR '2008 - 58' diye üçe bölse de biçim tutar → '2008-58'", read(bolunmus, t) === "2008-58", String(read(bolunmus, t)));

  const t2 = teach(saha, ["2008-58", "KOYU"]);
  check("§14d iki kelimeye dokunuldu → iki kelime alınır ('2008-58KOYU', BEJ FULAR yok)",
    anchorOf(t2, "partiNo").maxWords === 2 && read(saha, t2) === "2008-58KOYU", String(read(saha, t2)));

  const noShape = form(["A2011-7", "MAVİ"]);
  check("§14e biçim tutmazsa maxWords kadar kelime → 'A2011-7'", read(noShape, t) === "A2011-7", String(read(noShape, t)));

  const eski: DocumentTemplate = { ...t, fields: t.fields.map((f) => ({ ...f, strategies: f.strategies.map((x) => (x.kind === "anchor" ? { kind: "anchor", labels: x.labels, direction: x.direction } : x)) })) };
  check("§14f ⭐ alanlar yokken (eski şablon) bugünkü davranış: satırın kalanı → '2008-58KOYUBEJFULAR'",
    read(saha, eski) === "2008-58KOYUBEJFULAR", String(read(saha, eski)));

  const td = teach(saha, ["DS", "12"], "desen");
  check("§14g serbest metin (desen) sınır öğrenmez", anchorOf(td, "desen").maxWords === undefined && anchorOf(td, "desen").valueShape === undefined,
    JSON.stringify(anchorOf(td, "desen")));

  const bozuk = (patch: Partial<AnchorStrategy>) => validateTemplate({ ...t, fields: t.fields.map((f) => ({ ...f, strategies: [{ ...s, ...patch }] })) }).ok;
  check("§14h doğrulayıcı: maxWords 0/1.5 ve derlenmeyen biçim reddedilir; öğrenilen biçim geçer",
    !bozuk({ maxWords: 0 }) && !bozuk({ maxWords: 1.5 }) && !bozuk({ valueShape: "\\-(" }) && bozuk({}));

  check("§14i biçim öğrenme: harf/rakam/ayraç koşuları, kelime arası `\\s+`, 40+ karakter → yok",
    valueShapeOf(["P9918733"]) === "^\\p{L}+\\d+$" && valueShapeOf(["04.11.2026"]) === "^\\d+\\s*\\.\\s*\\d+\\s*\\.\\s*\\d+$"
      && valueShapeOf(["AB", "12"]) === "^\\p{L}+\\s+\\d+$" && valueShapeOf(["X".repeat(41)]) === null,
    JSON.stringify([valueShapeOf(["P9918733"]), valueShapeOf(["04.11.2026"]), valueShapeOf(["AB", "12"])]));
}
