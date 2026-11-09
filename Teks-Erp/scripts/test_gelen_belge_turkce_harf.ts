// =============================================================================
// BEKÇİ — GELEN BELGE: Türkçe dışı aksanlı harf → Türkçe karşılığı (2026-11-09)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts gelen_belge_turkce_harf   (DB'ye YAZMAZ, sorgu atmaz)
//
// ⭐ NEDEN VAR: tablette ML Kit "GÜLEÇSOY"u "GÙLEÇSOY" okudu; tanıtma bu kelimeyi sabit yazı olarak öğretti. Eşleme
//    (`motor/turkce-harf.ts`) TEK boğazdır: `clientOcrToResult` (yükleme/canlı/istasyon), `OcrResultSchema` (sidecar +
//    saklı zarf), şablon kaydı/yüklemesi (`normalizeTemplateLetters`). Şapkalı â î û KORUNUR.
//
// ⭐ NEGATİF SONDA (2026-11-09, elle, geri alındı): tabloda "Ù" satırı silinince §1a/§1e/§3a/§3c/§4a düşer; `fixTurkishLetters`te
//    COMBINING düşürme kaldırılınca §1e düşer; `clientOcrToResult` dönüşündeki `normalizeOcrLetters` kaldırılınca §3a/§4b düşer;
//    `OcrResultSchema` `.transform` kaldırılınca §3c düşer; `walk`ta `labels` anahtarı çıkarılınca §4a düşer.
// =============================================================================
import { clientOcrToResult, type ClientOcr } from "../src/lib/gelen-belge/istemci-ocr";
import { OcrResultSchema } from "../src/lib/gelen-belge/okuma-istemcisi";
import { extractDocument, type DocumentTemplate } from "../src/lib/gelen-belge/motor";
import { fixTurkishLetters, normalizeTemplateLetters, TURKCE_HARF_ESLEME } from "../src/lib/gelen-belge/motor/turkce-harf";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

// ── §1 saf eşleme ─────────────────────────────────────────────────────────────
check("§1a ⭐ 'GÙLEÇSOY' → 'GÜLEÇSOY'", fixTurkishLetters("GÙLEÇSOY") === "GÜLEÇSOY", fixTurkishLetters("GÙLEÇSOY"));
check("§1b Ó→Ö, Í→İ, ì→i, ú→ü", fixTurkishLetters("ÓÍìú") === "Öİiü");
check("§1c Ș→Ş, Ţ→T, Š→Ş, Ǧ→Ğ, Č→Ç, É→E, Ñ→N, Ý→Y, Ž→Z, Ä→A", fixTurkishLetters("ȘŢŠǦČÉÑÝŽÄ") === "ŞTŞĞÇENYZA", fixTurkishLetters("ȘŢŠǦČÉÑÝŽÄ"));
check("§1d küçük harfler küçük kalır: șţšǧčéñýžä", fixTurkishLetters("șţšǧčéñýžä") === "ştşğçenyza", fixTurkishLetters("șţšǧčéñýžä"));
check("§1e ⭐ birleşik aksan: U+0300 → Ü, O+U+0301 → Ö, I+U+0307 → İ, X+U+0323 → X", fixTurkishLetters("GÙLEÇSOY Ó İ X̣") === "GÜLEÇSOY Ö İ X", JSON.stringify(fixTurkishLetters("GÙLEÇSOY Ó İ X̣")));
check("§1f şapkalı â î û Â Î Û korunur (birleşik biçimi de)", fixTurkishLetters("kâğıt Îsa Ûmit âîû â") === "kâğıt Îsa Ûmit âîû â");
check("§1g ASCII, rakam, Türkçe harf, satır sonu değişmez", fixTurkishLetters("ABC-123 / 4,5 kg\nÇĞİÖŞÜ çğıöşü") === "ABC-123 / 4,5 kg\nÇĞİÖŞÜ çğıöşü");
check("§1h tabloda şapkalı/Türkçe harf kaynak değil", ["â", "î", "û", "Â", "Î", "Û", "ç", "ğ", "ı", "ö", "ş", "ü", "Ç", "Ğ", "İ", "Ö", "Ş", "Ü"].every((c) => TURKCE_HARF_ESLEME[c] === undefined));
check("§1i tablo hedefleri yalnız Türkçe alfabede", Object.values(TURKCE_HARF_ESLEME).every((t) => /^[A-Za-zÇĞİÖŞÜçğıöşü]$/u.test(t) && !/[QWXqwx]/.test(t)));
check("§1j idempotent", fixTurkishLetters(fixTurkishLetters("GÙLEÇSOY ÓÍ")) === fixTurkishLetters("GÙLEÇSOY ÓÍ"));

// ── §2-§3 OCR boğazları ───────────────────────────────────────────────────────
const q = (x: number, y: number, w: number, h: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const client: ClientOcr = {
  engine: "mlkit", width: 1000, height: 1000,
  words: [
    { t: "GÙLEÇSOY", c: q(100, 100, 200, 40), l: 0, p: 0.9 },
    { t: "TEKSTIL", c: q(320, 100, 180, 40), l: 0, p: 0.9 },
    { t: "Mùşteri:", c: q(100, 200, 150, 40), l: 1, p: 0.9 },
    { t: "ACME", c: q(270, 200, 120, 40), l: 1, p: 0.9 },
  ],
  lines: [{ c: q(100, 100, 400, 40) }, { c: q(100, 200, 290, 40) }],
};
const ocr = clientOcrToResult(client);
const words = ocr.blocks.flatMap((b) => b.lines.flatMap((l) => l.elements.map((e) => e.text)));
check("§3a ⭐ cihaz okuması: kelime/satır/sayfa metni Türkçe", words[0] === "GÜLEÇSOY" && words[2] === "Müşteri:" && ocr.text.startsWith("GÜLEÇSOY TEKSTIL") && ocr.blocks[0]!.lines[0]!.text === "GÜLEÇSOY TEKSTIL", JSON.stringify(words));
check("§3b kutular dokunulmaz", ocr.blocks[0]!.lines[0]!.elements[0]!.rect.width === 200);
const stored = { ...ocr, text: "GÙLEÇSOY TEKSTIL", blocks: ocr.blocks.map((b) => ({ ...b, text: b.text.replace("Ü", "Ù"), lines: b.lines.map((l) => ({ ...l, text: l.text.replace("Ü", "Ù"), elements: l.elements.map((e) => ({ ...e, text: e.text.replace("Ü", "Ù") })) })) })), barcodes: [{ format: "CODE128", value: "ÙX1" }] };
const parsed = OcrResultSchema.safeParse(stored);
const pw = parsed.success ? parsed.data.blocks[0]!.lines[0]!.elements[0]!.text : "";
check("§3c ⭐ saklı zarf / sidecar sonucu (OcrResultSchema) aynı boğazdan", parsed.success && pw === "GÜLEÇSOY" && parsed.data.text === "GÜLEÇSOY TEKSTIL", pw);
check("§3d barkod değeri dokunulmaz", parsed.success && parsed.data.barcodes?.[0]?.value === "ÙX1");

// ── §4 şablon tarafı ──────────────────────────────────────────────────────────
const oldTemplate: DocumentTemplate = {
  id: "u-gulecsoy", name: "Gùleçsoy", version: 1,
  identifiers: { keywords: ["GÙLEÇSOY TEKSTIL"], minScore: 0.5 },
  fields: [{ key: "musteri", label: "Mùşteri", type: "text", strategies: [{ kind: "anchor", labels: ["Mùşteri"], direction: "right" }] }],
};
const norm = normalizeTemplateLetters(oldTemplate);
const anchor = norm.fields[0]!.strategies[0]!;
check("§4a ⭐ eski şablonun sabit yazısı/etiketi Türkçe karşılığına döner", norm.identifiers.keywords[0] === "GÜLEÇSOY TEKSTIL" && anchor.kind === "anchor" && anchor.labels[0] === "Müşteri", JSON.stringify(norm.identifiers.keywords));
check("§4b ⭐ eski 'GÙLEÇSOY' sabit yazısı yeni 'GÜLEÇSOY' okumasıyla BİREBİR eşit", norm.identifiers.keywords[0] === ocr.blocks[0]!.lines[0]!.text);
check("§4c ad ve alan adı (gösterim) dokunulmaz; özgün nesne değişmez", norm.name === "Gùleçsoy" && norm.fields[0]!.label === "Mùşteri" && oldTemplate.identifiers.keywords[0] === "GÙLEÇSOY TEKSTIL");
const ex = extractDocument(ocr, [norm], null).regions[0];
check("§4d motor: belge eski şablonla tanınır, etiketten değer okunur", ex?.templateId === "u-gulecsoy" && ex?.fields?.fields.musteri?.value === "ACME", `${ex?.templateId} ${ex?.fields?.fields.musteri?.value}`);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
