// test_gelen_belge_motor §15 (Gülkesim demo, 2026-11-05): aynı belge ikinci okutmada basılı "Müşteri:" etiketi "Mytei:"
// okundu, değer "HH" yerindeydi; tanıtma yalnız anchor ürettiği için müşteri boş kaldı. Tanıtma etiketli alana konum yedeği
// (`roi` + `fallback`) ekler; anchor değer bulursa yedek koşmaz. Saf (DB'siz), sentetik fikstür; gerçek belge/OCR yok.
// Negatif sondalar (2026-11-05, md5 ile geri alındı): `addPositionFallbacks` kapalı → §15a/c/d/h/i ❌ · extract yedek-atlama
// koşulu kapalı → §15j ❌ · `runRoi` fallback dalı kapalı → §15d ❌.
import { extractDocument, mergeTemplateForUpdate, suggestTemplate, validateTemplate, type DocumentTemplate, type FieldResult, type OcrBlock, type OcrRect, type OcrResult } from "../../src/lib/gelen-belge/motor";

type Check = (label: string, ok: boolean, detay?: string) => void;
type Word = [text: string, x: number, y: number, w: number, conf?: number];

/** Tek satırlık blok (kelimeler soldan sağa, yükseklik 30 px). */
function line(words: Word[]): OcrBlock {
  const elements = words.map(([text, x, y, w, conf]) => ({ text, rect: { x, y, width: w, height: 30 }, confidence: conf ?? 0.99 }));
  const x0 = Math.min(...elements.map((e) => e.rect.x));
  const x1 = Math.max(...elements.map((e) => e.rect.x + e.rect.width));
  const rect: OcrRect = { x: x0, y: elements[0]!.rect.y, width: x1 - x0, height: 30 };
  const text = words.map((w) => w[0]).join(" ");
  return { text, rect, lines: [{ text, rect, confidence: 0.99, angle: 0, elements }] };
}

interface FormOpts {
  /** Basılı etiketin okunan hâli ("Müşteri:" doğru · "Mytei:" bozuk). */
  label: string;
  /** Değer kutusunun kayması (px; ikinci fotoğraf). */
  dx?: number;
  dy?: number;
  /** Etiket ve değer TEK OCR satırında. */
  joined?: boolean;
  /** Değer başka yere kaydı, eski konumda başka bir kelime var (anchor önceliği). */
  moved?: boolean;
  /** Değerin OCR güveni (kayan değer, varsayılan 0.99). */
  valueConf?: number;
}

function form(o: FormOpts): OcrResult {
  const dx = o.dx ?? 0;
  const dy = o.dy ?? 0;
  const blocks: OcrBlock[] = [line([["KUMAŞ", 300 + dx, 40 + dy, 90], ["GİRİŞ", 400 + dx, 40 + dy, 80], ["FORMU", 490 + dx, 40 + dy, 90]])];
  const lw = Math.max(60, o.label.length * 14);
  if (o.joined) blocks.push(line([[o.label, 60 + dx, 300 + dy, lw], ["HH", 220 + dx, 300 + dy, 40]]));
  else if (o.moved) blocks.push(line([[o.label, 60, 300, lw], ["HH", 330, 300, 40, o.valueConf]]), line([["ZZ", 220, 322, 40]]));
  else blocks.push(line([[o.label, 60 + dx, 300 + dy, lw]]), line([["HH", 220 + dx, 300 + dy, 40]]));
  blocks.push(line([["Cinsi:", 600 + dx, 300 + dy, 80]]), line([["PAMUK", 700 + dx, 300 + dy, 90]]));
  return { text: blocks.map((b) => b.text).join("\n"), blocks, imageWidth: 1000, imageHeight: 1400 };
}

const rectOf = (ocr: OcrResult, text: string): OcrRect => ocr.blocks.flatMap((b) => b.lines).find((l) => l.text === text)!.rect;
const fieldOf = (ocr: OcrResult, t: DocumentTemplate): FieldResult | null => extractDocument(ocr, [t], null).regions[0]?.fields?.fields.musteri ?? null;
const kinds = (t: DocumentTemplate, key = "musteri") => t.fields.find((f) => f.key === key)!.strategies.map((s) => s.kind + ("fallback" in s && s.fallback ? "*" : "")).join(",");

function teach(ocr: OcrResult, section = false): DocumentTemplate {
  const s = suggestTemplate({
    code: "u-konum-yedegi", name: "Konum yedeği", ocr, identifiers: ["KUMAŞ GİRİŞ FORMU", "Cinsi"],
    assignments: [{ field: "musteri", rect: rectOf(ocr, "HH"), section }],
    ...(section ? { sectionStartLabel: "KUMAŞ GİRİŞ FORMU" } : {}),
  });
  if (s.errors.length) throw new Error(`öneri doğrulanmadı: ${s.errors.join(",")}`);
  return s.template;
}

export function konumYedegi(check: Check): void {
  const ilk = form({ label: "Müşteri:" });
  const t = teach(ilk);
  check("§15a ⭐ etiketli alan tanıtması [anchor, roi(yedek)] üretir; şablon doğrulanır", kinds(t) === "anchor,roi*" && validateTemplate(t).ok, kinds(t));

  const dogru = fieldOf(form({ label: "Müşteri:", dx: 4, dy: 5 }), t);
  check("§15b etiket doğru okunursa değer anchor'dan, yedek işareti yok", dogru?.value === "HH" && dogru.source.strategy === "anchor" && !dogru.issues.includes("position-fallback"),
    JSON.stringify(dogru));

  const bozuk = fieldOf(form({ label: "Mytei:", dx: 4, dy: 5 }), t);
  check("§15c ⭐ etiket 'Mytei:' okunursa değer konum yedeğinden 'HH' + gözden geçirme", bozuk?.value === "HH" && bozuk.source.strategy === "roi"
    && bozuk.issues.includes("position-fallback") && bozuk.needsReview === true, JSON.stringify(bozuk));

  const tekSatir = fieldOf(form({ label: "Mytei:", joined: true }), t);
  check("§15d ⭐ bozuk etiket ve değer TEK satırda: yedek yalnız kutudaki kelimeyi alır ('HH', 'Mytei: HH' değil)", tekSatir?.value === "HH", JSON.stringify(tekSatir?.value));

  const kaymis = fieldOf(form({ label: "Müşteri:", moved: true }), t);
  check("§15e ⭐ etiket bulunursa anchor kazanır: eski konumdaki başka kelime ('ZZ') değeri ezmez", kaymis?.value === "HH" && kaymis.source.strategy === "anchor",
    JSON.stringify(kaymis));

  // Anchor değeri zayıf okusa da (eşik altı → gözden geçirme) yedek KOŞMAZ: kutudaki güçlü 'ZZ' değeri ezemez.
  const esikAlti = fieldOf(form({ label: "Müşteri:", moved: true, valueConf: 0.4 }), t);
  check("§15j ⭐ anchor değeri eşik altında kalsa da konum yedeği koşmaz (değer 'HH', yedek işareti yok)", esikAlti?.value === "HH"
    && esikAlti.source.strategy === "anchor" && !esikAlti.issues.includes("position-fallback"), JSON.stringify(esikAlti));

  const eski: DocumentTemplate = { ...t, fields: t.fields.map((f) => ({ ...f, strategies: f.strategies.filter((s) => s.kind === "anchor") })) };
  check("§15f yedeksiz eski şablon bozuk etiketle müşteriyi okuyamaz (hatanın kendisi)", fieldOf(form({ label: "Mytei:", dx: 4, dy: 5 }), eski)?.value == null);

  const bolum = teach(ilk, true);
  check("§15g bölüm alanına konum yedeği eklenmez", kinds(bolum) === "anchor", kinds(bolum));

  // "Şablonu güncelle": yeniden atanan alan yeni [anchor, roi] biçimini alır (birleşim sunucuda `mergeTemplateForUpdate`).
  const birlesik = mergeTemplateForUpdate(eski, teach(ilk), []);
  check("§15h ⭐ şablonu güncelle yolu yeniden atanan alana yedek getirir", kinds(birlesik) === "anchor,roi*"
    && fieldOf(form({ label: "Mytei:", dx: 4, dy: 5 }), birlesik)?.value === "HH", kinds(birlesik));

  const kotu = { ...t, fields: t.fields.map((f) => ({ ...f, strategies: f.strategies.map((s) => (s.kind === "roi" ? { ...s, fallback: "evet" } : s)) })) } as unknown as DocumentTemplate;
  check("§15i doğrulayıcı boolean olmayan fallback'i reddeder", !validateTemplate(kotu).ok);
}
