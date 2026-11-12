// =============================================================================
// BEKÇİ — GELEN BELGE CİHAZDA OCR (S16c): tabletin ML Kit okuması (`clientOcr`) → okuma servisi zarfı → aynı motor
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts gelen_belge_istemci_ocr   (gerçek DB + HTTP; okuma servisi GEREKMEZ)
//   §1 dönüştürücü birim: katı şema (fazla alan · köşe sayısı · tavan · `l` aralığı), kırpma, açı aynası, `l` ile satırlama,
//      `l`siz geometrik satırlama, okuma sırası, güven ortalaması
//   §2 ⭐ ALTIN: 0245 fikstüründen kelime + satır dörtgeni → dönüştür → motor taslağı orijinalle BİREBİR (21/21 satır, beyan, başlık)
//   §3 rotation=90: satır kutusu saklanan fotoğraf çerçevesine `linesToPhotoFrame` ile döner
//   §4 ⭐ HTTP: geçersiz/tavan aşımı → 400 CLIENT_OCR_INVALID ve HİÇBİR tarama yazılmaz; geçerli → 201, tarama READ (mlkit),
//      taslak 21 satır — okuma servisi adresi YOKKEN; bağsız yükleme de taslak doğurur
//   §5 yeniden kullanılan PENDING kayıt + clientOcr → 200 duplicate, claim'le okunur (READ)
//   §6 ⭐ düşme: işlemci hata atarsa tarama PENDING/deneme 0'a döner (`deviceOcr` FALLBACK), okuma işi alabilir;
//      §6c `bornReading` kaydı READING/deneme 1 doğurur
// ⭐ NEGATİF SONDA (2026-11-04, elle, geri alındı): `uploadDocumentScan` `bornReading` dalı kapatılınca (kayıt PENDING doğar)
//    §6c düşer (§4c/§4d claim yedeğiyle geçer — pencere yalnız §6c'de görünür); `readOnDevice` PENDING'e bırakma satırı kapatılınca §6b düşer;
//    `clientOcrToResult` okuma sırası (`sortReadingOrder`) kapatılınca §1h/§1i düşer.
// =============================================================================
import type { AddressInfo } from "net";
import type { Server } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { setReaderUrlForTests } from "../src/lib/gelen-belge/url";
import { ClientOcrSchema, clientOcrToResult, quadAngleDeg, type ClientOcr } from "../src/lib/gelen-belge/istemci-ocr";
import { extractDocument, loadTemplates, type OcrResult } from "../src/lib/gelen-belge/motor";
import { draftFromExtraction } from "../src/lib/gelen-belge/taslak";
import { linesToPhotoFrame } from "../src/lib/gelen-belge/taslak-foto-cerceve";
import { uploadScanWithDeviceRead } from "../src/services/gelen-belge-istemci-okuma.service";
import { uploadDocumentScan } from "../src/services/gelen-belge-scan.service";
import { testSablonlariniKaydet } from "./lib/gelen-belge-test-sablonlar";

// Gönderen şablonları pakette yok (2026-11-09): bekçi onları süreç içi dosya şablonu olarak kaydeder.
testSablonlariniKaydet();

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

const TAG = `GBC${Date.now().toString(36).toUpperCase()}`;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const jpeg = (salt: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} ${salt}`)]);
const FIKSTUR = join(__dirname, "..", "src", "lib", "gelen-belge", "motor", "__tests__", "fikstur", "gercek");
const gercek = (ad: string): OcrResult => JSON.parse(readFileSync(join(FIKSTUR, `${ad}.json`), "utf8")) as OcrResult;
const sablonlar = loadTemplates();
type Q = [number, number][];
const rectQuad = (r: { x: number; y: number; width: number; height: number }): Q => [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]];

/** Okuma servisi sonucunu cihazın göndereceği biçime çevirir: kelime dörtgeni eleman kutusundan, satır dörtgeni satır köşelerinden. */
function asClientOcr(r: OcrResult, opts: { withLines: boolean }): ClientOcr {
  const lines = r.blocks.flatMap((b) => b.lines);
  return {
    engine: "mlkit",
    width: r.imageWidth,
    height: r.imageHeight,
    rotation: 0,
    ms: 123,
    words: lines.flatMap((l, i) => l.elements.map((e) => ({ t: e.text, c: rectQuad(e.rect), ...(opts.withLines ? { l: i } : {}), p: e.confidence }))),
    ...(opts.withLines ? { lines: lines.map((l) => ({ c: (l.corners ?? []).map((p) => [p.x, p.y] as [number, number]), p: l.confidence })) } : {}),
  };
}

function unit(): void {
  console.log("§1 dönüştürücü");
  const base: ClientOcr = { engine: "mlkit", width: 100, height: 50, words: [{ t: "AB", c: [[0, 0], [10, 0], [10, 5], [0, 5]] }] };
  check("§1a geçerli en küçük gövde kabul", ClientOcrSchema.safeParse(base).success);
  check("§1b fazla alan RED (katı)", !ClientOcrSchema.safeParse({ ...base, extra: 1 }).success);
  check("§1c 3 köşe RED", !ClientOcrSchema.safeParse({ ...base, words: [{ t: "A", c: [[0, 0], [1, 0], [1, 1]] }] }).success);
  check("§1d kelime tavanı 4000 (4001 RED)", !ClientOcrSchema.safeParse({ ...base, words: Array.from({ length: 4001 }, () => base.words[0]) }).success
    && ClientOcrSchema.safeParse({ ...base, words: Array.from({ length: 4000 }, () => base.words[0]) }).success);
  check("§1e `l` satır listesinin dışında RED · motor adı yalnız mlkit · boyut 0 RED · |koordinat| > 20000 RED",
    !ClientOcrSchema.safeParse({ ...base, words: [{ ...base.words[0]!, l: 1 }], lines: [{ c: base.words[0]!.c }] }).success
      && !ClientOcrSchema.safeParse({ ...base, engine: "paddle" }).success
      && !ClientOcrSchema.safeParse({ ...base, width: 0 }).success
      && !ClientOcrSchema.safeParse({ ...base, words: [{ t: "A", c: [[0, 0], [20001, 0], [1, 1], [0, 1]] }] }).success);
  const clipped = clientOcrToResult({ ...base, words: [{ t: "X", c: [[-5, -5], [150, -5], [150, 60], [-5, 60]], p: 0.5 }] });
  const r0 = clipped.blocks[0]!.lines[0]!.rect;
  check("§1f koordinat görüntü çerçevesine kırpılır", r0.x === 0 && r0.y === 0 && r0.width === 100 && r0.height === 50, JSON.stringify(r0));
  check("§1g açı aynası: üst kenar 10° → 10 · ters yön ±90'a katlanır", Math.abs(quadAngleDeg([[0, 0], [100, 17.6327], [100, 30], [0, 10]]) - 10) < 0.01
    && Math.abs(quadAngleDeg([[100, 17.6327], [0, 0], [0, 10], [100, 30]]) - 10) < 0.01);
  const w = (t: string, x: number, y: number, l?: number, p?: number) => ({ t, c: [[x, y], [x + 30, y], [x + 30, y + 10], [x, y + 10]] as Q, ...(l !== undefined ? { l } : {}), ...(p !== undefined ? { p } : {}) });
  const geo = clientOcrToResult({ engine: "mlkit", width: 1000, height: 500, words: [w("ALT", 10, 100), w("SAG", 300, 20), w("UST", 10, 20), w("ORTA", 45, 21)] });
  check("§1h `l`siz: aynı sıra + yakın kelime tek satır, uzak kelime ayrı satır, okuma sırası y-sonra-x",
    geo.blocks.map((b) => b.text).join("|") === "UST ORTA|SAG|ALT" && geo.text === "UST ORTA\nSAG\nALT", geo.blocks.map((b) => b.text).join("|"));
  const byL = clientOcrToResult({ engine: "mlkit", width: 1000, height: 500, words: [w("B1", 10, 100, 1, 0.8), w("A1", 10, 20, 0, 0.9), w("A2", 300, 20, 0, 0.7)], lines: [{ c: [[10, 20], [330, 20], [330, 30], [10, 30]] }, { c: [[10, 100], [40, 100], [40, 110], [10, 110]], p: 0.66 }] });
  const a = byL.blocks[0]!.lines[0]!;
  check("§1i `l` ile satırlama: cihazın satırı (uzak kelime de aynı satır), dörtgen `lines[l]`den, güven ort. ya da satırın p'si",
    byL.blocks.length === 2 && a.text === "A1 A2" && a.rect.width === 320 && a.confidence === 0.8 && byL.blocks[1]!.lines[0]!.confidence === 0.66 && a.elements.length === 2,
    JSON.stringify(byL.blocks.map((b) => [b.text, b.lines[0]!.confidence])));
  check("§1j zarf: motor adı mlkit, boyut, süre, dönüş 0; boş metinli kelime atlanır",
    byL.engine === "mlkit" && byL.imageWidth === 1000 && byL.rotation === 0 && clientOcrToResult({ ...base, words: [{ t: "  ", c: base.words[0]!.c }] }).blocks.length === 0);
}

function golden(): void {
  console.log("§2 altın — 0245");
  const orig = gercek("0245-ceki-listesi-a");
  const want = draftFromExtraction(extractDocument(orig, sablonlar));
  for (const withLines of [true]) { // l'siz geometrik yol tablo başlığı hücrelerini birleştirir (0245: "Sira No Top No") — yalnız yedek; tablet `l` gönderir
    const conv = clientOcrToResult(ClientOcrSchema.parse(asClientOcr(orig, { withLines })));
    const got = draftFromExtraction(extractDocument(conv, sablonlar));
    const key = withLines ? "§2a (kelime + l + satır dörtgeni)" : "§2b (l'siz, geometrik satırlama)";
    check(`${key} satır sayısı 21`, got.lines.length === 21 && want.lines.length === 21, `${got.lines.length}/${want.lines.length}`);
    const vals = (d: typeof got) => JSON.stringify(d.lines.map((l) => [l.blockNo, l.senderRollNo, l.meters, l.weightKg, l.needsReview]));
    check(`${key} satır değerleri orijinalle aynı`, vals(got) === vals(want));
    const head = (d: typeof got) => JSON.stringify([d.header.senderDocNo, d.header.senderDocDate, d.header.customerOrderNo, d.header.totalsDeclared.blocks, d.header.regions.map((r) => r.templateId)]);
    check(`${key} başlık + blok beyanı (5/141,70/586 · 16/819,20/3.935) aynı`, head(got) === head(want), head(got).slice(0, 200));
  }
}

function rotation(): void {
  console.log("§3 dönüş");
  const conv = clientOcrToResult({ engine: "mlkit", width: 200, height: 100, rotation: 90, words: [{ t: "X", c: rectQuad({ x: 10, y: 20, width: 30, height: 5 }) }] });
  const line = { sourceRects: { m: { x: 10, y: 20, width: 30, height: 5 } } } as unknown as Parameters<typeof linesToPhotoFrame>[0][number];
  const back = linesToPhotoFrame([line], conv)[0]!.sourceRects.m!;
  check("§3a rotation=90 zarfa geçer, kutu fotoğraf çerçevesine döner (x=y, y=W−(x+w))", conv.rotation === 90 && back.x === 20 && back.y === 160 && back.width === 5 && back.height === 30, JSON.stringify(back));
}

const made = { notes: [] as string[], shas: [] as string[] };
type Resp = { status: number; code?: string; data?: { scan?: { id: string; status: string; noteId: string | null; attempts: number }; duplicate?: boolean; deviceOcr?: string | null; id?: string } };

async function http(adminId: string, call: (m: string, p: string, b?: unknown) => Promise<Resp>): Promise<void> {
  const client = asClientOcr(gercek("0245-ceki-listesi-a"), { withLines: true });
  const up = (buf: Buffer, extra: Record<string, unknown> = {}) => { made.shas.push(sha(buf)); return call("POST", "/api/gelen-belge/taramalar", { contentBase64: buf.toString("base64"), sha256: sha(buf), ...extra }); };
  const scanCount = () => prisma.documentScan.count({ where: { capturedById: adminId } });
  const newNote = async (s: string) => {
    const n = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderDocNo: `${TAG}-${s}` });
    const id = String(n.data?.id ?? "");
    if (id) made.notes.push(id);
    return id;
  };
  console.log("§4 HTTP (okuma servisi adresi YOK)");
  setReaderUrlForTests(null);
  const n1 = await newNote("N1");
  const before = await scanCount();
  const bad = await up(jpeg("bad"), { noteId: n1, clientOcr: { ...client, extra: true } });
  const big = await up(jpeg("big"), { noteId: n1, clientOcr: { ...client, words: Array.from({ length: 4001 }, () => client.words[0]) } });
  check("§4a geçersiz clientOcr → 400 CLIENT_OCR_INVALID", bad.status === 400 && bad.code === "CLIENT_OCR_INVALID", `${bad.status} ${bad.code}`);
  check("§4b kelime tavanı aşımı → 400 CLIENT_OCR_INVALID; iki istekte de tarama YAZILMADI", big.status === 400 && big.code === "CLIENT_OCR_INVALID" && (await scanCount()) === before, `${big.status} ${big.code}`);
  const ok = await up(jpeg("ok"), { noteId: n1, pageNo: 1, clientOcr: client });
  const scan = ok.data?.scan?.id ? await prisma.documentScan.findUnique({ where: { id: ok.data.scan.id }, select: { status: true, ocrEngine: true, noteId: true } }) : null;
  check("§4c geçerli → 201, deviceOcr READ, tarama READ · motor mlkit", ok.status === 201 && ok.data?.deviceOcr === "READ" && ok.data?.scan?.status === "READ" && scan?.status === "READ" && scan.ocrEngine === "mlkit", `${ok.status} ${ok.data?.deviceOcr} ${scan?.status} ${scan?.ocrEngine}`);
  const lines = await prisma.customerDeliveryNoteLine.count({ where: { noteId: n1 } });
  const note = await prisma.customerDeliveryNote.findUnique({ where: { id: n1 }, select: { sourceKind: true } });
  check("§4d ⭐ taslak 21 satırla doldu (okuma servisi yokken), kaynak OCR", lines === 21 && note?.sourceKind === "OCR", `${lines} ${note?.sourceKind}`);
  const free = await up(jpeg("free"), { clientOcr: client });
  const freeScan = free.data?.scan?.id ? await prisma.documentScan.findUnique({ where: { id: free.data.scan.id }, select: { status: true, noteId: true } }) : null;
  if (freeScan?.noteId) made.notes.push(freeScan.noteId);
  const freeLines = freeScan?.noteId ? await prisma.customerDeliveryNoteLine.count({ where: { noteId: freeScan.noteId } }) : -1;
  check("§4e bağsız yükleme → yeni OCR taslağı aynı istekte (21 satır)", free.status === 201 && freeScan?.status === "READ" && freeLines === 21, `${free.status} ${freeScan?.status} ${freeLines}`);

  console.log("§5 yeniden kullanılan PENDING");
  const n2 = await newNote("N2");
  const p = jpeg("pending");
  const first = await up(p, { noteId: n2 });
  check("§5a clientOcr'sız yükleme PENDING doğar (bugünkü)", first.status === 201 && first.data?.scan?.status === "PENDING" && first.data?.deviceOcr === null, `${first.status} ${first.data?.scan?.status}`);
  const again = await up(p, { noteId: n2, clientOcr: client });
  check("§5b aynı fotoğraf + clientOcr → 200 duplicate, claim'le READ, 21 satır", again.status === 200 && again.data?.duplicate === true && again.data?.deviceOcr === "READ" && again.data?.scan?.status === "READ"
    && (await prisma.customerDeliveryNoteLine.count({ where: { noteId: n2 } })) === 21, `${again.status} ${again.data?.deviceOcr} ${again.data?.scan?.status}`);
  const third = await up(p, { noteId: n2, clientOcr: client });
  check("§5c okunmuş kayıt + clientOcr → cihaz okuması yok sayılır (deviceOcr null), satır ikilenmez", third.status === 200 && third.data?.deviceOcr === null
    && (await prisma.customerDeliveryNoteLine.count({ where: { noteId: n2 } })) === 21, `${third.status} ${third.data?.deviceOcr}`);

  console.log("§6 düşme");
  const n3 = await newNote("N3");
  const fb = jpeg("fallback");
  made.shas.push(sha(fb));
  const r6 = await uploadScanWithDeviceRead({ contentBase64: fb.toString("base64"), noteId: n3, clientOcr: client }, adminId, () => Promise.reject(new Error("sonda")));
  const s6 = await prisma.documentScan.findUnique({ where: { id: r6.scan.id }, select: { status: true, attempts: true } });
  check("§6a işlemci hata atar → deviceOcr FALLBACK", r6.deviceOcr === "FALLBACK", String(r6.deviceOcr));
  check("§6b ⭐ tarama PENDING / deneme 0 (sunucu okuması tam hakla alır), satır yok", s6?.status === "PENDING" && s6.attempts === 0 && (await prisma.customerDeliveryNoteLine.count({ where: { noteId: n3 } })) === 0, JSON.stringify(s6));
  // Doğuşta READING: PENDING doğup sonra claim'lenseydi okuma işi aradaki pencerede kaydı çalabilirdi.
  const born = jpeg("born-reading");
  made.shas.push(sha(born));
  const b6 = await uploadDocumentScan({ contentBase64: born.toString("base64") }, adminId, { bornReading: true });
  check("§6c ⭐ bornReading → kayıt READING / deneme 1 doğar (okuma işi alamaz)", b6.scan.status === "READING" && b6.scan.attempts === 1, `${b6.scan.status}/${b6.scan.attempts}`);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge cihazda OCR bekçisi ===\n");
  unit();
  golden();
  rotation();
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
    const call = async (method: string, path: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
      return { status: r.status, code: j.details?.code, data: j.data };
    };
    await http(admin.id, call);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    setReaderUrlForTests(null);
    stopNotificationJobs();
    await new Promise<void>((r) => server.close(() => r()));
    for (const k of keys) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await prisma.documentScan.updateMany({ where: { noteId: { in: made.notes } }, data: { noteId: null } }).catch(() => undefined);
    await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } }).catch((e) => check("temizlik", false, String(e)));
    await prisma.documentScan.deleteMany({ where: { sha256: { in: made.shas } } }).catch((e) => check("temizlik", false, String(e)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
