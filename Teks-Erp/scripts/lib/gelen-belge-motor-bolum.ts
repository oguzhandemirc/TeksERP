// test_gelen_belge_motor §12 (Gülkesim S1, 2026-11-03): tekrarlayan bölüm (çok partili belge) + sayfa devamı + şablon önerisi
// (belge tipi tanıtma). Saf (DB'siz); dosya boyu tavanı yüzünden ayrı. Fikstürler anonim (0245 = Güleçsoy çeki listesi).
import { classifyWithFallback, extractDocument, suggestTemplate, validateTemplate, type DocumentTemplate, type OcrBlock, type OcrResult } from "../../src/lib/gelen-belge/motor";
import { identifierText, sectionStartLabel } from "../../src/lib/gelen-belge/motor/labels";
import { draftFromExtraction } from "../../src/lib/gelen-belge/taslak";
import { readFileSync } from "fs";
import { join } from "path";

type Check = (label: string, ok: boolean, detay?: string) => void;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 0245'ten sentetik 2. sayfa: başlık tekrarı (y < 260) + bölüm 2'nin tablo bandı (başlıksız), top no'ları farklı, "2/2" damgası. */
export function continuationPage(src: OcrResult): OcrResult {
  const o = clone(src);
  const blocks: OcrBlock[] = [];
  for (const b of o.blocks) {
    const lines = b.lines.filter((l) => l.rect.y < 260 || (l.rect.y >= 1420 && l.rect.y < 2240)).map((l) => {
      if (l.rect.y < 1420) return l;
      const shift = (r: { y: number }) => { r.y -= 1100; };
      shift(l.rect);
      l.elements.forEach((e) => shift(e.rect));
      const t = l.text.replace(/^9920(\d{4})$/, "9921$1");
      return { ...l, text: t, elements: l.elements.map((e) => ({ ...e, text: e.text.replace(/^9920(\d{4})$/, "9921$1") })) };
    });
    if (lines.length) blocks.push({ ...b, lines, text: lines.map((l) => l.text).join("\n") });
  }
  const r = { x: 1865, y: 1200, width: 50, height: 30 };
  blocks.push({ text: "2/2", rect: r, lines: [{ text: "2/2", rect: r, confidence: 0.99, angle: 0, elements: [{ text: "2/2", rect: r, confidence: 0.99 }] }] });
  return { ...o, blocks, text: blocks.map((b) => b.text).join("\n") };
}

const elementRect = (ocr: OcrResult, text: string) => ocr.blocks.flatMap((b) => b.lines).flatMap((l) => l.elements).find((e) => e.text === text)!.rect;
const lineRect = (ocr: OcrResult, text: string) => ocr.blocks.flatMap((b) => b.lines).find((l) => l.text === text)!.rect;

export function gulkesimBolum(check: Check, gercek: (ad: string) => OcrResult, sablonlar: DocumentTemplate[]): void {
  const ocr = gercek("0245-ceki-listesi-a");
  const ex = extractDocument(ocr, sablonlar);
  const sec = ex.regions[0]!.sections;
  const [s1, s2] = sec?.sections ?? [];
  check("§12a ⭐ Güleçsoy 2 bölüm: P9918733 5 satır 586 m + '4 TOP' uyarısı (SECTION_COUNT_MISMATCH)",
    sec?.sections.length === 2 && s1?.batchNo === "P9918733" && s1.rowCount === 5 && s1.meterSum === "586" && s1.declaredCount === "4" && s1.warnings.some((w) => w.startsWith("SECTION_COUNT_MISMATCH") && w.includes("4 TOP")),
    JSON.stringify(sec?.sections.map((s) => [s.batchNo, s.rowCount, s.meterSum, s.declaredCount, s.warnings])));
  check("§12b ⭐ bölüm 2: P9918734 sayfa 1'de 16 satır 3.935 m + '1/2' uyarısı (SECTION_CONTINUES; sayım farkı değil)",
    s2?.batchNo === "P9918734" && s2.orderNo === "96966" && s2.rowCount === 16 && s2.meterSum === "3935" && sec?.page?.no === 1 && sec.page.of === 2
      && s2.warnings.length === 1 && s2.warnings[0]!.startsWith("SECTION_CONTINUES") && s2.warnings[0]!.includes("1/2"),
    JSON.stringify({ s2: s2 && [s2.batchNo, s2.rowCount, s2.meterSum, s2.warnings], page: sec?.page }));
  const d = draftFromExtraction(ex);
  const b1 = d.lines.filter((l) => l.blockNo === 1).length;
  const b2 = d.lines.filter((l) => l.blockNo === 2).length;
  const tb = d.header.totalsDeclared.blocks;
  check("§12c taslak: satır blokları = bölümler (5 + 16), blok künyesi parti/sipariş/yazan top, başlık top adedi boş, sayfa 1/2",
    b1 === 5 && b2 === 16 && tb.length === 2 && tb[0]!.batchNo === "P9918733" && tb[0]!.topCount === 4 && tb[1]!.batchNo === "P9918734" && tb[1]!.topCount === 21 && tb[1]!.m === "3935"
      && d.header.declaredTopCount === null && d.header.page?.of === 2 && !d.header.continuesPrevious,
    JSON.stringify({ b1, b2, tb, dtc: d.header.declaredTopCount, page: d.header.page }));
  const p2 = draftFromExtraction(extractDocument(continuationPage(ocr), sablonlar));
  check("§12d ⭐ sayfa devamı: bölüm başlığı olmayan sayfa → continuesPrevious, satırlar blok 1'de (doldurma son bölüme ekler), 2/2'de SECTION_CONTINUES yok",
    p2.header.continuesPrevious && p2.lines.length === 16 && p2.lines.every((l) => l.blockNo === 1) && p2.header.page?.no === 2 && !p2.header.warnings.some((w) => w.includes("SECTION_CONTINUES")),
    JSON.stringify({ c: p2.header.continuesPrevious, n: p2.lines.length, blocks: [...new Set(p2.lines.map((l) => l.blockNo))], page: p2.header.page, w: p2.header.warnings }));
  const cek = sablonlar.find((t) => t.id === "ceki-listesi-a")!;
  const bad = [
    validateTemplate({ ...cek, sections: { ...cek.sections!, fields: ["yokAlan"] } }),
    validateTemplate({ ...cek, sections: { ...cek.sections!, batchField: "tarih" } }),
    validateTemplate({ ...cek, blockFields: ["siparisNo"] }),
    validateTemplate({ ...cek, sections: { ...cek.sections!, startLabels: [] } }),
  ];
  check("§12e validator: bölümde bilinmeyen alan · parti alanı bölüm alanı değil · blockFields+sections · boş başlangıç → red", bad.every((v) => !v.ok), bad.map((v) => v.errors.join(",")).join(" | "));

  const sug = suggestTemplate({
    code: "u-deneme-ceki", name: "Deneme çeki", ocr,
    assignments: [
      { field: "evrakNo", rect: lineRect(ocr, "914279") }, { field: "tarih", rect: lineRect(ocr, "19.10.2026") },
      { field: "musteri", rect: lineRect(ocr, "ÖRNEK TEKSTİL A") }, { field: "partiNo", rect: elementRect(ocr, "P9918733"), section: true },
      { field: "siparisNo", rect: lineRect(ocr, "96967"), section: true },
    ],
    identifiers: ["KUMAŞ ÇEKİ LİSTESİ", "FIŞ NO", "Ham PartiNo"],
    table: { columns: [{ key: "topNo", header: "Top No" }, { key: "kg", header: "Kilo" }, { key: "m", header: "Metre" }], totalsLabel: "T.Adet" },
    sectionStartLabel: "Sipariş No",
  });
  const lbl = Object.fromEntries(sug.explain.map((e) => [e.field, `${e.strategy}:${e.label}:${e.direction}`]));
  check("§12f ⭐ şablon önerisi: değer kutusunun basılı etiketi bulunur (aynı satır önü / soldaki satır), şablon doğrulayıcıdan geçer",
    sug.errors.length === 0 && lbl.partiNo === "anchor:Ham PartiNo:right" && lbl.evrakNo === "anchor:FIŞ NO:right" && lbl.tarih === "anchor:TARIH:right" && lbl.musteri === "anchor:FIRMA:right",
    JSON.stringify({ e: sug.errors, lbl }));
  const withUser = [sug.template, ...sablonlar.filter((t) => t.id === "genel")];
  const ux = extractDocument(ocr, withUser);
  const ur = ux.regions[0]!;
  check("§12g ⭐ kullanıcı şablonu sınıflandırır ve ikinci okumada alanları doldurur (evrak, tarih, müşteri, 2 bölüm parti no)",
    ur.templateId === "u-deneme-ceki" && ur.fields?.fields.evrakNo?.value === "914279" && ur.fields.fields.tarih?.value === "2026-10-19" && ur.fields.fields.musteri?.value === "ÖRNEK TEKSTİL A"
      && JSON.stringify(ur.sections?.sections.map((s) => s.batchNo)) === JSON.stringify(["P9918733", "P9918734"]),
    JSON.stringify({ t: ur.templateId, f: ur.fields && Object.fromEntries(Object.entries(ur.fields.fields).map(([k, v]) => [k, v.value])), s: ur.sections?.sections.map((s) => s.batchNo) }));
  const other = classifyWithFallback(gercek("0244-kumas-irsaliyesi"), withUser, "genel");
  check("§12h eşik altı belge kullanıcı şablonuna oturmaz → genel (yedek sözlük)", other.templateId === "genel", JSON.stringify(other));
  bolumEtiketi(check, ocr, cek);
}

/** 0245'in "Ham PartiNo …" satırlarını yeniden yazar (yalnız satır metni; bölüm başı satırı bu). */
function withPartiLines(src: OcrResult, texts: [string, string]): OcrResult {
  const o = clone(src);
  let k = 0;
  for (const b of o.blocks) for (const l of b.lines) if (/^Ham PartiNo /.test(l.text)) l.text = texts[k++] ?? l.text;
  return o;
}

// §12i/§12j (2026-11-09 ekran denetimi): bölüm başı DEĞERİYLE kaydedilmişse ("Ham PartiNo: P2618733") ikinci parti
// ("Ham PartiNo: 58") kaçmasın — etiket kısmı eşleşme anında da kayıtta da; ≥3 harf altı etiket tam metne düşer.
function bolumEtiketi(check: Check, ocr: OcrResult, cek: DocumentTemplate): void {
  const starts = (o: OcrResult, label: string) => {
    const t = { ...cek, id: "u-bolum", sections: { ...cek.sections!, startLabels: [label] } };
    return (extractDocument(o, [t]).regions[0]!.sections?.sections ?? []).filter((x) => !x.continued).length;
  };
  const farkli = withPartiLines(ocr, ["Ham PartiNo: P2618733", "Ham PartiNo: 58"]);
  check("§12j ⭐ değeriyle kayıtlı bölüm başı 'Ham PartiNo: P2618733' → 'Ham PartiNo: 58' satırı da bölüm başı (2 bölüm)",
    starts(farkli, "Ham PartiNo: P2618733") === 2, String(starts(farkli, "Ham PartiNo: P2618733")));
  check("§12j rakamsız etiket bugünkü gibi ('Ham PartiNo' 2 · 'Sipariş No' 2)",
    starts(farkli, "Ham PartiNo") === 2 && starts(ocr, "Sipariş No") === 2, `${starts(farkli, "Ham PartiNo")}/${starts(ocr, "Sipariş No")}`);
  const kisa = withPartiLines(ocr, ["No: P2618733", "No: 58"]);
  check("§12j ≥3 harf altı etiket tam metne düşer: 'No: P2618733' yalnız kendi satırında (1 bölüm, 'No: 58' değil)",
    sectionStartLabel("No: P2618733") === "No: P2618733" && starts(kisa, "No: P2618733") === 1, String(starts(kisa, "No: P2618733")));
  const sug = suggestTemplate({
    code: "u-bolum-etiket", name: "Bölüm etiketi", ocr: farkli,
    assignments: [{ field: "partiNo", rect: elementRect(farkli, "P9918733"), section: true }],
    identifiers: ["KUMAŞ ÇEKİ LİSTESİ"], sectionStartLabel: "Ham PartiNo: P2618733",
  });
  check("§12j kayıtta bölüm başı etiket kısmıyla saklanır ('Ham PartiNo')",
    JSON.stringify(sug.template.sections?.startLabels) === JSON.stringify(["Ham PartiNo"]), JSON.stringify(sug.template.sections?.startLabels));
  // Ayna: panel + tablet `identifierText` backend ifadesiyle aynı (tırnak biçimi hariç).
  const govde = (src: string) => /export const identifierText = \(text: string\): string =>\s*([^\n]+)/.exec(src)?.[1]?.replace(/'/g, '"') ?? null;
  const root = join(__dirname, "..", "..", "..");
  const kaynak = govde(readFileSync(join(__dirname, "..", "..", "src", "lib", "gelen-belge", "motor", "labels.ts"), "utf8"));
  const aynalar = ["Electron/src/pages/Operations/GelenBelgeler/tanit/teachDraft.ts", "mobil/src/screens/Modules/GelenBelge/tanit/teachDraft.ts"]
    .map((f) => govde(readFileSync(join(root, f), "utf8")));
  check("§12i identifierText aynası: panel + tablet teachDraft backend labels.ts ile aynı; 'Ham PartiNo: P2618733' → 'Ham PartiNo'",
    kaynak !== null && aynalar.every((a) => a === kaynak) && identifierText("Ham PartiNo: P2618733") === "Ham PartiNo", JSON.stringify({ kaynak, aynalar }));
}
