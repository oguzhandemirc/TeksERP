// =============================================================================
// GELEN BELGE — GÜLKESİM SABAH SENARYOSU kabul bekçisi (uçtan uca, sunucu tarafı)
// =============================================================================
// HTTP + gerçek DB + gerçek motor + sahte okuma servisi. Tabletin sabah akışı adım adım, tablet uçlarıyla:
//   §1 ⭐ bilinmeyen form tipi: boş taslak + cihaz okuması (`clientOcr`, ML Kit biçimi) → okuma özeti `tanitim` TANITILMAMIS
//   §2 ⭐ tanıt: `POST /sablonlar/oneri` (müşteri · parti no · kurşun metresi · evrak no kutuları) → `POST /sablonlar/ozel` (u-…)
//   §3 ⭐ `tanitimGuveni=SORMA` + aynı tipte YENİ belge → TANITILDI; müşteri kesin (OWNER_TEXT), parti no, metre, evrak no dolu
//   §4 ⭐ `formApproval=WITH_WORK_ORDER`: `POST /irsaliyeler/:id/is-emri` (rota Kurşun → Tambur, kurşun adımında gramaj
//      hedefi) → iş emri + top; top metresi = kurşun metresi, gramaj hedefi İE'de
//   §5 ⭐ `stationDocLookup` açık: Kurşun operatörü aynı kâğıdın YENİ fotoğrafını okutur (`POST /istasyon-okutma`, okuma
//      servisi) → evrak no ile TEK İE; evrak no kutusu boş kâğıtta parti no yedeğiyle aynı TEK İE
//   §6 ⭐ `GET /kursun-qc/by-card/:kart` → targetValues = İE'nin gramajı (40 gr), değer/istasyon varsayılanı (25 gr) değil
// Sonraki adımların (hata işaretleme, tambur kesim) kimlikleri `ctx`te tutulur.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import type { AddressInfo } from "net";
import http, { type Server } from "node:http";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { setReaderUrlForTests } from "../src/lib/gelen-belge/url";
import type { ClientOcr } from "../src/lib/gelen-belge/istemci-ocr";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { atlamaDefteri } from "./lib/atlama";

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
const atlama = atlamaDefteri(() => { fail++; });
/** Ürün kopukluğu (büyük; bu bekçide düzeltilmez): ortak atlama defterine yazılır, raporlanır. */
function kopuk(label: string, reason: string): void {
  atlama.atla(label, `KOPUK: ${reason}`);
}

const TAG = `TEST-GSS${Date.now().toString(36).toUpperCase()}`;
const D = String(Date.now()).slice(-6);
const KEYWORD = `${TAG} IS TAKIP FORMU`;
const OWNER_NAME = `${TAG} AKDENIZ PERDE`;

/** Sahte formun alanları (okuma servisi / cihaz okuması bunu çizer). Verilmeyen satır formda yoktur. */
type Spec = { musteri?: string; parti?: string; evrak?: string; metre?: string };
/** Form: başlık + etiket/değer satırları (değer etiketin sağında, aynı yükseklikte). */
function ocrOf(spec: Spec): OcrLike {
  const rows: Array<[string, string | undefined]> = [[KEYWORD, undefined], ["MUSTERI", spec.musteri], ["PARTI NO", spec.parti], ["EVRAK NO", spec.evrak], ["TOPLAM METRE", spec.metre]];
  const el = (text: string, x: number, y: number) => ({ text, rect: { x, y, width: text.length * 18, height: 30 }, confidence: 0.95 });
  const blocks = rows.filter(([, v], i) => i === 0 || v !== undefined).map(([label, value], i) => {
    const y = 50 + i * 80;
    const lines = [{ text: label, rect: { x: 40, y, width: label.length * 18, height: 30 }, confidence: 0.95, angle: 0, elements: label.split(" ").map((t, j) => el(t, 40 + j * 120, y)) }];
    if (value) lines.push({ text: value, rect: { x: 300, y, width: value.length * 18, height: 30 }, confidence: 0.95, angle: 0, elements: [el(value, 300, y)] });
    return { text: lines.map((l) => l.text).join("\n"), rect: { x: 40, y, width: 800, height: 30 }, lines };
  });
  return { text: blocks.map((b) => b.text).join("\n"), blocks, imageWidth: 1000, imageHeight: 1400 };
}
type Rect = { x: number; y: number; width: number; height: number };
type OcrLike = { text: string; blocks: Array<{ text: string; rect: Rect; lines: Array<{ text: string; rect: Rect; confidence: number; elements: Array<{ text: string; rect: Rect; confidence: number }> }> }>; imageWidth: number; imageHeight: number };
type Quad = [number, number][];
const quad = (r: Rect): Quad => [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]];
/** Tabletin ML Kit okuması (`clientOcr`): kelime dörtgeni + satır dörtgeni (satır = formdaki etiket/değer satırı). */
function clientOcrOf(spec: Spec): ClientOcr {
  const r = ocrOf(spec);
  const lines = r.blocks.flatMap((b) => b.lines);
  return {
    engine: "mlkit", width: r.imageWidth, height: r.imageHeight, rotation: 0, ms: 50,
    words: lines.flatMap((l, i) => l.elements.map((e) => ({ t: e.text, c: quad(e.rect), l: i, p: e.confidence }))),
    lines: lines.map((l) => ({ c: quad(l.rect), p: l.confidence })),
  };
}
/** Fotoğraf baytı: JPEG başı + benzersiz gövde + spec (sahte okuma servisi spec'ten formu çizer). */
const photo = (spec: Spec) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${TAG} ${randomUUID()} SPEC:${Buffer.from(JSON.stringify(spec)).toString("base64url")}:END`)]);

function startFakeSidecar(): Promise<{ server: Server; url: string }> {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/ocr")) { res.writeHead(404); res.end(); return; }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { imageBase64: string };
      const m = /SPEC:([A-Za-z0-9_-]+):END/.exec(Buffer.from(body.imageBase64, "base64").toString("utf8"));
      if (!m) { res.writeHead(400); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json", "x-okuma-version": "0.0-test" });
      res.end(JSON.stringify(ocrOf(JSON.parse(Buffer.from(m[1]!, "base64url").toString("utf8")) as Spec)));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

const made = {
  customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], stations: [] as string[], routes: [] as string[],
  shas: [] as string[], workOrders: [] as string[], templates: [] as string[], props: [] as string[],
};
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
  SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP, SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME,
  SETTING_KEYS.GELEN_BELGE_AUTO_SENDER,
];

type Resp = { status: number; code?: string; data?: Record<string, unknown> };
type Call = (method: string, path: string, token: string, body?: unknown) => Promise<Resp>;

/** Adımlar arası paylaşılan kimlikler (sonraki dilimler: istasyon okutma, kurşun gramajı, hata, tambur). */
const ctx = {
  url: "", sidecarUrl: "", call: null as unknown as Call,
  admin: { id: "", token: "" },
  users: { wo: "", kursun: "", tambur: "" } as Record<string, string>,
  ownerId: "", fabricItemId: "",
  kursunPropId: "", gramajPropId: "", gramaj: { g25: "", g40: "" },
  kursunStationId: "", tamburStationId: "", routeId: "",
  templateCode: "",
  /** §1 bilinmeyen belge + §3 tanınan belge (İE bu belgeden). */
  unknownNoteId: "", unknownScanId: "", noteId: "", scanId: "",
  /** §3 belgenin formu: istasyonda aynı form yeniden okutulur (`photo(spec)` her çağrıda farklı bayt). */
  spec: {} as Spec,
  batchNo: "", docNo: "", kursunMeters: "",
  workOrderId: "", workOrderNo: "", rollId: "", rollBarcode: "", cardBarcode: "",
};

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function setup(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [
    SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE,
    SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, SETTING_KEYS.GELEN_BELGE_AUTO_SENDER, SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP,
    SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE,
  ]) await setSetting(k, null);
  const login = async (username: string, password: string, clientType?: "electron") => {
    const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, ...(clientType ? { clientType } : {}) }) });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  ctx.url = url;
  ctx.call = async (method, path, token, body) => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
    return { status: r.status, code: j.details?.code, data: j.data };
  };
  ctx.admin = { id: admin.id, token: await login(admin.username, admin.password, "electron") };
  check("admin login", ctx.admin.token.length > 0);
  const parola = kosumaOzguParola();
  const mkUser = async (suffix: string, perms: string[]) => {
    const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
    const u = await prisma.user.create({
      data: { username: `${TAG}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
      select: { id: true, username: true },
    });
    made.users.push(u.id);
    return login(u.username, parola);
  };
  // Tablet kullanıcıları: belge girişçisi (İE formu), kurşun operatörü, tambur operatörü.
  ctx.users.wo = await mkUser("W", ["gelen-belge:read", "gelen-belge:write", "mobile:hizli-is-emri"]);
  ctx.users.kursun = await mkUser("K", ["mobile:kk2-kursun"]);
  ctx.users.tambur = await mkUser("T", ["mobile:tambur"]);
  check("tablet kullanıcıları login", !!ctx.users.wo && !!ctx.users.kursun && !!ctx.users.tambur);

  ctx.ownerId = (await prisma.customer.create({ data: { code: `${TAG}-O`.slice(0, 32), name: OWNER_NAME }, select: { id: true } })).id;
  made.customers.push(ctx.ownerId);
  ctx.fabricItemId = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(ctx.fabricItemId);

  // Kurşun yeteneği seed'in; gramaj = KURSUN'un CHOICE varyantı (iki değer: 25 gr / 40 gr — İE hedefi 40 gr).
  const kprop = await prisma.fabricProperty.findFirst({ where: { code: "KURSUN" }, select: { id: true } });
  if (!kprop) throw new Error("Fikstür eksik: KURSUN özelliği (npm run seed)");
  ctx.kursunPropId = kprop.id;
  const gramaj = await prisma.fabricProperty.create({
    data: {
      code: `${TAG}-KG`.slice(0, 32), name: `TEST Kursun gramaji ${TAG}`, valueType: "CHOICE", variantOfPropertyId: kprop.id,
      values: { create: [{ code: `${TAG}G25`.slice(0, 32), name: "25 gr", sortOrder: 0 }, { code: `${TAG}G40`.slice(0, 32), name: "40 gr", sortOrder: 1 }] },
    },
    select: { id: true, values: { select: { id: true, sortOrder: true } } },
  });
  made.props.push(gramaj.id);
  ctx.gramajPropId = gramaj.id;
  ctx.gramaj = { g25: gramaj.values.find((v) => v.sortOrder === 0)!.id, g40: gramaj.values.find((v) => v.sortOrder === 1)!.id };
  const mkStation = async (suffix: string, kind: "PROCESS_QC" | "TAMBUR", extra: { appliesQuality?: boolean } = {}) => {
    const id = (await prisma.station.create({ data: { code: `${TAG}-${suffix}`.slice(0, 32), name: `${TAG} ${suffix}`, type: "INTERNAL", kind, ...extra }, select: { id: true } })).id;
    made.stations.push(id);
    return id;
  };
  ctx.kursunStationId = await mkStation("KRS", "PROCESS_QC", { appliesQuality: true });
  await prisma.stationProperty.create({ data: { stationId: ctx.kursunStationId, propertyId: kprop.id, mode: "AUTO" } });
  await prisma.stationProperty.create({ data: { stationId: ctx.kursunStationId, propertyId: gramaj.id, mode: "OPTIONAL" } });
  ctx.tamburStationId = await mkStation("TMB", "TAMBUR");
  ctx.routeId = (await prisma.route.create({ data: { name: `${TAG} Kurşun → Tambur`, isWorkOrderShortcut: true, steps: { create: [{ stationId: ctx.kursunStationId, sequence: 1 }, { stationId: ctx.tamburStationId, sequence: 2 }] } }, select: { id: true } })).id;
  made.routes.push(ctx.routeId);
}

/** Tablet: boş taslak + fotoğraf (cihazda okunmuş) → taslak dolar. */
async function scanNewDocument(spec: Spec, label: string): Promise<{ noteId: string; scanId: string }> {
  const n = await ctx.call("POST", "/api/gelen-belge/irsaliyeler", ctx.users.wo, { sourceKind: "MANUAL" });
  const noteId = String(n.data?.id ?? "");
  if (noteId) made.notes.push(noteId);
  const buf = photo(spec);
  const sha = createHash("sha256").update(buf).digest("hex");
  made.shas.push(sha);
  const up = await ctx.call("POST", "/api/gelen-belge/taramalar", ctx.users.wo, { contentBase64: buf.toString("base64"), sha256: sha, noteId, pageNo: 1, clientOcr: clientOcrOf(spec) });
  const scan = up.data?.scan as { id?: string; status?: string } | undefined;
  check(`${label}: taslak + cihaz okumalı tarama (201, READ)`, n.status === 201 && !!noteId && up.status === 201 && up.data?.deviceOcr === "READ" && scan?.status === "READ",
    `${n.status} ${n.code ?? ""} · ${up.status} ${up.code ?? ""} ${String(up.data?.deviceOcr)} ${scan?.status}`);
  return { noteId, scanId: scan?.id ?? "" };
}

type Summary = {
  tanitim?: { durum: string; sablonKodu?: string; sablonAdi?: string };
  ownerSuggestion?: { customerId?: string; source?: string } | null;
  batchNoCandidates?: Array<{ kind: string; value: string }>;
  ourBatchNo?: string | null; kursunMeters?: string | number | null; kursunMetersSource?: string | null; kursunMetersReview?: boolean;
  state?: string;
};
const summaryOf = async (noteId: string, token = ctx.users.wo): Promise<{ status: number; s: Summary }> => {
  const r = await ctx.call("GET", `/api/gelen-belge/irsaliyeler/${noteId}/okuma-ozeti`, token);
  return { status: r.status, s: (r.data ?? {}) as Summary };
};
const brief = (s: Summary) => JSON.stringify({ st: s.state, t: s.tanitim, o: s.ownerSuggestion, b: s.batchNoCandidates?.map((c) => `${c.kind}:${c.value}`), p: s.ourBatchNo, m: s.kursunMeters, ms: s.kursunMetersSource, r: s.kursunMetersReview });

async function step1(): Promise<void> {
  console.log("§1 bilinmeyen form tipi");
  const spec1: Spec = { musteri: OWNER_NAME, parti: `PA${D}`, evrak: `81${D}`, metre: "1850" };
  const { noteId, scanId } = await scanNewDocument(spec1, "§1");
  ctx.unknownNoteId = noteId;
  ctx.unknownScanId = scanId;
  const regions = ((await prisma.documentScan.findUnique({ where: { id: scanId }, select: { ocrResult: true } }))?.ocrResult as { regions?: Array<{ templateId?: string | null }> } | null)?.regions ?? [];
  check("§1 motor kullanıcı şablonu bulamadı (bölge `genel`)", regions.length > 0 && regions.every((r) => r.templateId === "genel" || r.templateId === null), JSON.stringify(regions.map((r) => r.templateId)));
  const { status, s } = await summaryOf(noteId);
  check("§1 ⭐ okuma özeti: tanitim TANITILMAMIS (tablet 'Bu belge tipini tanıt' önerir)", status === 200 && s.tanitim?.durum === "TANITILMAMIS", `${status} ${brief(s)}`);
}

async function step2(): Promise<void> {
  console.log("§2 belge tipini tanıt");
  const env = (await prisma.documentScan.findUnique({ where: { id: ctx.unknownScanId }, select: { ocrResult: true } }))?.ocrResult as { ocr?: OcrLike } | null;
  const lines = env?.ocr?.blocks.flatMap((b) => b.lines) ?? [];
  const rectOf = (t: string) => lines.find((l) => l.text === t)?.rect;
  const assignments = ([["musteri", OWNER_NAME], ["partiNo", `PA${D}`], ["toplamMetre", "1850"], ["evrakNo", `81${D}`]] as const).map(([field, text]) => ({ field, rect: rectOf(text) }));
  check("§2 saklı okumada dört değer kutusu bulundu", assignments.every((a) => !!a.rect), JSON.stringify(assignments.filter((a) => !a.rect).map((a) => a.field)));
  const name = `${TAG} iş takip formu`;
  const p = await ctx.call("POST", "/api/gelen-belge/sablonlar/oneri", ctx.admin.token, { scanId: ctx.unknownScanId, name, identifiers: [KEYWORD, "PARTI NO", "TOPLAM METRE"], assignments });
  const tpl = p.data?.template as { fields?: Array<{ key: string }>; meterSources?: unknown; batchNoCandidates?: unknown } | undefined;
  check("§2 ⭐ öneri: hatasız, dört alan şablonda (musteri · partiNo · toplamMetre · evrakNo) + metre kaynağı",
    p.status === 200 && (p.data?.errors as unknown[] | undefined)?.length === 0 && ["musteri", "partiNo", "toplamMetre", "evrakNo"].every((k) => tpl?.fields?.some((f) => f.key === k)) && !!tpl?.meterSources,
    `${p.status} ${p.code ?? ""} ${JSON.stringify(p.data?.errors)} ${JSON.stringify(tpl?.fields?.map((f) => f.key))}`);
  const c = await ctx.call("POST", "/api/gelen-belge/sablonlar/ozel", ctx.admin.token, { name, template: tpl, clientToken: randomUUID() });
  ctx.templateCode = String(c.data?.code ?? "");
  const row = ctx.templateCode ? await prisma.senderTemplate.findUnique({ where: { code: ctx.templateCode }, select: { id: true } }) : null;
  if (row) made.templates.push(row.id);
  check("§2 ⭐ kullanıcı şablonu kaydı 201, kod u-…", c.status === 201 && ctx.templateCode.startsWith("u-") && !!row, `${c.status} ${c.code ?? ""} ${ctx.templateCode}`);
}

async function step3(): Promise<void> {
  console.log("§3 SORMA + aynı tipte yeni belge");
  await setSetting(SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, "SORMA");
  ctx.batchNo = `PB${D}`;
  ctx.docNo = `82${D}`;
  ctx.spec = { musteri: OWNER_NAME, parti: ctx.batchNo, evrak: ctx.docNo, metre: "2475" };
  const { noteId, scanId } = await scanNewDocument(ctx.spec, "§3");
  ctx.noteId = noteId;
  ctx.scanId = scanId;
  const { status, s } = await summaryOf(noteId);
  check("§3 ⭐ tanitim TANITILDI + bu şablon", status === 200 && s.tanitim?.durum === "TANITILDI" && s.tanitim.sablonKodu === ctx.templateCode, `${status} ${brief(s)}`);
  check("§3 ⭐ müşteri kesin: OWNER_TEXT + doğru cari", s.ownerSuggestion?.source === "OWNER_TEXT" && s.ownerSuggestion.customerId === ctx.ownerId, brief(s));
  check("§3 ⭐ parti no tek aday (BATCH) ve kolona yazıldı", s.ourBatchNo === ctx.batchNo && (s.batchNoCandidates ?? []).length === 1 && s.batchNoCandidates![0]!.kind === "BATCH" && s.batchNoCandidates![0]!.value === ctx.batchNo, brief(s));
  check("§3 ⭐ kurşun metresi 2475 (toplam alanından), doğrulama beklemez", Number(s.kursunMeters) === 2475 && s.kursunMetersSource === "TOTAL" && s.kursunMetersReview === false, brief(s));
  const det = await ctx.call("GET", `/api/gelen-belge/irsaliyeler/${noteId}`, ctx.admin.token);
  check("§3 ⭐ evrak no taslağa yazıldı (senderDocNo)", det.status === 200 && det.data?.senderDocNo === ctx.docNo, `${det.status} ${String(det.data?.senderDocNo)}`);
  ctx.kursunMeters = s.kursunMeters === null || s.kursunMeters === undefined ? "" : String(s.kursunMeters);
}

async function step4(): Promise<void> {
  console.log("§4 formdan iş emri (Kurşun → Tambur, gramaj hedefi)");
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");
  await setSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, "DOCUMENT");
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, ctx.fabricItemId);
  // Tablet formu okuma özetinden kurulur: sahip önerisi + parti no + kurşun metresi (§3'te ölçüldü).
  const { s } = await summaryOf(ctx.noteId);
  const body = {
    clientToken: randomUUID(), ownerCustomerId: s.ownerSuggestion?.customerId ?? ctx.ownerId, ourBatchNo: s.ourBatchNo ?? undefined, kursunMeters: ctx.kursunMeters || "0",
    routeTemplateId: ctx.routeId, targetValues: [{ propertyId: ctx.gramajPropId, valueId: ctx.gramaj.g40 }], stepPlanning: [{ sequence: 1 }, { sequence: 2 }],
  };
  const r = await ctx.call("POST", `/api/gelen-belge/irsaliyeler/${ctx.noteId}/is-emri`, ctx.users.wo, body);
  const d = r.data as { workOrderId?: string; workOrderNo?: string; rollId?: string; batchNumber?: string } | undefined;
  if (d?.workOrderId) made.workOrders.push(d.workOrderId);
  ctx.workOrderId = d?.workOrderId ?? "";
  ctx.workOrderNo = d?.workOrderNo ?? "";
  ctx.rollId = d?.rollId ?? "";
  check("§4 ⭐ 201: iş emri + top", r.status === 201 && !!ctx.workOrderId && !!ctx.rollId, `${r.status} ${r.code ?? ""} ${JSON.stringify(r.data)?.slice(0, 300)}`);
  const note = await prisma.customerDeliveryNote.findUnique({ where: { id: ctx.noteId }, select: { status: true, ownerCustomerId: true } });
  check("§4 belge APPROVED, sahibi okunan müşteri", note?.status === "APPROVED" && note.ownerCustomerId === ctx.ownerId, JSON.stringify(note));
  const roll = ctx.rollId ? await prisma.roll.findUnique({ where: { id: ctx.rollId }, select: { currentQty: true, ownerCustomerId: true, barcode: true, currentStep: { select: { stepSequence: true, stationId: true } } } }) : null;
  ctx.rollBarcode = roll?.barcode ?? "";
  check("§4 ⭐ top metresi = kurşun metresi (2475), sahipli", !!roll && Number(roll.currentQty) === 2475 && roll.ownerCustomerId === ctx.ownerId, JSON.stringify(roll));
  check("§4 top ilk adımda: Kurşun istasyonu", roll?.currentStep?.stepSequence === 1 && roll.currentStep.stationId === ctx.kursunStationId, JSON.stringify(roll?.currentStep));
  const wo = ctx.workOrderId ? await prisma.workOrder.findUnique({
    where: { id: ctx.workOrderId },
    select: {
      workOrderNumber: true, routeTemplateId: true, targetValues: { select: { propertyId: true, valueId: true } },
      steps: { orderBy: { stepSequence: "asc" }, select: { stepSequence: true, stationId: true } },
      batches: { select: { batchNumber: true, rolls: { select: { id: true } } } },
    },
  }) : null;
  check("§4 ⭐ rota Kurşun → Tambur (iki adım, sırayla)", wo?.routeTemplateId === ctx.routeId && JSON.stringify(wo.steps.map((x) => x.stationId)) === JSON.stringify([ctx.kursunStationId, ctx.tamburStationId]), JSON.stringify(wo?.steps));
  check("§4 ⭐ gramaj hedefi İE'de: 40 gr", !!wo?.targetValues.some((t) => t.propertyId === ctx.gramajPropId && t.valueId === ctx.gramaj.g40), JSON.stringify(wo?.targetValues));
  check("§4 ⭐ parti no belgeden + top partide", d?.batchNumber === ctx.batchNo && !!wo?.batches.some((b) => b.batchNumber === ctx.batchNo && b.rolls.some((x) => x.id === ctx.rollId)), `${d?.batchNumber} ${JSON.stringify(wo?.batches)}`);
  const card = ctx.workOrderId ? await prisma.travelerCard.findFirst({ where: { workOrderId: ctx.workOrderId }, select: { barcode: true, status: true } }) : null;
  ctx.cardBarcode = card?.barcode ?? "";
  check("§4 refakat kartı açık (istasyonda okutulacak)", !!card && card.status === "ACTIVE", JSON.stringify(card));
}

type Lookup = {
  outcome?: string; source?: string; message?: string;
  read?: { senderDocNo: string | null } | null;
  notes?: Array<{ id: string }>;
  workOrders?: Array<{ id: string; workOrderNumber: string; cardBarcode: string; batchNumbers: string[] }>;
};
const lookupBrief = (d: Lookup) => JSON.stringify({ o: d.outcome, s: d.source, r: d.read?.senderDocNo, n: d.notes?.map((x) => x.id.slice(0, 8)), w: d.workOrders?.map((w) => `${w.workOrderNumber}:${w.batchNumbers.join("+")}`), m: d.message });

async function step5(): Promise<void> {
  console.log("§5 istasyonda aynı kâğıdı okut (Kurşun/KK operatörü)");
  const lookup = async (spec: Spec) => {
    const r = await ctx.call("POST", "/api/gelen-belge/istasyon-okutma", ctx.users.kursun, { contentBase64: photo(spec).toString("base64") });
    return { status: r.status, code: r.code, d: (r.data ?? {}) as Lookup };
  };
  // Ayar kapalıyken fail-closed: tablet düğmeyi göstermez, uç 403.
  const off = await lookup(ctx.spec);
  check("§5 ayar kapalı → 403 GELEN_BELGE_STATION_LOOKUP_DISABLED", off.status === 403 && off.code === "GELEN_BELGE_STATION_LOOKUP_DISABLED", `${off.status} ${off.code ?? ""}`);
  await setSetting(SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP, true);
  setReaderUrlForTests(ctx.sidecarUrl);
  const st = await ctx.call("GET", "/api/gelen-belge/istasyon-okutma", ctx.users.kursun);
  check("§5 istasyon okutma açık (ayar + üretim) ve okuma servisi tanımlı", st.status === 200 && st.data?.enabled === true && st.data?.readerConfigured === true, `${st.status} ${JSON.stringify(st.data)}`);

  // (a) Aynı kâğıdın YENİ fotoğrafı (farklı bayt → aynı-fotoğraf kısayolu yok) → okuma servisi → kullanıcı şablonu → evrak no.
  const a = await lookup(ctx.spec);
  const wa = a.d.workOrders ?? [];
  check("§5 ⭐ yeni tarama → TEK iş emri (§4'teki)", a.status === 200 && a.d.outcome === "SINGLE" && a.d.source === "OCR" && wa.length === 1 && wa[0]!.id === ctx.workOrderId,
    `${a.status} ${a.code ?? ""} ${lookupBrief(a.d)}`);
  check("§5 ⭐ evrak no yolu: okunan evrak no = belgeninki, eşleşen belge §3 taslağı", a.d.read?.senderDocNo === ctx.docNo && a.d.notes?.length === 1 && a.d.notes[0]!.id === ctx.noteId, lookupBrief(a.d));
  check("§5 tablete verilen kart barkodu = İE'nin açık refakat kartı", !!wa[0] && wa[0].cardBarcode === ctx.cardBarcode, `${wa[0]?.cardBarcode} ≠? ${ctx.cardBarcode}`);

  // (b) Evrak no kutusu boş kâğıt (şablon evrak no'yu okuyamaz) → parti no yedeği → aynı iş emri.
  const b = await lookup({ ...ctx.spec, evrak: "" });
  const wb = b.d.workOrders ?? [];
  check("§5 ⭐ evrak no'suz okuma → parti no yedeği → aynı TEK iş emri",
    b.status === 200 && b.d.outcome === "SINGLE" && b.d.source === "OCR" && !b.d.read?.senderDocNo && (b.d.notes ?? []).length === 0 && wb.length === 1 && wb[0]!.id === ctx.workOrderId && wb[0]!.batchNumbers.includes(ctx.batchNo),
    `${b.status} ${b.code ?? ""} ${lookupBrief(b.d)}`);
}

async function step6(): Promise<void> {
  console.log("§6 kurşun istasyonu: kart → gramaj hedefi (İE'nin, varsayılan değil)");
  // Varsayılanlar 25 gr'ı gösterir (değerin isDefault'u + istasyon yeteneğinin ön seçimi); İE hedefi 40 gr.
  await prisma.fabricPropertyValue.update({ where: { id: ctx.gramaj.g25 }, data: { isDefault: true } });
  await prisma.stationProperty.update({ where: { stationId_propertyId: { stationId: ctx.kursunStationId, propertyId: ctx.gramajPropId } }, data: { defaultOn: true, defaultValueId: ctx.gramaj.g25 } });
  const codes = new Map((await prisma.fabricPropertyValue.findMany({ where: { id: { in: [ctx.gramaj.g25, ctx.gramaj.g40] } }, select: { id: true, code: true } })).map((v) => [v.id, v.code]));
  const r = await ctx.call("GET", `/api/kursun-qc/by-card/${encodeURIComponent(ctx.cardBarcode)}`, ctx.users.kursun);
  const d = (r.data ?? {}) as {
    stationId?: string; workOrderId?: string;
    targetValues?: Array<{ propertyId: string; valueId: string; valueCode: string }>;
    properties?: Array<{ propertyId: string; mode: string; values: Array<{ code: string; isDefault: boolean }> }>;
    rolls?: Array<{ rollId: string; currentQty: number }>;
  };
  check("§6 kart okundu: Kurşun istasyonu adımı, bu İE, top 2475 m listede",
    r.status === 200 && d.stationId === ctx.kursunStationId && d.workOrderId === ctx.workOrderId && !!d.rolls?.some((x) => x.rollId === ctx.rollId && x.currentQty === 2475),
    `${r.status} ${r.code ?? ""} ${d.stationId === ctx.kursunStationId} ${d.workOrderId === ctx.workOrderId} ${JSON.stringify(d.rolls?.map((x) => [x.rollId === ctx.rollId, x.currentQty]))}`);
  const tv = (d.targetValues ?? []).filter((t) => t.propertyId === ctx.gramajPropId);
  check("§6 ⭐ stepSummary.targetValues: gramaj hedefi İE'nin 40 gr'ı (değer + kod)",
    tv.length === 1 && tv[0]!.valueId === ctx.gramaj.g40 && tv[0]!.valueCode === codes.get(ctx.gramaj.g40), JSON.stringify(d.targetValues));
  const gp = d.properties?.find((p) => p.propertyId === ctx.gramajPropId);
  const defaults = gp?.values.filter((v) => v.isDefault).map((v) => v.code) ?? [];
  check("§6 ⭐ varsayılan (25 gr) ayrı taşınır, hedef ondan farklı (tablet varsayılanı değil hedefi vurgular)",
    !!gp && defaults.length === 1 && defaults[0] === codes.get(ctx.gramaj.g25) && tv[0]?.valueCode !== defaults[0] && gp.values.some((v) => v.code === codes.get(ctx.gramaj.g40)),
    JSON.stringify(gp));
}

async function run(url: string, sidecar: { url: string }): Promise<void> {
  ctx.sidecarUrl = sidecar.url;
  await setup(url);
  await step1();
  await step2();
  await step3();
  await step4();
  await step5();
  await step6();
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const scans = await prisma.documentScan.findMany({ where: { OR: [{ noteId: { in: made.notes } }, { sha256: { in: made.shas } }] }, select: { id: true, noteId: true } });
  const notes = [...new Set([...made.notes, ...scans.map((s) => s.noteId).filter((x): x is string => !!x)])];
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = [...new Set([...made.workOrders, ...(await prisma.workOrder.findMany({ where: { routeTemplateId: { in: made.routes } }, select: { id: true } })).map((w) => w.id)])];
  const woRolls = (await prisma.roll.findMany({ where: { batch: { workOrderId: { in: wos } } }, select: { id: true } })).map((r) => r.id);
  const rolls = [...new Set([...rollIds, ...woRolls])];
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: { in: notes } }, data: { scanId: null } }).catch(swallow);
  await prisma.documentScan.deleteMany({ where: { id: { in: scans.map((s) => s.id) } } }).catch(swallow);
  await prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: notes } } }).catch(swallow);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: notes } } });
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "rollVariance", "warehouseMovement"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rolls } } }).catch(swallow);
  }
  await prisma.roll.updateMany({ where: { id: { in: rolls } }, data: { currentStepId: null, batchId: null } }).catch(swallow);
  await prisma.roll.deleteMany({ where: { id: { in: rolls } } }).catch(swallow);
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
  await prisma.senderTemplateVersion.deleteMany({ where: { templateId: { in: made.templates } } }).catch(swallow);
  await prisma.senderTemplate.deleteMany({ where: { id: { in: made.templates } } }).catch(swallow);
  await prisma.route.deleteMany({ where: { id: { in: made.routes } } }).catch(swallow);
  await prisma.stationProperty.deleteMany({ where: { stationId: { in: made.stations } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  const valueIds = (await prisma.fabricPropertyValue.findMany({ where: { propertyId: { in: made.props } }, select: { id: true } })).map((v) => v.id);
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers, ...valueIds] } } }).catch(swallow);
  await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: made.props } } }).catch(swallow);
  await prisma.fabricProperty.deleteMany({ where: { id: { in: made.props } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.systemLog.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge — Gülkesim sabah senaryosu kabul bekçisi ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const sidecar = await startFakeSidecar();
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, sidecar);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    setReaderUrlForTests(null);
    server.close();
    sidecar.server.close();
    stopNotificationJobs();
    for (const k of SETTINGS) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${atlama.ozetEki()} === (test verisi temizlendi${atlama.sayi > 0 ? "; atlananlar KOPUK, nedenleri yukarıda" : ""})`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
else void prisma.$disconnect();
