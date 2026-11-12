// =============================================================================
// BEKÇİ — GELEN BELGE FOTOĞRAF BARKODU (2026-11-09): tabletin okuduğu barkodlar (`barcodes`) → motor; şablonda
// `fromBarcode` işaretli alana barkod KESİN değer, işaretsiz alanda eşit barkod TEYİT; barkod yokken bugünkü çıkarım.
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts gelen_belge_barkod   (gerçek DB + HTTP; okuma servisi GEREKMEZ)
//   §1 temizlik + şema: yıldız/boşluk/denetim atılır; ≤ 10; zarf şeması barkodu korur
//   §2 ⭐ motor: işaretli alan → barkod OCR'ı geçer · biçime (valueShape/tip) uymayan barkod yok sayılır · barkod yokken
//      sonuç birebir eski · işaretsiz + eşit → teyitli (gözden geçirme yok) · işaretsiz + farklı → dokunulmaz · bant barkodsuz
//   §3 şablon: `barcodeFields` düzenlemesi (aç/kapa/olmayan alan hatası) + doğrulama (boolean değil → hata)
//   §4 ⭐ uç: `barcodes` cihaz okumasına eklenir (motorun gördüğü sonuçta) · 11 barkod / fazla alan → 400, tarama yazılmaz
// ⭐ NEGATİF SONDA (2026-11-09, elle, geri alındı): `extract.ts` `applyBarcodes` satırı kapatılınca §2a/§2d düşer;
//    `barcodeValueFor` biçim (valueShape) denetimi kapatılınca §2b düşer; istemci-okuma `barcodes` eklemesi kapatılınca §4a düşer.
// =============================================================================
import type { AddressInfo } from "net";
import type { Server } from "node:http";
import { createHash } from "node:crypto";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { cleanBarcodeValue, normalizeBarcodes, PageBarcodesSchema } from "../src/lib/gelen-belge/barkod";
import { OcrResultSchema } from "../src/lib/gelen-belge/okuma-istemcisi";
import { editTemplateDefinition, extractFields, validateTemplate, type DocumentTemplate, type OcrBlock, type OcrResult } from "../src/lib/gelen-belge/motor";
import { extractSections } from "../src/lib/gelen-belge/motor/sections";
import { uploadScanWithDeviceRead } from "../src/services/gelen-belge-istemci-okuma.service";
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

// ── Sentetik sayfa: "İş Emri  ISM1439776" (OCR son haneyi yanlış okumuş) + "Cinsi  TUL" ─────────────────────────
function line(words: string[], y: number): OcrBlock {
  let x = 100;
  const elements = words.map((t) => {
    const e = { text: t, rect: { x, y, width: t.length * 20, height: 30 }, confidence: 0.95 };
    x += t.length * 20 + 20;
    return e;
  });
  const rect = { x: 100, y, width: x - 120, height: 30 };
  const text = words.join(" ");
  return { text, rect, lines: [{ text, rect, confidence: 0.95, angle: 0, elements }] };
}
const page = (barcodes?: OcrResult["barcodes"]): OcrResult => {
  const blocks = [line(["İş", "Emri", "ISM1439776"], 100), line(["Cinsi", "TUL"], 200), line(["Sipariş", "SP-77"], 300)];
  return { text: blocks.map((b) => b.text).join("\n"), blocks, imageWidth: 1000, imageHeight: 1400, ...(barcodes ? { barcodes } : {}) };
};
const tpl = (fromBarcode: boolean): DocumentTemplate => ({
  id: "u-test-barkod", name: "TEST barkod", version: 1, identifiers: { keywords: ["İş Emri"] },
  fields: [
    { key: "partiNo", label: "Parti No", type: "alnum", ...(fromBarcode ? { fromBarcode: true } : {}), postProcess: ["upper", "stripSpaces"],
      strategies: [{ kind: "anchor", labels: ["İş Emri"], direction: "right", maxWords: 1, valueShape: "^\\p{L}+\\d+$" }] },
    { key: "siparisNo", label: "Sipariş", type: "alnum", strategies: [{ kind: "anchor", labels: ["Sipariş"], direction: "right", maxWords: 1 }] },
  ],
});
const BC = (value: string, format = "code128") => ({ format, value });

function unit(): void {
  console.log("§1 temizlik + şema");
  check("§1a Code 39 yıldızı/boşluk/denetim atılır", cleanBarcodeValue(" *ISM1439770*\u001d ") === "ISM1439770" && cleanBarcodeValue("**") === null);
  const many = normalizeBarcodes([...Array.from({ length: 15 }, (_, i) => BC(`A${i}`)), BC("A1"), { format: 3, value: "X" }]);
  check("§1b normalize: tekil, ≤ 10, biçimi metin olmayan → unknown", many.length === 10 && normalizeBarcodes([{ format: 3, value: "*X*" }])[0]?.format === "unknown");
  check("§1c gövde şeması: 11 barkod / fazla alan → red; 10 geçerli → kabul",
    !PageBarcodesSchema.safeParse(Array.from({ length: 11 }, (_, i) => BC(`B${i}`))).success
    && !PageBarcodesSchema.safeParse([{ format: "qr", value: "1", extra: 1 }]).success
    && PageBarcodesSchema.safeParse(Array.from({ length: 10 }, (_, i) => BC(`B${i}`))).success);
  const env = OcrResultSchema.safeParse(page([BC("ISM1439770")]));
  check("§1d zarf şeması barkodu korur (yeniden okuma kaybetmez)", env.success && env.data.barcodes?.[0]?.value === "ISM1439770");
}

function motor(): void {
  console.log("§2 motor");
  const flagged = tpl(true);
  const a = extractFields(page([BC("QR-ILGISIZ-URL", "qr"), BC("*ISM1439770*", "code39")]), flagged).fields.partiNo!;
  check("§2a ⭐ işaretli alan: biçime uyan barkod OCR'ı geçer (KESİN, gözden geçirme yok)",
    a.value === "ISM1439770" && a.source.strategy === "barcode" && a.needsReview === false && a.confidence === 1, JSON.stringify({ v: a.value, s: a.source.strategy, r: a.needsReview }));
  const b = extractFields(page([BC("12345678"), BC("http://x.y/z", "qr")]), flagged).fields.partiNo!;
  check("§2b ⭐ biçime uymayan barkod yok sayılır → OCR değeri kalır", b.value === "ISM1439776" && b.source.strategy === "anchor", `${b.value} ${b.source.strategy}`);
  const plain = extractFields(page(), flagged);
  const plainUnflagged = extractFields(page(), tpl(false));
  const strip = (r: typeof plain) => JSON.stringify(r.fields);
  check("§2c ⭐ barkod yokken sonuç birebir eski (işaretli/işaretsiz aynı, barkod izi yok)",
    strip(plain) === strip(plainUnflagged) && plain.fields.partiNo!.value === "ISM1439776" && !strip(plain).includes("barcode"));
  const d = extractFields(page([BC("ISM1439776")]), tpl(false)).fields.partiNo!;
  check("§2d işaretsiz alan + OCR'a eşit barkod → teyitli (güven 1, gözden geçirme yok, değer aynı)",
    d.value === "ISM1439776" && d.source.barcodeConfirmed === true && d.confidence === 1 && !d.needsReview && d.source.strategy === "anchor");
  const e = extractFields(page([BC("ISM1439770")]), tpl(false)).fields.partiNo!;
  check("§2e işaretsiz alan + farklı barkod → dokunulmaz", e.value === "ISM1439776" && !e.source.barcodeConfirmed && JSON.stringify(e) === JSON.stringify(plainUnflagged.fields.partiNo));
  const f = extractFields(page([BC("ISM1439770"), BC("ABC999")]), flagged).fields.partiNo!;
  check("§2f işaretli alan + iki farklı uyan barkod (OCR'a eşit yok) → ilki, gözden geçirmeye düşer", f.value === "ISM1439770" && f.needsReview && f.issues.includes("barcode-ambiguous"));
  // Bölüm bandı barkodu taşımaz: her partinin değeri kendi bandından okunur.
  const spec = { startLabels: ["İş Emri"], fields: ["partiNo"], batchField: "partiNo" };
  const sr = extractSections(page([BC("ISM1439770")]), { ...flagged, sections: spec }, spec, []);
  const firstBatch = sr.sections[0]?.fields.partiNo?.value ?? null;
  check("§2g bölüm bandına barkod taşınmaz (bant değeri OCR'dan)", firstBatch === "ISM1439776", String(firstBatch));
}

function template(): void {
  console.log("§3 şablon");
  const base = tpl(false);
  const on = editTemplateDefinition(base, { barcodeFields: ["partiNo"] });
  check("§3a barcodeFields aç → alan fromBarcode, değişiklik kaydı", on.errors.length === 0 && on.template.fields[0]!.fromBarcode === true && on.changes.barcodeFields?.to.join() === "partiNo");
  const off = editTemplateDefinition(on.template, { barcodeFields: [] });
  check("§3b [] → işaret kalkar (anahtar hiç kalmaz)", off.errors.length === 0 && !("fromBarcode" in off.template.fields[0]!) && off.changes.barcodeFields?.from.join() === "partiNo");
  check("§3c aynı liste → değişiklik yok (sürüm artmaz)", Object.keys(editTemplateDefinition(on.template, { barcodeFields: ["partiNo"] }).changes).length === 0);
  check("§3d olmayan alan → hata", editTemplateDefinition(base, { barcodeFields: ["yok"] }).errors.length === 1);
  const bad = { ...base, fields: [{ ...base.fields[0]!, fromBarcode: "evet" }] };
  check("§3e doğrulama: fromBarcode boolean değil → geçersiz; boolean → geçerli", !validateTemplate(bad).ok && validateTemplate(on.template).ok);
}

const TAG = `GBB${Date.now().toString(36).toUpperCase()}`;
const made = { shas: [] as string[] };
const jpeg = (salt: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} ${salt}`)]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const Q = (x: number, y: number): [number, number][] => [[x, y], [x + 50, y], [x + 50, y + 20], [x, y + 20]];
const CLIENT: ClientOcr = { engine: "mlkit", width: 1000, height: 1400, rotation: 0, words: [{ t: "İş", c: Q(10, 10), l: 0 }], lines: [{ c: Q(10, 10) }] };

async function http(adminId: string, call: (body: unknown) => Promise<{ status: number; code?: string }>): Promise<void> {
  console.log("§4 uç");
  const f1 = jpeg("wire");
  made.shas.push(sha(f1));
  let seen: OcrResult["barcodes"] | "çağrılmadı" = "çağrılmadı";
  await uploadScanWithDeviceRead({ contentBase64: f1.toString("base64"), clientOcr: CLIENT, barcodes: [BC("*ISM1439770*"), BC("")] }, adminId, async (_id, _url, ocr) => {
    const r = await ocr!("", Buffer.alloc(0), "image/jpeg");
    seen = r.ok ? r.result.barcodes : undefined;
    throw new Error("sonda: yalnız girdi ölçülür");
  });
  check("§4a ⭐ barkodlar cihaz okumasına temizlenmiş eklenir (motorun gördüğü sonuç)", JSON.stringify(seen) === JSON.stringify([BC("ISM1439770")]), JSON.stringify(seen));
  const f2 = jpeg("no-barcode");
  made.shas.push(sha(f2));
  let seen2: unknown = "çağrılmadı";
  await uploadScanWithDeviceRead({ contentBase64: f2.toString("base64"), clientOcr: CLIENT }, adminId, async (_id, _url, ocr) => {
    const r = await ocr!("", Buffer.alloc(0), "image/jpeg");
    seen2 = r.ok ? ("barcodes" in r.result) : "x";
    throw new Error("sonda");
  });
  check("§4b barkodsuz yükleme → sonuçta barkod alanı YOK (bugünkü girdi)", seen2 === false, String(seen2));
  const f3 = jpeg("too-many");
  const r3 = await call({ contentBase64: f3.toString("base64"), barcodes: Array.from({ length: 11 }, (_, i) => BC(`C${i}`)) });
  const r4 = await call({ contentBase64: f3.toString("base64"), barcodes: [{ format: "qr", value: "1", x: 1 }] });
  made.shas.push(sha(f3));
  check("§4c 11 barkod / fazla alan → 400, tarama yazılmaz", r3.status === 400 && r4.status === 400 && (await prisma.documentScan.count({ where: { sha256: sha(f3) } })) === 0, `${r3.status} ${r4.status}`);
  const f5 = jpeg("ok");
  made.shas.push(sha(f5));
  const r5 = await call({ contentBase64: f5.toString("base64"), barcodes: [BC("ISM1439770")] });
  check("§4d geçerli barkodlu gövde kabul (201)", r5.status === 201, String(r5.status));
}

async function main(): Promise<void> {
  console.log("=== Gelen belge fotoğraf barkodu bekçisi ===\n");
  unit();
  motor();
  template();
  const keys = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED];
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const k of keys) await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: true }, update: { value: true } });
    const lr = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: admin.password, clientType: "electron" }) });
    const tk = ((await lr.json()) as { data?: { token?: string } }).data?.token ?? "";
    check("admin login", tk.length > 0);
    await http(admin.id, async (body) => {
      const r = await fetch(`${url}/api/gelen-belge/taramalar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { details?: { code?: string } };
      return { status: r.status, code: j.details?.code };
    });
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    stopNotificationJobs();
    await new Promise<void>((r) => server.close(() => r()));
    for (const k of keys) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await prisma.documentScan.deleteMany({ where: { sha256: { in: made.shas }, noteId: null } }).catch((e) => check("temizlik", false, String(e)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
