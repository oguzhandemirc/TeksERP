// =============================================================================
// GELEN BELGE — çok partili belge → iş emri + kullanıcı şablonu (S1, Gülkesim 2026-11-03; fabrika cevabı 16/17/18/36/38)
// =============================================================================
// HTTP + gerçek DB. Uçlar: `GET /irsaliyeler/:id/partiler`, `POST /irsaliyeler/:id/is-emri` (`parties[]` + `mode`),
// `/sablonlar/ozel[/:code]`, `/sablonlar/oneri`, `/taramalar/:id/kelimeler`. Sınanan:
//   §1 ayar `gelenBelge.multiPartyWorkOrder` varsayılanı SINGLE (bugünkü tek İE), ham uca kapalı
//   §2 ⭐ parti özeti: 2 parti (parti no, satır, metre) + canlı "4 TOP ↔ 3 satır" + eksik sayfa uyarısı; satır eklenince sayım uyarısı düşer
//   §3 ⭐ mode verilmez + ayar yok → SINGLE: 1 İE, 2 top (parti metreleriyle), kurşun metresi = toplam
//   §4 ⭐ aynı clientToken → aynı İE, yeni top/İE yok
//   §5 ⭐ PER_PARTY → 2 İE (parti no'ları belgeden), replay aynı 2 İE; ⭐ ayar PER_PARTY iken mode'suz da 2 İE
//   §6 çift blok no 400; tek parti listesi 400 (min 2)
//   §7 ⭐ kullanıcı şablonu: öneri (kelime kutularından) → oluştur 201 (u-…, v1 + sürüm satırı) → replay aynı satır → aynı ad 409
//      → güncelle v2 (sürüm geçmişi 2) → bayat sürüm 409 → izinsiz 403; kelimeler ucu kutu + foto çerçevesi
//   §8 ⭐ motor DB şablonunu yükler: dosya çeki şablonu olmadan 0245 → u- şablonu; eşik altı (0244) → genel; pasif şablon yüklenmez
//   §7b ⭐ "Şablonu güncelle" (`base`): önizleme birleşik şablonla; keep [] → bölüm/tablo kalkar, keep → taşınır; önizlenen aynen kaydedilir
//   §9 ⭐ OCR "1/2" damgası uyarıdır: pageCount'a yazılmaz, iş emri formu 201 + uyarı; elle pageCount beyanı bugünkü 409 (scripts/lib/gelen-belge-cok-parti-sayfa.ts)
//   §10 ⭐ K22: istasyonun KAT varsayılanı çok partili İE'lere de yazılır (PER_PARTY + SINGLE; tek parti yoluyla aynı)
//   §15 ⭐ 214279: parti metresi beyan ara toplamından (Σ satır yalnız beyansızda); SERIES'te kağıttaki parti no künyede + aramada;
//      DOCUMENT'ta İE parti no'su kağıttaki no (scripts/lib/gelen-belge-cok-parti-kagit-no.ts)
//   §14 ⭐ parti kaydı (özet satırı) top sayısına karışmaz: detay `summary`, liste `docLineCount` (scripts/lib/gelen-belge-cok-parti-sayim.ts)
// Negatif sonda: `partyWorkOrderToken` sabit token'a (clientToken) bağlanınca §5 ikinci İE replay'e düşer → kırmızı;
// `engineTemplates` yalnız dosya şablonlarını dönünce §8 kırmızı.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { INCOMING_DOC_DEDICATED_SETTING_KEYS } from "../src/services/gelen-belge-ayar.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { partyLineId } from "../src/services/gelen-belge-kontrol.service";
import { engineTemplates } from "../src/services/gelen-belge-ozel-sablon.service";
import { classifyWithFallback, extractDocument, type OcrResult } from "../src/lib/gelen-belge/motor";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { sayfaDamgasiUyaridir } from "./lib/gelen-belge-cok-parti-sayfa";
import { cokBlokKismi } from "./lib/gelen-belge-cok-parti-kismi";
import { cokPartiSayim } from "./lib/gelen-belge-cok-parti-sayim";
import { cokPartiKagitNo } from "./lib/gelen-belge-cok-parti-kagit-no";
import { StationCapabilityService } from "../src/services/station-capability.service";
import { FOLD_PROPERTY_CODE } from "../src/services/helpers/fold-type";

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

const TAG = `TEST-GBC${Date.now().toString(36).toUpperCase()}`;
const FIKSTUR = join(__dirname, "..", "src", "lib", "gelen-belge", "motor", "__tests__", "fikstur", "gercek");
const gercek = (ad: string): OcrResult => JSON.parse(readFileSync(join(FIKSTUR, `${ad}.json`), "utf8")) as OcrResult;
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], stations: [] as string[], routes: [] as string[], scans: [] as string[], templates: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
  SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER,
];

type Resp = { status: number; code?: string; data?: Record<string, unknown> & { [k: string]: unknown }; warnings?: string[] };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function addScan(noteId: string | null, ocrResult: unknown, pageNo = 1): Promise<string> {
  const content = Buffer.from(`${TAG}-${randomUUID()}`);
  const s = await prisma.documentScan.create({
    data: { noteId, pageNo, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: ocrResult as never },
    select: { id: true },
  });
  made.scans.push(s.id);
  return s.id;
}

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER]) await setSetting(k, null);
  await setSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, "DOCUMENT");
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");
  const login = async (username: string, password: string) => {
    const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string }; warnings?: string[] };
    return { status: r.status, code: j.details?.code, data: j.data, warnings: j.warnings };
  };
  const tk = await login(admin.username, admin.password);
  check("admin login", tk.length > 0);
  const parola = kosumaOzguParola();
  const ps = await prisma.permission.findMany({ where: { code: { in: ["gelen-belge:read", "gelen-belge:write", "mobile:hizli-is-emri"] } }, select: { id: true } });
  const wu = await prisma.user.create({
    data: { username: `${TAG}-w`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} W`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
    select: { id: true, username: true },
  });
  made.users.push(wu.id);
  const woUser = await login(wu.username, parola);

  const owner = (await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} Sahip` }, select: { id: true } })).id;
  made.customers.push(owner);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  const station = (await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} kurşun`, type: "INTERNAL" }, select: { id: true } })).id;
  made.stations.push(station);
  const route = (await prisma.route.create({ data: { name: `${TAG} rota`, steps: { create: [{ stationId: station, sequence: 1 }] } }, select: { id: true } })).id;
  made.routes.push(route);

  /** Güleçsoy kalıbı: parti 1 "4 TOP" yazıyor ama 3 satır; parti 2 iki satır; belge 2 sayfa, 1 sayfa taranmış. */
  const mkNote = async (allPages = true) => {
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, {
      sourceKind: "MANUAL", senderText: `${TAG} GÜLEÇSOY`,
      lines: [100, 110, 120, 200, 210].map((m, i) => ({ senderRollNo: `${TAG}-${made.notes.length}-${i}`, meters: m, itemText: "Kumaş" })),
    });
    const id = (r.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: id }, orderBy: { lineNo: "asc" }, select: { id: true } });
    await prisma.customerDeliveryNoteLine.updateMany({ where: { id: { in: lines.slice(3).map((l) => l.id) } }, data: { blockNo: 2 } });
    const n = made.notes.length;
    await prisma.customerDeliveryNote.update({ where: { id }, data: { pageCount: 2, totalsDeclared: { blocks: [
      { blockNo: 1, batchNo: `${TAG}-P${n}A`, orderNo: "96967", topCount: 4, count: null, kg: null, m: "330" },
      { blockNo: 2, batchNo: `${TAG}-P${n}B`, orderNo: "96968", topCount: 2, count: null, kg: null, m: "410" },
    ] } } });
    await addScan(id, { ocr: { text: TAG } }, 1);
    // Onay kapısı (bugünkü) eksik sayfayı gerekçesiz geçirmez → kayıt sınanan belgelerde 2. sayfa da taranmış.
    if (allPages) await addScan(id, { ocr: { text: TAG } }, 2);
    check(`taslak (${n})`, r.status === 201 && !!id, `${r.status} ${r.code ?? ""}`);
    return id;
  };
  const partiesBody = (n: number) => [
    { blockNo: 1, batchNo: `${TAG}-P${n}A`, meters: 330 },
    { blockNo: 2, batchNo: `${TAG}-P${n}B`, meters: 410 },
  ];
  const body = (n: number, extra: Record<string, unknown> = {}) => ({ clientToken: randomUUID(), ownerCustomerId: owner, kursunMeters: "740", routeTemplateId: route, parties: partiesBody(n), ...extra });
  const formWo = (id: string, b: unknown) => call("POST", `/api/gelen-belge/irsaliyeler/${id}/is-emri`, woUser, b);
  const partyRollsOf = async (id: string) => prisma.customerDeliveryNoteLine.findMany({ where: { id: { in: [partyLineId(id, 1), partyLineId(id, 2)] } }, select: { rollId: true, meters: true, blockNo: true }, orderBy: { blockNo: "asc" } });
  const rollCount = async (id: string) => prisma.customerDeliveryNoteLine.count({ where: { noteId: id, rollId: { not: null } } });
  const woOf = async (rollIds: string[]) => (await prisma.roll.findMany({ where: { id: { in: rollIds } }, select: { batch: { select: { workOrderId: true, batchNumber: true } } } })).map((r) => r.batch);

  console.log("§1 ayar varsayılanı");
  const s1 = await call("GET", "/api/gelen-belge/ayarlar", tk);
  check("§1 multiPartyWorkOrder SINGLE + default SINGLE; dedicated", s1.data?.multiPartyWorkOrder === "SINGLE" && s1.data?.defaultMultiPartyWorkOrder === "SINGLE" && INCOMING_DOC_DEDICATED_SETTING_KEYS.has(SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER), JSON.stringify({ m: s1.data?.multiPartyWorkOrder }));

  console.log("§2 parti özeti");
  const n1 = await mkNote(false);
  const p2 = await call("GET", `/api/gelen-belge/irsaliyeler/${n1}/partiler`, tk);
  const parties = (p2.data?.parties ?? []) as Array<{ blockNo: number; batchNo: string; lineCount: number; meters: number; warnings: string[] }>;
  check("§2 ⭐ 2 parti: parti no, satır sayısı, metre", p2.status === 200 && p2.data?.multi === true && parties.length === 2 && parties[0]!.batchNo === `${TAG}-P1A` && parties[0]!.lineCount === 3 && parties[0]!.meters === 330 && parties[1]!.lineCount === 2 && parties[1]!.meters === 410 && p2.data?.defaultMode === "SINGLE",
    JSON.stringify(parties.map((p) => [p.batchNo, p.lineCount, p.meters])));
  check("§2 ⭐ canlı uyarı: parti 1 '4 TOP ↔ 3 satır'; parti 2 temiz; belge '2 sayfa, eksik 2'", /4 TOP yazıyor, 3 satır/.test(parties[0]!.warnings.join(" ")) && parties[1]!.warnings.length === 0 && /eksik sayfa: 2/.test(((p2.data?.warnings ?? []) as string[]).join(" ")),
    JSON.stringify({ p: parties.map((p) => p.warnings), d: p2.data?.warnings }));
  const nAdd = await mkNote();
  await call("POST", `/api/gelen-belge/irsaliyeler/${nAdd}/satirlar`, tk, { senderRollNo: `${TAG}-EK`, meters: 0.5, blockNo: 1 });
  const ekLine = await prisma.customerDeliveryNoteLine.findFirst({ where: { noteId: nAdd, senderRollNo: `${TAG}-EK` }, select: { id: true } });
  if (ekLine) await prisma.customerDeliveryNoteLine.update({ where: { id: ekLine.id }, data: { blockNo: 1 } });
  const p2b = await call("GET", `/api/gelen-belge/irsaliyeler/${nAdd}/partiler`, tk);
  const pa = ((p2b.data?.parties ?? []) as Array<{ warnings: string[]; lineCount: number }>)[0];
  check("§2 eksik satır girilince sayım uyarısı kendiliğinden düşer", !!ekLine && pa?.lineCount === 4 && !pa.warnings.some((w) => /TOP yazıyor/.test(w)), JSON.stringify(pa));

  console.log("§3 SINGLE (mode yok, ayar yok)");
  await addScan(n1, { ocr: { text: TAG } }, 2);
  const b3 = body(1);
  const r3 = await formWo(n1, b3);
  const pr3 = await partyRollsOf(n1);
  const wo3 = await woOf(pr3.map((r) => r.rollId!).filter(Boolean));
  const kur = await prisma.customerDeliveryNote.findUnique({ where: { id: n1 }, select: { kursunMeters: true, status: true } });
  check("§3 ⭐ 201, 1 İE, 2 top (330 + 410 m), ikisi aynı İE'de; kurşun metresi 740", r3.status === 201 && r3.data?.mode === "SINGLE" && (r3.data?.workOrders as unknown[])?.length === 1
    && pr3.length === 2 && pr3.every((r) => r.rollId) && Number(pr3[0]!.meters) === 330 && Number(pr3[1]!.meters) === 410 && wo3.length === 2 && wo3[0]?.workOrderId === wo3[1]?.workOrderId && wo3[0]?.workOrderId === r3.data?.workOrderId
    && Number(kur?.kursunMeters) === 740 && kur?.status === "APPROVED",
    `${r3.status} ${r3.code ?? ""} ${JSON.stringify({ m: r3.data?.mode, pr: pr3.map((r) => Number(r.meters)), wo: wo3, k: kur })}`);

  await cokPartiSayim({ check, noteId: n1, get: (path) => call("GET", path, tk) });

  console.log("§4 replay");
  const before4 = await prisma.workOrder.count();
  const r4 = await formWo(n1, b3);
  check("§4 ⭐ aynı token → aynı İE, yeni İE/top yok", r4.status === 201 && r4.data?.workOrderId === r3.data?.workOrderId && (await prisma.workOrder.count()) === before4 && (await rollCount(n1)) === 2, `${r4.status} ${r4.code ?? ""}`);

  console.log("§5 PER_PARTY");
  const n5 = await mkNote();
  const b5 = body(3, { mode: "PER_PARTY" });
  const r5 = await formWo(n5, b5);
  const pr5 = await partyRollsOf(n5);
  const wo5 = await woOf(pr5.map((r) => r.rollId!).filter(Boolean));
  const list5 = (r5.data?.workOrders ?? []) as Array<{ workOrderId: string; batchNumber: string | null }>;
  check("§5 ⭐ 2 İE, parti no'ları belgeden (P3A / P3B)", r5.status === 201 && list5.length === 2 && list5[0]!.workOrderId !== list5[1]!.workOrderId && wo5[0]?.workOrderId === list5[0]!.workOrderId && wo5[1]?.workOrderId === list5[1]!.workOrderId
    && wo5[0]?.batchNumber === `${TAG}-P3A` && wo5[1]?.batchNumber === `${TAG}-P3B`, `${r5.status} ${r5.code ?? ""} ${JSON.stringify({ list5, wo5 })}`);
  const before5 = await prisma.workOrder.count();
  const r5b = await formWo(n5, b5);
  const list5b = (r5b.data?.workOrders ?? []) as Array<{ workOrderId: string }>;
  check("§5 ⭐ replay → aynı 2 İE, yeni İE yok", r5b.status === 201 && JSON.stringify(list5b.map((w) => w.workOrderId)) === JSON.stringify(list5.map((w) => w.workOrderId)) && (await prisma.workOrder.count()) === before5, `${r5b.status} ${r5b.code ?? ""}`);
  await setSetting(SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, "PER_PARTY");
  const n5c = await mkNote();
  const r5c = await formWo(n5c, body(4));
  check("§5 ⭐ ayar PER_PARTY iken mode'suz da 2 İE", r5c.status === 201 && r5c.data?.mode === "PER_PARTY" && (r5c.data?.workOrders as unknown[])?.length === 2, `${r5c.status} ${r5c.code ?? ""}`);
  await setSetting(SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, null);

  console.log("§6 gövde kapıları");
  const n6 = await mkNote();
  const r6a = await formWo(n6, body(5, { parties: [{ blockNo: 1, meters: 10 }, { blockNo: 1, meters: 20 }] }));
  const r6b = await formWo(n6, body(5, { parties: [{ blockNo: 1, meters: 10 }] }));
  check("§6 çift blok no 400 · tek parti 400; top doğmadı", r6a.status === 400 && r6a.code === "DELIVERY_NOTE_PARTY_DUPLICATE" && r6b.status === 400 && (await rollCount(n6)) === 0, `${r6a.status} ${r6a.code ?? ""} ${r6b.status}`);

  console.log("§7 kullanıcı şablonu");
  const ocr = gercek("0245-ceki-listesi-a");
  const scan = await addScan(null, { ocr });
  const w7 = await call("GET", `/api/gelen-belge/taramalar/${scan}/kelimeler`, tk);
  const words = (w7.data?.words ?? []) as Array<{ text: string; rect: { x: number }; photoRect: { x: number } }>;
  check("§7 ⭐ kelimeler ucu: kutu + foto çerçevesi", w7.status === 200 && words.length > 20 && words.every((w) => w.photoRect && typeof w.rect.x === "number") && words.some((w) => w.text === "P9918733"), `${w7.status} ${words.length}`);
  const rectOf = (t: string) => ocr.blocks.flatMap((b) => b.lines).find((l) => l.text === t)!.rect;
  const elOf = (t: string) => ocr.blocks.flatMap((b) => b.lines).flatMap((l) => l.elements).find((e) => e.text === t)!.rect;
  const name = `${TAG} Güleçsoy çeki`;
  const sug = await call("POST", "/api/gelen-belge/sablonlar/oneri", tk, {
    scanId: scan, name,
    assignments: [{ field: "evrakNo", rect: rectOf("914279") }, { field: "partiNo", rect: elOf("P9918733"), section: true }, { field: "siparisNo", rect: rectOf("96967"), section: true }],
    identifiers: ["KUMAŞ ÇEKİ LİSTESİ", "FIŞ NO", "Ham PartiNo"],
    table: { columns: [{ key: "topNo", header: "Top No" }, { key: "kg", header: "Kilo" }, { key: "m", header: "Metre" }], totalsLabel: "T.Adet" },
    sectionStartLabel: "Sipariş No",
  });
  const prev = sug.data?.preview as { matched?: boolean; blocks?: Array<{ batchNo?: string }> } | null;
  check("§7 ⭐ öneri: şablon + önizleme aynı taramada eşleşir, 2 bölüm parti no", sug.status === 200 && (sug.data?.errors as unknown[])?.length === 0 && prev?.matched === true && JSON.stringify(prev.blocks?.map((b) => b.batchNo)) === JSON.stringify(["P9918733", "P9918734"]),
    `${sug.status} ${sug.code ?? ""} ${JSON.stringify({ e: sug.data?.errors, b: prev?.blocks?.map((b) => b.batchNo) })}`);
  const tpl = sug.data?.template as Record<string, unknown>;
  const token = randomUUID();
  const c1 = await call("POST", "/api/gelen-belge/sablonlar/ozel", tk, { name, template: tpl, clientToken: token });
  const code = String(c1.data?.code ?? "");
  const row = code ? await prisma.senderTemplate.findUnique({ where: { code }, select: { id: true, version: true, _count: { select: { versions: true } } } }) : null;
  if (row) made.templates.push(row.id);
  check("§7 ⭐ oluştur 201: u- kodu, v1 + sürüm satırı", c1.status === 201 && code.startsWith("u-") && row?.version === 1 && row._count.versions === 1, `${c1.status} ${c1.code ?? ""} ${code}`);
  const c2 = await call("POST", "/api/gelen-belge/sablonlar/ozel", tk, { name, template: tpl, clientToken: token });
  const c3 = await call("POST", "/api/gelen-belge/sablonlar/ozel", tk, { name, template: tpl, clientToken: randomUUID() });
  check("§7 ⭐ replay aynı satır · aynı ad yeni token 409", c2.status === 201 && c2.data?.id === c1.data?.id && c3.status === 409 && c3.code === "USER_TEMPLATE_CODE_TAKEN", `${c2.status} ${c3.status} ${c3.code ?? ""}`);
  const bad = await call("POST", "/api/gelen-belge/sablonlar/ozel", tk, { name: `${TAG} bozuk`, template: { fields: [] } });
  check("§7 şema dışı şablon 400 USER_TEMPLATE_INVALID", bad.status === 400 && bad.code === "USER_TEMPLATE_INVALID", `${bad.status} ${bad.code ?? ""}`);
  const u1 = await call("PUT", `/api/gelen-belge/sablonlar/ozel/${code}`, tk, { expectedVersion: 1, template: { ...tpl, identifiers: { ...(tpl.identifiers as object), minScore: 0.4 } } });
  const u2 = await call("PUT", `/api/gelen-belge/sablonlar/ozel/${code}`, tk, { expectedVersion: 1, template: tpl });
  const g = await call("GET", `/api/gelen-belge/sablonlar/ozel/${code}`, tk);
  check("§7 ⭐ güncelle v2 (geçmiş 2 sürüm) · bayat sürüm 409", u1.status === 200 && u1.data?.version === 2 && u2.status === 409 && u2.code === "USER_TEMPLATE_VERSION_CHANGED" && (g.data?.versions as unknown[])?.length === 2,
    `${u1.status} ${u1.code ?? ""} ${u2.status} ${u2.code ?? ""}`);
  const f403 = await call("POST", "/api/gelen-belge/sablonlar/ozel", woUser, { name: `${TAG} izinsiz`, template: tpl });
  const k403 = await call("GET", `/api/gelen-belge/taramalar/${scan}/kelimeler`, woUser);
  check("§7 ⭐ gelen-belge:template yok → 403 (oluştur + kelimeler)", f403.status === 403 && k403.status === 403, `${f403.status} ${k403.status}`);
  const list = await call("GET", "/api/gelen-belge/sablonlar", tk);
  const lv = ((list.data ?? []) as unknown as Array<{ code: string; kind: string; name: string; inEngine: boolean }>).find((x) => x.code === code);
  check("§7 şablon listesinde kind USER, adı kendi JSON'undan, motorda", lv?.kind === "USER" && lv.name === name && lv.inEngine === true, JSON.stringify(lv));

  console.log("§8 motor DB şablonunu yükler");
  const eng = await engineTemplates();
  const noFile = eng.filter((t) => t.id !== "ceki-listesi-a");
  const x = extractDocument(ocr, noFile);
  check("§8 ⭐ dosya çeki şablonu olmadan 0245 → kullanıcı şablonu (v2), genel SONDA", eng.some((t) => t.id === code && t.version === 2) && eng[eng.length - 1]!.id === "genel" && x.regions[0]?.templateId === code, JSON.stringify({ t: x.regions[0]?.templateId }));
  const other = classifyWithFallback(gercek("0244-kumas-irsaliyesi"), noFile.filter((t) => t.id === code || t.id === "genel"), "genel");
  check("§8 eşik altı belge → genel", other.templateId === "genel", JSON.stringify(other));
  const off = await call("PATCH", `/api/gelen-belge/sablonlar/${code}`, tk, { isActive: false });
  check("§8 pasif kullanıcı şablonu motora yüklenmez", off.status === 200 && !(await engineTemplates()).some((t) => t.id === code), `${off.status} ${off.code ?? ""}`);

  console.log("§7b şablonu güncelle: önizlenen = kaydedilen (s1b inceleme)");
  const upd = (keep: string[], extra: Record<string, unknown> = {}) => call("POST", "/api/gelen-belge/sablonlar/oneri", tk, {
    scanId: scan, name, identifiers: ["KUMAŞ ÇEKİ LİSTESİ", "FIŞ NO", "Ham PartiNo"],
    assignments: [{ field: "evrakNo", rect: rectOf("914279") }, { field: "partiNo", rect: elOf("P9918733") }], base: { code, keep }, ...extra,
  });
  const b0 = await upd([]);
  const t0 = b0.data?.template as Record<string, unknown> | undefined;
  const p0 = b0.data?.preview as { matched?: boolean; blocks?: unknown[] } | null;
  const f0 = ((t0?.fields ?? []) as Array<{ key: string }>).map((f) => f.key);
  check("§7b ⭐ keep [] → birleşik şablonda bölüm/tablo YOK, eski alan (siparisNo) korunur, önizleme bu şablonla (tek parti)",
    b0.status === 200 && t0?.id === code && !t0?.sections && !t0?.tables && f0.includes("siparisNo") && p0?.matched === true && (p0?.blocks?.length ?? 0) <= 1,
    `${b0.status} ${b0.code ?? ""} ${JSON.stringify({ id: t0?.id, s: !!t0?.sections, t: !!t0?.tables, f0, b: p0?.blocks?.length, e: b0.data?.errors })}`);
  const b1 = await upd(["tables", "sections"]);
  const t1 = b1.data?.template as Record<string, unknown> | undefined;
  const p1 = b1.data?.preview as { blocks?: Array<{ batchNo?: string }> } | null;
  check("§7b ⭐ keep [tables, sections] → eski bölüm + tablo taşınır, önizleme 2 parti",
    b1.status === 200 && !!t1?.sections && !!t1?.tables && JSON.stringify(p1?.blocks?.map((b) => b.batchNo)) === JSON.stringify(["P9918733", "P9918734"]),
    `${b1.status} ${JSON.stringify({ s: !!t1?.sections, t: !!t1?.tables, b: p1?.blocks?.map((b) => b.batchNo), e: b1.data?.errors })}`);
  const cur = await prisma.senderTemplate.findUnique({ where: { code }, select: { version: true } });
  const sv = await call("PUT", `/api/gelen-belge/sablonlar/ozel/${code}`, tk, { expectedVersion: cur?.version, template: t0, name });
  const stored = await prisma.senderTemplate.findUnique({ where: { code }, select: { template: true } });
  const st = stored?.template as Record<string, unknown> | undefined;
  check("§7b ⭐ önizlenen şablon aynen kaydedilir: bölüm/tablo kalktı", sv.status === 200 && !!st && !st.sections && !st.tables, `${sv.status} ${sv.code ?? ""}`);
  const bx = await upd(["tables"], { base: { code: "u-yok-boyle-sablon", keep: [] } });
  const by = await upd(["kilit"]);
  check("§7b base: olmayan şablon 404 · tanınmayan keep 400", bx.status === 404 && bx.code === "USER_TEMPLATE_NOT_FOUND" && by.status === 400, `${bx.status} ${bx.code ?? ""} ${by.status}`);

  console.log("§9 sayfa damgası uyarıdır");
  await sayfaDamgasiUyaridir({
    check, ocr, addScan,
    emptyNote: async () => {
      const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", senderText: `${TAG} GÜLEÇSOY OCR` });
      const id = (r.data as { id?: string } | undefined)?.id ?? "";
      made.notes.push(id);
      check("§9 boş taslak 201", r.status === 201 && !!id, `${r.status} ${r.code ?? ""}`);
      return id;
    },
    parties: (id) => call("GET", `/api/gelen-belge/irsaliyeler/${id}/partiler`, tk),
    formWo: (id, ps) => formWo(id, { clientToken: randomUUID(), ownerCustomerId: owner, kursunMeters: "1", routeTemplateId: route, parties: ps }),
    manualTwoPageNote: () => mkNote(false),
  });

  console.log("§10 K22 kat varsayılanı çok partide");
  const kat = await prisma.fabricProperty.findUnique({ where: { code: FOLD_PROPERTY_CODE }, select: { id: true, values: { where: { isActive: true }, select: { id: true, code: true }, take: 1 } } });
  const fold = kat?.values[0];
  const kStation = (await prisma.station.create({ data: { code: `${TAG}-KAT`.slice(0, 32), name: `${TAG} tambur`, type: "INTERNAL" }, select: { id: true } })).id;
  made.stations.push(kStation);
  if (kat && fold) await new StationCapabilityService().setCapabilities(kStation, { properties: [{ propertyId: kat.id, mode: "OPTIONAL", defaultOn: true, defaultValueId: fold.id }] });
  const kRoute = (await prisma.route.create({ data: { name: `${TAG} kat rota`, steps: { create: [{ stationId: kStation, sequence: 1 }] } }, select: { id: true } })).id;
  made.routes.push(kRoute);
  for (const mode of ["PER_PARTY", "SINGLE"] as const) {
    const n10 = await mkNote();
    const r10 = await formWo(n10, body(10 + made.notes.length, { mode, routeTemplateId: kRoute }));
    const ids = ((r10.data?.workOrders ?? []) as Array<{ workOrderId: string }>).map((w) => w.workOrderId);
    const folds = (await prisma.workOrder.findMany({ where: { id: { in: ids } }, select: { foldType: true } })).map((w) => w.foldType);
    check(`§10 ⭐ ${mode}: istasyonun kat varsayılanı her iş emrine (tek parti yoluyla aynı)`, !!fold && r10.status === 201 && ids.length === (mode === "PER_PARTY" ? 2 : 1) && folds.length === ids.length && folds.every((f) => f === fold.code),
      `${r10.status} ${r10.code ?? ""} ${JSON.stringify({ folds, want: fold?.code })}`);
  }

  await cokBlokKismi({ check, tag: TAG, mkNote: () => mkNote(), parties: (id) => call("GET", `/api/gelen-belge/irsaliyeler/${id}/partiler`, tk), formWo, body });
  await cokPartiKagitNo({ check, tag: TAG, mkNote: () => mkNote(), parties: (id) => call("GET", `/api/gelen-belge/irsaliyeler/${id}/partiler`, tk), formWo, body, setSetting, get: (path) => call("GET", path, tk) });
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = (await prisma.workOrder.findMany({ where: { OR: [{ routeTemplateId: { in: made.routes } }, { batches: { some: { rolls: { some: { id: { in: rollIds } } } } } }] }, select: { id: true } })).map((w) => w.id);
  // §9 OCR satırları taramaya bağlı (scanId) → tarama silinmeden önce bağ çözülür.
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: { in: made.notes } }, data: { scanId: null } }).catch(swallow);
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
  await prisma.senderTemplateVersion.deleteMany({ where: { templateId: { in: made.templates } } }).catch(swallow);
  await prisma.senderTemplate.deleteMany({ where: { id: { in: made.templates } } }).catch(swallow);
  await prisma.route.deleteMany({ where: { id: { in: made.routes } } }).catch(swallow);
  await prisma.stationProperty.deleteMany({ where: { stationId: { in: made.stations } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge çok parti + kullanıcı şablonu (S1) bekçisi ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    server.close();
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
