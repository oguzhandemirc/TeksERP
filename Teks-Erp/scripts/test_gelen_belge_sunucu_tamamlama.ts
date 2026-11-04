// =============================================================================
// BEKÇİ — GELEN BELGE SUNUCU TAMAMLAMASI: cihaz (tablet) okumasında boş kalan başlık alanı aynı fotoğrafın sunucu
// okumasıyla dolar; dolu alan ezilmez; parti no farklı okunursa uyarı düşer.
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts gelen_belge_sunucu_tamamlama   (gerçek DB; okuma servisi GEREKMEZ — sahte okuyucu)
//   Fikstür SENTETİKTİR (uydurma şablon + uydurma OCR); gerçek belge/müşteri verisi YOK.
//   §1 saf birleşim: yalnız boş alan dolar · dolu alan ezilmez · parti farkı uyarısı · yedek şablon/başka şablon → tamamlama yok
//   §2 ⭐ tam cihaz okuması → sunucu okuyucusu HİÇ çağrılmaz (ek gecikme yok), zarfta künye yok
//   §3 ⭐ eksik alan → okuyucu TAM BİR kez; boş müşteri dolar, cihazın parti no'su kalır; SERVER_COMPLETED + BATCH_NO_DIFFERS
//      uyarısı; zarf `serverComplement.filled`; saklı zarftan yeniden kurulum aynı sonucu verir
//   §4 okuyucu hata/adres yok → cihaz sonucu kalır (tarama READ), zarfta `failed` künyesi (sessiz değil)
//   §5 ⭐ aynı taslakta parti no farklı okunur (ikinci sayfa) → BATCH_NO_DIFFERS uyarısı, ilk değer korunur
// ⭐ NEGATİF SONDA (2026-11-05, betikle koşuldu, her biri md5 ile geri alındı — 4/4 ısırdı):
//    `completeExtraction` boş-alan koşulu `if (true)` → 13/18 (§1b §1c §3c §3d §3e ❌);
//    `serverCompleter` eksik-alan erken dönüşü kapatılınca → 17/18 (§2a ❌, okuyucu 1 kez çağrıldı);
//    `fillBoundDraftTx` `...batchDiff` çıkarılınca → 16/18 (§5b §5c ❌);
//    `processClaimedScan` `opts.complete` çağrısı kapatılınca → 11/18 (§3a §3b §3d §3e §3f §4a §4b ❌).
// =============================================================================
import { createHash } from "node:crypto";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { extractDocument, type DocumentTemplate, type OcrBlock, type OcrResult } from "../src/lib/gelen-belge/motor";
import { completeExtraction, missingHeaderFields } from "../src/lib/gelen-belge/sunucu-tamamlama";
import type { ReaderResult } from "../src/lib/gelen-belge/okuma-istemcisi";
import { uploadScanWithDeviceRead } from "../src/services/gelen-belge-istemci-okuma.service";
import { serverCompleter } from "../src/services/gelen-belge-sunucu-tamamlama.service";
import { buildDraftFromEnvelope } from "../src/services/gelen-belge-taslak-doldur.service";
import type { ClientOcr } from "../src/lib/gelen-belge/istemci-ocr";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exitCode = 1;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `GBT${Date.now().toString(36).toUpperCase()}`;
const CODE = `u-test-tamam-${TAG.toLowerCase()}`;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const jpeg = (salt: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} ${salt}`)]);

/** Uydurma iş formu şablonu: üç etiketli başlık alanı (tanıtmanın ürettiği biçim). */
const TEMPLATE: DocumentTemplate = {
  id: CODE, name: "Tamamlama deneme formu", version: 1,
  identifiers: { keywords: [`ZETAFORM ${TAG}`, "TAMAMLAMA DENEMESI"], minScore: 0.6 },
  fields: [
    { key: "musteri", label: "Müşteri", type: "text", strategies: [{ kind: "anchor", labels: ["Müşteri"], direction: "right" }], maxLength: 80, postProcess: ["collapseSpaces", "trimPunct"] },
    { key: "partiNo", label: "Parti No", type: "alnum", strategies: [{ kind: "anchor", labels: ["Parti No"], direction: "right" }], postProcess: ["upper", "stripSpaces"] },
    { key: "desen", label: "Hedef kumaş (desen)", type: "text", strategies: [{ kind: "anchor", labels: ["Desen"], direction: "right" }], maxLength: 80, postProcess: ["collapseSpaces", "trimPunct"] },
  ],
};

/** Satır başına tek blok; kelime kutuları harf sayısıyla orantılı. */
function ocrOf(rows: Array<[text: string, x: number, y: number]>, size = { w: 2000, h: 1500 }): OcrResult {
  const blocks: OcrBlock[] = rows.map(([text, x, y]) => {
    let cx = x;
    const elements = text.split(" ").map((t) => {
      const e = { text: t, rect: { x: cx, y, width: t.length * 20, height: 40 }, confidence: 0.95 };
      cx += t.length * 20 + 15;
      return e;
    });
    const rect = { x, y, width: cx - 15 - x, height: 40 };
    return { text, rect, lines: [{ text, rect, confidence: 0.95, angle: 0, elements }] };
  });
  return { text: rows.map((r) => r[0]).join("\n"), blocks, imageWidth: size.w, imageHeight: size.h, engine: "test", rotation: 0 };
}

const HEAD: Array<[string, number, number]> = [[`ZETAFORM ${TAG}`, 100, 50], ["TAMAMLAMA DENEMESI", 100, 110]];
const page = (o: { musteri?: string; parti?: string; desen?: string }, size?: { w: number; h: number }) => ocrOf([
  ...HEAD,
  ["Müşteri:", 100, 300], ...(o.musteri ? [[o.musteri, 400, 300] as [string, number, number]] : []),
  ["Parti No:", 100, 400], ...(o.parti ? [[o.parti, 400, 400] as [string, number, number]] : []),
  ["Desen:", 100, 500], ...(o.desen ? [[o.desen, 400, 500] as [string, number, number]] : []),
], size);

/** Sahte OCR'ı tabletin göndereceği `clientOcr` biçimine çevirir (kelime dörtgeni + satır). */
function asClient(r: OcrResult): ClientOcr {
  const lines = r.blocks.flatMap((b) => b.lines);
  const q = (x: { x: number; y: number; width: number; height: number }): [number, number][] => [[x.x, x.y], [x.x + x.width, x.y], [x.x + x.width, x.y + x.height], [x.x, x.y + x.height]];
  return { engine: "mlkit", width: r.imageWidth, height: r.imageHeight, rotation: 0, ms: 50, words: lines.flatMap((l, i) => l.elements.map((e) => ({ t: e.text, c: q(e.rect), l: i, p: 0.95 }))), lines: lines.map((l) => ({ c: q(l.rect), p: 0.95 })) };
}

function unit(): void {
  console.log("§1 saf birleşim");
  const tpls = [TEMPLATE];
  const dev = page({ musteri: "ACME BOYA", parti: "AB1234" });
  const srv = page({ musteri: "BASKA AD", parti: "A81234", desen: "ZETA DESEN" }, { w: 1000, h: 750 });
  const dx = extractDocument(dev, tpls, null);
  const sx = extractDocument(srv, tpls, null);
  check("§1a cihaz okumasında eksik alan: desen", JSON.stringify(missingHeaderFields(dx, null)) === '["desen"]', JSON.stringify(missingHeaderFields(dx, null)));
  const c = completeExtraction({ ocr: dev, ex: dx }, { ocr: srv, ex: sx }, { fallbackId: null, templates: tpls });
  const f = c.extraction.regions[0]!.fields!.fields;
  check("§1b ⭐ yalnız boş alan dolar (desen), dolu müşteri/parti ezilmez", JSON.stringify(c.filled) === '["desen"]' && f.desen!.value === "ZETA DESEN" && f.musteri!.value === "ACME BOYA" && f.partiNo!.value === "AB1234",
    `${JSON.stringify(c.filled)} ${f.musteri!.value} ${f.partiNo!.value}`);
  const w = c.extraction.regions[0]!.warnings;
  check("§1c parti no farkı uyarısı + tamamlama künyesi uyarısı (alan etiketiyle)", w.some((x) => x.startsWith("BATCH_NO_DIFFERS:") && x.includes("AB1234 / A81234")) && w.some((x) => x.startsWith("SERVER_COMPLETED:") && x.includes("Hedef kumaş (desen)")), JSON.stringify(w));
  const r = f.desen!.source.rect;
  check("§1d sunucu kutusu cihaz çerçevesine ölçeklenir (×2)", !!r && r.x === 800 && r.y === 1000, JSON.stringify(r));
  check("§1e yedek şablona düşen sayfada tamamlama yok", missingHeaderFields(dx, CODE).length === 0);
  const other = extractDocument(srv, [{ ...TEMPLATE, id: "u-baska" }], null);
  check("§1f sunucu başka şablona sınıfladıysa doldurma yok", completeExtraction({ ocr: dev, ex: dx }, { ocr: srv, ex: other }, { fallbackId: null, templates: tpls }).filled.length === 0);
}

type Made = { shas: string[]; notes: string[] };

async function db(adminId: string, made: Made): Promise<void> {
  let calls = 0;
  const reader = (result: OcrResult | Error) => async (): Promise<ReaderResult> => {
    calls++;
    if (result instanceof Error) throw result;
    return { ok: true, result, engine: "sahte-sunucu", version: "t", durationMs: 7 };
  };
  const url = () => "http://127.0.0.1:1";
  const up = async (salt: string, ocr: OcrResult, read: Parameters<typeof serverCompleter>[0], readerUrl: () => string | null = url, noteId: string | null = null, pageNo = 1) => {
    const b = jpeg(salt);
    made.shas.push(sha(b));
    const r = await uploadScanWithDeviceRead({ contentBase64: b.toString("base64"), noteId, pageNo, clientOcr: asClient(ocr) }, adminId, undefined, serverCompleter(read, readerUrl));
    const scan = await prisma.documentScan.findUniqueOrThrow({ where: { id: r.scan.id }, select: { status: true, noteId: true, ocrResult: true } });
    if (scan.noteId && !made.notes.includes(scan.noteId)) made.notes.push(scan.noteId);
    const note = scan.noteId ? await prisma.customerDeliveryNote.findUnique({ where: { id: scan.noteId }, select: { ownerText: true, customerBatchNo: true, warnings: true } }) : null;
    const env = scan.ocrResult as { serverComplement?: { filled?: string[]; failed?: string | null; missing?: string[] } } | null;
    return { r, scan, note, env, warns: (Array.isArray(note?.warnings) ? note.warnings : []) as string[] };
  };

  console.log("§2 tam okuma");
  const full = await up("full", page({ musteri: "ACME BOYA", parti: "AB1234", desen: "ZETA DESEN" }), reader(page({})));
  check("§2a ⭐ tüm alanlar dolu → sunucu okuyucusu çağrılmadı (0), zarfta künye yok", calls === 0 && full.r.deviceOcr === "READ" && !full.env?.serverComplement, `çağrı ${calls}, ${full.r.deviceOcr}`);

  console.log("§3 eksik alan → sunucu tamamlaması");
  calls = 0;
  const part = await up("part", page({ parti: "AB1234", desen: "ZETA DESEN" }), reader(page({ musteri: "ACME BOYA", parti: "A81234", desen: "ZETA DESEN" })));
  check("§3a ⭐ eksik müşteri → okuyucu TAM bir kez", calls === 1, `çağrı ${calls}`);
  check("§3b tarama READ (cihaz yolu), taslak müşterisi sunucudan dolu", part.r.deviceOcr === "READ" && part.scan.status === "READ" && part.note?.ownerText === "ACME BOYA", `${part.scan.status} ${part.note?.ownerText}`);
  check("§3c ⭐ cihazın parti no'su EZİLMEDİ", part.note?.customerBatchNo === "AB1234", String(part.note?.customerBatchNo));
  check("§3d uyarılar: SERVER_COMPLETED (Müşteri) + BATCH_NO_DIFFERS", part.warns.some((w) => w.startsWith("SERVER_COMPLETED:") && w.includes("Müşteri")) && part.warns.some((w) => w.startsWith("BATCH_NO_DIFFERS:")), JSON.stringify(part.warns));
  check("§3e zarf künyesi: serverComplement.filled=[musteri], missing=[musteri]", JSON.stringify(part.env?.serverComplement?.filled) === '["musteri"]' && JSON.stringify(part.env?.serverComplement?.missing) === '["musteri"]', JSON.stringify({ f: part.env?.serverComplement?.filled, m: part.env?.serverComplement?.missing }));
  const rebuilt = await buildDraftFromEnvelope(part.scan.ocrResult, adminId);
  check("§3f saklı zarftan yeniden kurulum tamamlamayı yeniden üretir (sunucu çağrısı yok)", rebuilt?.headerCols.ownerText === "ACME BOYA" && calls === 1, `${rebuilt?.headerCols.ownerText} çağrı ${calls}`);

  console.log("§4 fail-soft");
  calls = 0;
  const err = await up("err", page({ parti: "AB1234" }), reader(new Error("sonda")));
  check("§4a okuyucu hata → cihaz sonucu kalır (READ, müşteri boş), zarfta failed künyesi", calls === 1 && err.scan.status === "READ" && !err.note?.ownerText && typeof err.env?.serverComplement?.failed === "string", `${err.scan.status} ${err.env?.serverComplement?.failed}`);
  calls = 0;
  const off = await up("off", page({ parti: "AB1234" }), reader(page({})), () => null);
  check("§4b okuma servisi adresi yok → çağrı yok, READ, failed=READER_OFF", calls === 0 && off.scan.status === "READ" && off.env?.serverComplement?.failed === "READER_OFF", `${calls} ${off.env?.serverComplement?.failed}`);

  console.log("§5 aynı taslakta farklı parti no");
  calls = 0;
  const p1 = await up("p1", page({ musteri: "ACME BOYA", parti: "AB1234", desen: "ZETA DESEN" }), reader(page({})));
  const noteId = p1.scan.noteId!;
  const p2 = await up("p2", page({ musteri: "ACME BOYA", parti: "AB1Z34", desen: "ZETA DESEN" }), reader(page({})), url, noteId, 2);
  check("§5a ikinci sayfa aynı taslağa okundu, ilk parti no korunur", p2.scan.noteId === noteId && p2.note?.customerBatchNo === "AB1234", `${p2.note?.customerBatchNo}`);
  check("§5b ⭐ BATCH_NO_DIFFERS: \"AB1234 / AB1Z34\" taslak uyarısında", p2.warns.some((w) => w.startsWith("BATCH_NO_DIFFERS:") && w.includes("AB1234 / AB1Z34")), JSON.stringify(p2.warns));
  const p3 = await up("p3", page({ musteri: "ACME BOYA", parti: "ab 1234", desen: "ZETA DESEN" }), reader(page({})), url, noteId, 3);
  check("§5c yalnız boşluk/harf büyüklüğü farkı uyarı ÜRETMEZ (uyarı sayısı artmadı)", p3.warns.filter((w) => w.startsWith("BATCH_NO_DIFFERS:")).length === 1, JSON.stringify(p3.warns));
}

async function main(): Promise<void> {
  console.log("=== Gelen belge sunucu tamamlaması bekçisi ===\n");
  unit();
  const made: Made = { shas: [], notes: [] };
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  try {
    await prisma.senderTemplate.create({ data: { code: CODE, version: 1, template: JSON.parse(JSON.stringify({ ...TEMPLATE, id: undefined })), isActive: true } });
    await db(admin.id, made);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    await prisma.documentScan.updateMany({ where: { noteId: { in: made.notes } }, data: { noteId: null } }).catch(() => undefined);
    await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } }).catch((e) => check("temizlik", false, String(e)));
    await prisma.documentScan.deleteMany({ where: { sha256: { in: made.shas } } }).catch((e) => check("temizlik", false, String(e)));
    await prisma.senderTemplateVersion.deleteMany({ where: { template: { code: CODE } } }).catch(() => undefined);
    await prisma.senderTemplate.deleteMany({ where: { code: CODE } }).catch((e) => check("temizlik", false, String(e)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
