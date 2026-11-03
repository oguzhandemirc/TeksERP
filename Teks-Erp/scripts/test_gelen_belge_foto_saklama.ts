// =============================================================================
// GELEN BELGE — belge fotoğrafı saklama (K28, Gülkesim S13b; fabrika cevabı K28: Gülkesim = ONAYDA KÜÇÜLT)
// =============================================================================
// HTTP + gerçek DB + sahte okuma servisi (`POST /kucult`). Servis `gelen-belge-foto-saklama.service.ts` (iş turu
// `runPhotoRetention`), uçlar `GET /taramalar/:id/icerik` · `/kelimeler` · `POST /taramalar/:id/oku` · `GET /irsaliyeler/:id`
// · `GET /is-emirleri/:id/belgeler`. Sınanan:
//   §1 ayar `gelenBelge.photoRetention` varsayılan FULL (bugünkü), dedicated; FULL'da tur hiçbir taramaya dokunmaz
//   §2 ⭐ ONAYDA KÜÇÜLT: servis yok/eski (404) → TAM kalır (RETRY); servis var → KÜÇÜK, bayt küçüldü, satır/sha/okuma duruyor;
//      ikinci tur dokunmaz (tek küçültme); eşzamanlı iki uygulama tek yazım; taslak ve PDF dokunulmaz; KÜÇÜK fotoğraf açılır
//   §3 ⭐ ONAYDA SİL: onaylı → SİLİNDİ (content NULL, satır kalır); geçmiş KÜÇÜK de silinir; icerik/kelimeler/oku → 410
//      DOCUMENT_SCAN_PURGED; okuma kuyruğu SİLİNDİ taramayı claim etmez
//   §4 ⭐ SEVKTE SİL: topu canlı belge dokunulmaz; bütün topları SHIPPED → SİLİNDİ
//   §5 ⭐ CHECK seddi: SİLİNDİ + bayt dolu ve TAM + bayt boş DB'de reddedilir
//   §6 ⭐ audit yükünde bayt/base64 yok (yalnız künye)
//   §7 İE "Geldiği belge" ucu: belgeden açılan İE → belge + tarama bayt durumu; bilinmeyen İE 404
// Negatif sonda: `applyRetention` claim WHERE'inden `contentState` çıkarılınca §2 "tek küçültme" kırmızı;
// `readDocumentScanContent`ten 410 dalı çıkarılınca §3 kırmızı; `fullyShippedNoteIds` HAVING'den canlı top koşulu
// çıkarılınca §4 "canlı top" kırmızı.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import type { AddressInfo } from "net";
import http, { type Server } from "node:http";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { INCOMING_DOC_DEDICATED_SETTING_KEYS } from "../src/services/gelen-belge-ayar.service";
import { applyRetention, runPhotoRetention } from "../src/services/gelen-belge-foto-saklama.service";
import { claimNextScan } from "../src/services/gelen-belge-okuma.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

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

const TAG = `TEST-GBF${Date.now().toString(36).toUpperCase()}`;
const BIG = (salt: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} ${salt} `.repeat(400))]);
const SMALL = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("KUCUK")]);
const PDF = (salt: string) => Buffer.from(`%PDF-1.4 ${TAG} ${salt}`);

const made = { customers: [] as string[], notes: [] as string[], items: [] as string[], scans: [] as string[], stations: [] as string[], routes: [] as string[], workOrders: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_PHOTO_RETENTION,
];

type Resp = { status: number; code?: string; data?: Record<string, unknown>; raw?: Buffer };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

/** Sahte okuma servisi: `/kucult` kipe göre 200 (küçük JPEG) · 404 (eski sürüm) · 503 (kapalı). */
function startFakeReader(): Promise<{ server: Server; url: string; hits: () => number; setMode: (m: "ok" | "old" | "down") => void }> {
  let hits = 0;
  let mode: "ok" | "old" | "down" = "down";
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/kucult" || mode === "old") { res.writeHead(404); res.end(); return; }
      hits++;
      if (mode === "down") { res.writeHead(503); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ imageBase64: SMALL.toString("base64"), mimeType: "image/jpeg", width: 1600, height: 1067 }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits: () => hits, setMode: (m) => { mode = m; } })));
}

async function scanRow(id: string) {
  return prisma.documentScan.findUniqueOrThrow({ where: { id }, select: { contentState: true, contentStateAt: true, content: true, sizeBytes: true, sha256: true, mimeType: true, ocrResult: true, noteId: true } });
}

async function run(url: string, reader: Awaited<ReturnType<typeof startFakeReader>>): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_PHOTO_RETENTION]) await setSetting(k, null);
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");
  const lr = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: admin.password, clientType: "electron" }) });
  const tk = ((await lr.json()) as { data?: { token?: string } }).data?.token ?? "";
  check("admin login", tk.length > 0);
  const call = async (method: string, path: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = Buffer.from(await r.arrayBuffer());
    let j: { data?: Record<string, unknown>; details?: { code?: string } } = {};
    try { j = JSON.parse(raw.toString("utf8")); } catch { /* ikili gövde */ }
    return { status: r.status, code: j.details?.code, data: j.data, raw };
  };
  const owner = (await prisma.customer.create({ data: { code: `${TAG}-O`, name: `${TAG} Sahip` }, select: { id: true } })).id;
  made.customers.push(owner);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);

  /** Taslak + okunmuş fotoğraf (+ isteğe bağlı PDF); `approve` ise onaylanır. */
  const mkNote = async (suffix: string, opts: { approve: boolean; lines?: number; pdf?: boolean }) => {
    const lines = Array.from({ length: opts.lines ?? 1 }, (_, i) => ({ senderRollNo: `${TAG}-${suffix}-${i}`, meters: 100, itemText: "Kumaş" }));
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", ownerCustomerId: owner, senderDocNo: `${TAG}-${suffix}`, lines });
    const id = (r.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    const mkScan = async (content: Buffer, mimeType: string, pageNo: number) => {
      const s = await prisma.documentScan.create({
        data: { noteId: id, pageNo, sha256: createHash("sha256").update(content).digest("hex"), mimeType, sizeBytes: content.length, content: new Uint8Array(content), status: mimeType === "application/pdf" ? "READ_FAILED" : "READ", ocrResult: { ocr: { text: `${TAG} ${suffix}` } } },
        select: { id: true },
      });
      made.scans.push(s.id);
      return s.id;
    };
    const photo = await mkScan(BIG(suffix), "image/jpeg", 1);
    const pdf = opts.pdf ? await mkScan(PDF(suffix), "application/pdf", 2) : null;
    if (opts.approve) {
      const a = await call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, {});
      check(`belge ${suffix} onaylandı`, a.status === 200 && (await prisma.customerDeliveryNote.findUnique({ where: { id }, select: { status: true } }))?.status === "APPROVED", `${a.status} ${a.code ?? ""}`);
    }
    return { id, photo, pdf };
  };
  const deps = (readerUrl: string | null = reader.url) => ({ readerUrl });

  console.log("§1 varsayılan FULL");
  const s1 = await call("GET", "/api/gelen-belge/ayarlar");
  check("§1 photoRetention varsayılan FULL (bugünkü)", s1.data?.photoRetention === "FULL" && s1.data?.defaultPhotoRetention === "FULL", String(s1.data?.photoRetention));
  check("§1 anahtar dedicated (ham uç kapalı)", INCOMING_DOC_DEDICATED_SETTING_KEYS.has(SETTING_KEYS.GELEN_BELGE_PHOTO_RETENTION));
  const n1 = await mkNote("N1", { approve: true, pdf: true });
  const d1 = await call("GET", `/api/gelen-belge/irsaliyeler/${n1.id}`);
  check("§1 detay photoRetention FULL", d1.data?.photoRetention === "FULL");
  const r1 = await runPhotoRetention(50, deps());
  check("§1 FULL'da tur hiçbir şey yapmaz", r1.mode === "FULL" && r1.outcomes.length === 0 && (await scanRow(n1.photo)).contentState === "FULL");
  const bad = await call("PUT", "/api/gelen-belge/ayarlar", { photoRetention: "YOK" });
  check("§1 geçersiz kip 400", bad.status === 400 || bad.status === 403, `${bad.status}`);

  console.log("§2 ONAYDA KÜÇÜLT");
  await setSetting(SETTING_KEYS.GELEN_BELGE_PHOTO_RETENTION, "SHRINK_ON_APPROVAL");
  const draft = await mkNote("TASLAK", { approve: false });
  const before = await scanRow(n1.photo);
  reader.setMode("old");
  const r2old = await runPhotoRetention(50, deps());
  check("§2 ⭐ eski okuma servisi (404) → RETRY, fotoğraf TAM", r2old.outcomes[0] === "RETRY" && (await scanRow(n1.photo)).contentState === "FULL", r2old.outcomes.join(","));
  reader.setMode("down");
  const r2down = await runPhotoRetention(50, deps());
  check("§2 ⭐ servis kapalı (503) → RETRY, fotoğraf TAM", r2down.outcomes[0] === "RETRY" && (await scanRow(n1.photo)).contentState === "FULL");
  const r2none = await runPhotoRetention(50, deps(null));
  check("§2 servis adresi yok → RETRY, fotoğraf TAM", r2none.outcomes[0] === "RETRY" && (await scanRow(n1.photo)).contentState === "FULL");
  reader.setMode("ok");
  const hits0 = reader.hits();
  const r2 = await runPhotoRetention(50, deps());
  const after = await scanRow(n1.photo);
  check("§2 ⭐ onaylı fotoğraf KÜÇÜK", r2.outcomes.includes("REDUCED") && after.contentState === "REDUCED" && after.contentStateAt !== null, r2.outcomes.join(","));
  check("§2 ⭐ bayt küçüldü; sha256/okuma/künye duruyor", !!after.content && after.content.length === SMALL.length && after.sha256 === before.sha256 && after.sizeBytes === before.sizeBytes && JSON.stringify(after.ocrResult) === JSON.stringify(before.ocrResult) && after.noteId === n1.id);
  check("§2 ⭐ PDF dokunulmaz", (await scanRow(n1.pdf!)).contentState === "FULL");
  check("§2 ⭐ taslak dokunulmaz", (await scanRow(draft.photo)).contentState === "FULL");
  const hits1 = reader.hits();
  const r2b = await runPhotoRetention(50, deps());
  check("§2 ⭐ ikinci tur dokunmaz (tek küçültme)", r2b.outcomes.length === 0 && reader.hits() === hits1 && hits1 - hits0 === 1, `hits ${hits0}→${hits1}→${reader.hits()}`);
  const n2 = await mkNote("N2", { approve: true });
  const both = await Promise.all([applyRetention(n2.photo, "SHRINK_ON_APPROVAL", deps()), applyRetention(n2.photo, "SHRINK_ON_APPROVAL", deps())]);
  const logs2 = await prisma.systemLog.count({ where: { recordId: n2.photo, tableName: "DOCUMENT_SCAN" } });
  check("§2 ⭐ eşzamanlı iki uygulama → tek KÜÇÜK yazımı", both.filter((o) => o === "REDUCED").length === 1 && logs2 === 1, `${both.join(",")} audit=${logs2}`);
  const img2 = await call("GET", `/api/gelen-belge/taramalar/${n1.photo}/icerik`);
  check("§2 KÜÇÜK fotoğraf açılır (200, küçük bayt)", img2.status === 200 && !!img2.raw && img2.raw.equals(SMALL), `${img2.status}`);

  console.log("§3 ONAYDA SİL");
  await setSetting(SETTING_KEYS.GELEN_BELGE_PHOTO_RETENTION, "DELETE_ON_APPROVAL");
  const n3 = await mkNote("N3", { approve: true });
  const r3 = await runPhotoRetention(50, deps(null));
  const p3 = await scanRow(n3.photo);
  check("§3 ⭐ onaylı → SİLİNDİ (servis gerekmez), satır duruyor", p3.contentState === "PURGED" && p3.content === null && p3.sha256.length === 64 && p3.ocrResult !== null, r3.outcomes.join(","));
  check("§3 ⭐ geçmiş KÜÇÜK de silindi (ayar geriye dönük)", (await scanRow(n1.photo)).contentState === "PURGED");
  check("§3 PDF ve taslak dokunulmaz", (await scanRow(n1.pdf!)).contentState === "FULL" && (await scanRow(draft.photo)).contentState === "FULL");
  const g3 = await call("GET", `/api/gelen-belge/taramalar/${n3.photo}/icerik`);
  check("§3 ⭐ icerik 410 DOCUMENT_SCAN_PURGED", g3.status === 410 && g3.code === "DOCUMENT_SCAN_PURGED", `${g3.status} ${g3.code ?? ""}`);
  const w3 = await call("GET", `/api/gelen-belge/taramalar/${n3.photo}/kelimeler`);
  check("§3 ⭐ tanıtma kelimeleri 410", w3.status === 410 && w3.code === "DOCUMENT_SCAN_PURGED", `${w3.status} ${w3.code ?? ""}`);
  const o3 = await call("POST", `/api/gelen-belge/taramalar/${n3.photo}/oku`, {});
  check("§3 ⭐ yeniden okuma 410", o3.status === 410 && o3.code === "DOCUMENT_SCAN_PURGED", `${o3.status} ${o3.code ?? ""}`);
  await prisma.documentScan.update({ where: { id: n3.photo }, data: { status: "PENDING" } });
  const cl = await claimNextScan(new Date(), []);
  check("§3 okuma kuyruğu SİLİNDİ taramayı claim etmez", !(cl.kind === "CLAIMED" && cl.id === n3.photo));
  await prisma.documentScan.update({ where: { id: n3.photo }, data: { status: "READ" } });
  const d3 = await call("GET", `/api/gelen-belge/irsaliyeler/${n3.id}`);
  const sc3 = (d3.data?.scans as Array<{ id: string; contentState?: string }> | undefined)?.find((s) => s.id === n3.photo);
  check("§3 detay: photoRetention + tarama contentState PURGED", d3.data?.photoRetention === "DELETE_ON_APPROVAL" && sc3?.contentState === "PURGED");

  console.log("§4 SEVKTE SİL");
  await setSetting(SETTING_KEYS.GELEN_BELGE_PHOTO_RETENTION, "DELETE_ON_DISPATCH");
  const n4 = await mkNote("N4", { approve: true, lines: 2 });
  const rolls4 = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: n4.id, rollId: { not: null } }, select: { rollId: true } })).map((l) => l.rollId!);
  check("§4 onay iki top doğurdu", rolls4.length === 2, String(rolls4.length));
  await runPhotoRetention(50, deps(null));
  check("§4 ⭐ topu canlı belge dokunulmaz", (await scanRow(n4.photo)).contentState === "FULL");
  await prisma.roll.update({ where: { id: rolls4[0] }, data: { status: "SHIPPED" } });
  await runPhotoRetention(50, deps(null));
  check("§4 ⭐ bir top gitti, biri canlı → dokunulmaz", (await scanRow(n4.photo)).contentState === "FULL");
  await prisma.roll.update({ where: { id: rolls4[1] }, data: { status: "SHIPPED" } });
  const r4 = await runPhotoRetention(50, deps(null));
  check("§4 ⭐ bütün topları sevk edildi → SİLİNDİ", (await scanRow(n4.photo)).contentState === "PURGED", r4.outcomes.join(","));

  console.log("§5 CHECK seddi");
  const ck = async (sql: string): Promise<boolean> => prisma.$executeRawUnsafe(sql).then(() => false, () => true);
  check("§5 ⭐ SİLİNDİ + bayt dolu reddedilir", await ck(`UPDATE document_scans SET "contentState"='PURGED', "contentStateAt"=now() WHERE id='${draft.photo}'`)); // tz-ok: test
  check("§5 ⭐ TAM + bayt boş reddedilir", await ck(`UPDATE document_scans SET content=NULL WHERE id='${draft.photo}'`));
  check("§5 KÜÇÜK'te bayt > yüklenen boy reddedilir", await ck(`UPDATE document_scans SET "contentState"='REDUCED', "contentStateAt"=now(), content=content||content WHERE id='${draft.photo}'`)); // tz-ok: test
  check("§5 sonda geçerli: taslak hâlâ TAM", (await scanRow(draft.photo)).contentState === "FULL");

  console.log("§6 audit yalnız künye");
  const logs = await prisma.systemLog.findMany({ where: { tableName: "DOCUMENT_SCAN", recordId: { in: [n1.photo, n2.photo, n3.photo, n4.photo] } }, select: { oldData: true, newData: true } });
  const blob = JSON.stringify(logs);
  check("§6 ⭐ audit satırları var ve bayt/base64 taşımıyor", logs.length >= 4 && !blob.includes(BIG("N1").toString("base64").slice(8, 40)) && !blob.includes(SMALL.toString("base64")) && !/"content"/.test(blob), `n=${logs.length} len=${blob.length}`);

  console.log("§7 İE geldiği belge");
  const station = (await prisma.station.create({ data: { code: `${TAG}-K`.slice(0, 32), name: `${TAG} K`, type: "INTERNAL", kind: "PROCESS_QC", appliesQuality: true }, select: { id: true } })).id;
  made.stations.push(station);
  const route = (await prisma.route.create({ data: { name: `${TAG} rota`, steps: { create: [{ stationId: station, sequence: 1 }] } }, select: { id: true } })).id;
  made.routes.push(route);
  const n7 = await mkNote("N7", { approve: false });
  const wo = await call("POST", `/api/gelen-belge/irsaliyeler/${n7.id}/is-emri`, { clientToken: randomUUID(), ownerCustomerId: owner, ourBatchNo: `${TAG}-P7`, kursunMeters: "100", routeTemplateId: route, stepPlanning: [{ sequence: 1 }] });
  const woId = (wo.data as { workOrderId?: string } | undefined)?.workOrderId ?? "";
  if (woId) made.workOrders.push(woId);
  check("§7 belgeden İE", wo.status === 201 && !!woId, `${wo.status} ${wo.code ?? ""}`);
  const b7 = await call("GET", `/api/gelen-belge/is-emirleri/${woId}/belgeler`);
  const notes7 = (b7.data?.notes as Array<{ id: string; noteNo: string; scans: Array<{ id: string; contentState: string }> }> | undefined) ?? [];
  check("§7 ⭐ İE → geldiği belge + tarama durumu", b7.status === 200 && notes7.length === 1 && notes7[0]!.id === n7.id && notes7[0]!.scans.some((s) => s.id === n7.photo && s.contentState === "FULL"), `${b7.status} ${JSON.stringify(b7.data).slice(0, 200)}`);
  const b7x = await call("GET", `/api/gelen-belge/is-emirleri/${randomUUID()}/belgeler`);
  check("§7 bilinmeyen İE 404", b7x.status === 404, `${b7x.status}`);
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = [...new Set([...made.workOrders, ...(await prisma.workOrder.findMany({ where: { routeTemplateId: { in: made.routes } }, select: { id: true } })).map((w) => w.id)])];
  await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } }).catch(swallow);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "rollVariance", "warehouseMovement"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(swallow);
  }
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { currentStepId: null, batchId: null } }).catch(swallow);
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(swallow);
  for (const id of wos) {
    await prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderEvent.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: id } } }).catch(swallow);
    await prisma.travelerCard.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.batch.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrder.deleteMany({ where: { id } }).catch(swallow);
  }
  await prisma.route.deleteMany({ where: { id: { in: made.routes } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers] } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge fotoğraf saklama (K28) bekçisi ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const reader = await startFakeReader();
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, reader);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    server.close();
    reader.server.close();
    stopNotificationJobs();
    for (const k of SETTINGS) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
else void prisma.$disconnect();
