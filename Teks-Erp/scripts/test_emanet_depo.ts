// =============================================================================
// EMANET VARSAYILAN DEPOSU (`emanet.defaultWarehouseId`) — genel fason F1b, 2026-11-08
// =============================================================================
// Gerçek DB + süreç-içi HTTP (geçici port). Boğaz `helpers/emanet-warehouse.helper.ts` (`resolveBirthWarehouseIdTx`,
// `createInitialEntry`in tek depo sorusu); uçlar `GET|PUT /api/feature-flags/emanet-default-warehouse`, gelen belge onayı
// `POST /api/gelen-belge/irsaliyeler/:id/onay`, ham `PUT /api/admin/settings/:key`. Sınanan:
//   §1 ⭐ ayar BOŞ = bugünkü: KK1 sahipli + sahipsiz giriş ve gelen belge onayı varsayılan depoda
//   §2 yazım sözleşmesi: GET boş görünüm; pasif / olmayan depo 400 EMANET_DEFAULT_WAREHOUSE_INVALID; izinsiz 403; ham uç 400
//      SETTING_KEY_RESERVED; geçerli depo 200 + audit satırı
//   §3 ⭐ ayar DOLU: sahipli KK1 topu emanet deposunda; sahipsiz varsayılanda; açık depo seçimi (mal kabul) kazanır; gelen belge
//      onayı toplarını emanet deposuna doğurur
//   §4 emanet deposu pasife ALINAMAZ ve kalıcı SİLİNEMEZ (409, tek kaynak `EMANET_DEFAULT_WAREHOUSE_REF`); büyük harfli UUID
//      kanonik yazılır ve elle yazılmışsa da kapıya takılır
//   §5 ⭐ fail-closed: depo sonradan pasif → sahipli doğum 400 EMANET_DEFAULT_WAREHOUSE_UNUSABLE (top doğmaz); gelen belge onayı
//      ön kontrolde 400 (başlık DRAFT kalır); GET `problem` taşır
//   §6 okunamayan değer (çöp) → bugünkü varsayılan; emanet KAPALIYKEN ayar etkisiz (sahipli doğum 403 kalır, 400 değil)
//   §7 temizleme (null) → bugünkü davranış
//   Fason TERBİYE kabulü (`subcontractor/receive.ts`, makbuzdan doğan top sahibi kaynaktan kalıtır) aynı boğazdan: §1 boşken
//   sahipli/sahipsiz varsayılanda · §3 doluyken sahipli emanet deposunda (defter `toWarehouseId` dahil), sahipsiz varsayılanda ·
//   §5 depo pasif → sahipli kabul 400, makbuz/doğan top yok, kaynak top fasonda; ön kontrol iş emri kilidinden ÖNCE sorar
//   (satır başka tx'te kilitliyken 400 beklemeden döner) · §6 emanet kapalı → kalıntı sahipli kaynak varsayılanda (400 değil).
//   ARA ADIM (rota fason → iç istasyon, doğan top IN_PRODUCTION) da aynı boğazdan: §3 emanet deposu · §5 pasif → 400, yazımsız
// Negatif sonda: `createInitialEntry`te `resolveBirthWarehouseIdTx` yerine `resolveTargetWarehouseId(tx, warehouseId)` → §3
// kırmızı; `receive.ts`te boğaz yerine `resolveTargetWarehouseId(tx)` → §3/§5 fason kolları kırmızı; `receive.ts` ön kontrolü
// silinince §5 kilit kolu kırmızı; helper'daki `readEmanetEnabled` dalı silinince §6 "emanet kapalı" kırmızı; arşiv kapısındaki ayar satırı silinince §4;
// `hardDelete`teki emanet sayımı silinince §4 kalıcı silme kolu; okuyucudaki `toLowerCase` kaldırılınca §4 büyük harf kolu.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as bcrypt from "bcryptjs";
import { RollStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { InventoryService } from "../src/services/inventory.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { warehouseService } from "../src/services/warehouse.service";
import { resolveEmanetBirthWarehouseIdTx } from "../src/services/helpers/emanet-warehouse.helper";
import { resolveTargetWarehouseId } from "../src/services/helpers/warehouse.helper";
import { AppError } from "../src/utils/app-error";
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

const TAG = `TEST-EMD${Date.now().toString(36).toUpperCase()}`;
const inventory = new InventoryService();
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], scans: [] as string[], warehouses: [] as string[], rolls: [] as string[], wos: [] as string[], stations: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, SETTING_KEYS.GELEN_BELGE_DUPLICATE_DOC_NO,
  SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID,
];

type Resp = { status: number; code?: string; data?: Record<string, unknown> };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function expectError(fn: () => Promise<unknown>): Promise<AppError | null> {
  try { await fn(); return null; } catch (e) { return e instanceof AppError ? e : null; }
}
const codeOf = (e: AppError | null): string => String((e?.details as { code?: string } | undefined)?.code ?? e?.statusCode ?? "yok");

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
    SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, SETTING_KEYS.GELEN_BELGE_DUPLICATE_DOC_NO, SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID]) await setSetting(k, null);
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");

  const login = async (username: string, password: string) => {
    const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
    return { status: r.status, code: j.details?.code, data: j.data };
  };
  const tk = await login(admin.username, admin.password);
  check("admin login", tk.length > 0);
  // Dar izinli kullanıcı: depo okuyabilir ama ayar yazamaz.
  const parola = kosumaOzguParola();
  const ps = await prisma.permission.findMany({ where: { code: { in: ["warehouse:read"] } }, select: { id: true } });
  const nu = await prisma.user.create({
    data: { username: `${TAG}-n`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} N`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
    select: { id: true, username: true },
  });
  made.users.push(nu.id);
  const narrow = await login(nu.username, parola);

  const owner = (await prisma.customer.create({ data: { code: `${TAG}-O`, name: `${TAG} Sahip` }, select: { id: true } })).id;
  made.customers.push(owner);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} müşteri malı`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  await setSetting(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, fabric);
  const mkWarehouse = async (suffix: string, isActive = true) => {
    const id = (await prisma.warehouse.create({ data: { code: `${TAG}-${suffix}`.slice(0, 32), name: `${TAG} ${suffix}`, isActive }, select: { id: true } })).id;
    made.warehouses.push(id);
    return id;
  };
  const defaultWh = await resolveTargetWarehouseId(prisma);
  const emanetWh = await mkWarehouse("EMANET");
  const passiveWh = await mkWarehouse("PASIF", false);
  const explicitWh = await mkWarehouse("ACIK");

  const kk1 = async (ownerCustomerId: string | null, warehouseId?: string) => {
    const r = await inventory.createInitialEntry({ itemId: fabric, initialQty: 50, width: 150 }, admin.id, null, false, { ownerCustomerId, gradeRequired: false, ...(warehouseId ? { warehouseId } : {}) });
    made.rolls.push(r.data.id);
    return (await prisma.roll.findUniqueOrThrow({ where: { id: r.data.id }, select: { warehouseId: true } })).warehouseId;
  };
  /** Taslak gelen belge + okunmuş sayfa; onay yanıtı + doğan topların depoları. */
  const approveNote = async (suffix: string) => {
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, {
      sourceKind: "MANUAL", ownerCustomerId: owner, senderDocNo: `${TAG}-${suffix}`,
      lines: [100, 110].map((m, i) => ({ senderRollNo: `${TAG}-${suffix}-${i}`, meters: m, itemText: "Kumaş" })),
    });
    const id = (r.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    const content = Buffer.from(`${TAG}-${suffix}-${randomUUID()}`);
    const s = await prisma.documentScan.create({
      data: { noteId: id, pageNo: 1, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content: new Uint8Array(content), status: "READ", ocrResult: { ocr: { text: TAG } } as never },
      select: { id: true },
    });
    made.scans.push(s.id);
    const a = await call("POST", `/api/gelen-belge/irsaliyeler/${id}/onay`, tk, {});
    const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: id, rollId: { not: null } }, select: { roll: { select: { warehouseId: true } } } });
    const status = (await prisma.customerDeliveryNote.findUnique({ where: { id }, select: { status: true } }))?.status;
    return { a, status, warehouses: lines.map((l) => l.roll?.warehouseId ?? null) };
  };
  const allIn = (ws: Array<string | null>, wh: string) => ws.length > 0 && ws.every((w) => w === wh);

  // Fason TERBİYE kabulü: tek adımlı fason iş emri, tek top fasonda; kabul makbuzdan top doğurur (son adım → WAREHOUSE).
  const sub = await ensureTestDyeHouse();
  const subSvc = new SubcontractorService();
  const stFason = (await prisma.station.create({ data: { code: `${TAG}-FSN`.slice(0, 32), name: `${TAG} fason`, type: "EXTERNAL", kind: "SUBCONTRACTOR" }, select: { id: true } })).id;
  made.stations.push(stFason);
  const stIc = (await prisma.station.create({ data: { code: `${TAG}-IC`.slice(0, 32), name: `${TAG} iç`, type: "INTERNAL", kind: "PROCESS_QC" }, select: { id: true } })).id;
  made.stations.push(stIc);
  /** Sahibi `ownerCustomerId` olan bir top fasona gider (kaynak top açık depo seçimiyle doğar — ayar onu etkilemez). */
  const fasonaGonder = async (suffix: string, ownerCustomerId: string | null, araAdim = false) => {
    // `araAdim`: rota fason → iç istasyon; kabulde doğan top IN_PRODUCTION ve sonraki adıma bağlı (son adım değil).
    const steps = [{ stationId: stFason, stepSequence: 1, status: "PENDING" as const }, ...(araAdim ? [{ stationId: stIc, stepSequence: 2, status: "PENDING" as const }] : [])];
    const w = await prisma.workOrder.create({
      data: { workOrderNumber: `${TAG}-${suffix}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric, steps: { create: steps } },
      select: { id: true, steps: { select: { id: true }, orderBy: { stepSequence: "asc" } } },
    });
    made.wos.push(w.id);
    await prisma.$transaction((tx) => new TravelerCardService().createForWorkOrder(tx, w.id, admin.id));
    const r = await inventory.createInitialEntry({ itemId: fabric, initialQty: 80, width: 150 }, admin.id, null, false, { gradeRequired: false, warehouseId: defaultWh });
    made.rolls.push(r.data.id);
    await prisma.roll.update({ where: { id: r.data.id }, data: { ownerCustomerId, status: RollStatus.STOCK } });
    await subSvc.dispatch({ workOrderId: w.id, stepId: w.steps[0]!.id, subcontractorId: sub.id, rollIds: [r.data.id] }, admin.id);
    return { woId: w.id, stepId: w.steps[0]!.id, rollId: r.data.id };
  };
  /** Kabul + doğan topların deposu ve defter `to` deposu; reddedilirse hata kodu. */
  const fasonKabul = async (g: { woId: string; stepId: string; rollId: string }) => {
    const res = await subSvc.receive({ workOrderId: g.woId, stepId: g.stepId, subcontractorId: sub.id, clientToken: randomUUID(), returns: [{ rollId: g.rollId }], newRolls: [{ qty: 75 }] }, admin.id)
      .then(() => "geçti", (e: unknown) => codeOf(e instanceof AppError ? e : null));
    const born = await prisma.roll.findMany({ where: { parentReceipt: { workOrderId: g.woId } }, select: { id: true, status: true, warehouseId: true, warehouseMovements: { select: { toWarehouseId: true } } } });
    made.rolls.push(...born.map((b) => b.id));
    const receipts = await prisma.subcontractorReceipt.count({ where: { workOrderId: g.woId } });
    const src = await prisma.roll.findUniqueOrThrow({ where: { id: g.rollId }, select: { status: true } });
    const ledger = born.flatMap((b) => b.warehouseMovements.map((m) => m.toWarehouseId));
    return { res, receipts, srcStatus: src.status, warehouses: born.map((b) => b.warehouseId), statuses: born.map((b) => b.status), ledger };
  };
  /** Ön kontrol ölçümü: iş emri satırı başka tx'te kilitliyken kabul. Ön kontrol kilitten önceyse 400 beklemeden döner;
   *  yoksa kabul `touchWorkOrderTx`te bekler (3 sn sonra "kilitte bekledi"), kilit bırakılınca tx içi 400 alır. */
  const kilitliyken = async (g: { woId: string; stepId: string; rollId: string }) => {
    let birak!: () => void;
    const bekle = new Promise<void>((r) => { birak = r; });
    let kilitlendi!: () => void;
    const kilitli = new Promise<void>((r) => { kilitlendi = r; });
    const tutucu = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM work_orders WHERE id = ${g.woId}::uuid FOR UPDATE`;
      kilitlendi();
      await bekle;
    }, { timeout: 30_000 });
    await kilitli;
    const kabul = fasonKabul(g);
    const ilk = await Promise.race([kabul.then((r) => r.res), new Promise<string>((r) => setTimeout(() => r("kilitte bekledi"), 3000))]);
    birak();
    await tutucu;
    return { ilk, son: await kabul };
  };

  console.log("§1 ayar boş = bugünkü davranış");
  check("§1 ⭐ KK1 sahipli giriş varsayılan depoda", (await kk1(owner)) === defaultWh);
  check("§1 KK1 sahipsiz giriş varsayılan depoda", (await kk1(null)) === defaultWh);
  const n1 = await approveNote("N1");
  check("§1 ⭐ gelen belge onayı topları varsayılan depoda", n1.a.status === 200 && n1.warehouses.length === 2 && allIn(n1.warehouses, defaultWh), `${n1.a.status} ${n1.a.code ?? ""} ${n1.warehouses.length}`);
  const f1o = await fasonKabul(await fasonaGonder("F1O", owner));
  check("§1 ⭐ fason terbiye kabulü: sahipli doğan top varsayılan depoda", f1o.res === "geçti" && allIn(f1o.warehouses, defaultWh) && allIn(f1o.ledger, defaultWh), JSON.stringify(f1o));
  const f1n = await fasonKabul(await fasonaGonder("F1N", null));
  check("§1 fason terbiye kabulü: sahipsiz doğan top varsayılan depoda", f1n.res === "geçti" && allIn(f1n.warehouses, defaultWh), JSON.stringify(f1n));

  console.log("§2 yazım sözleşmesi");
  const g0 = await call("GET", "/api/feature-flags/emanet-default-warehouse", tk);
  check("§2 GET boş görünüm (warehouse null, emanet açık)", g0.status === 200 && g0.data?.warehouse === null && g0.data?.problem === null && g0.data?.emanetEnabled === true, JSON.stringify(g0.data));
  const pPas = await call("PUT", "/api/feature-flags/emanet-default-warehouse", tk, { warehouseId: passiveWh });
  check("§2 pasif depo 400 EMANET_DEFAULT_WAREHOUSE_INVALID", pPas.status === 400 && pPas.code === "EMANET_DEFAULT_WAREHOUSE_INVALID", `${pPas.status} ${pPas.code ?? ""}`);
  const pNone = await call("PUT", "/api/feature-flags/emanet-default-warehouse", tk, { warehouseId: randomUUID() });
  check("§2 olmayan depo 400 EMANET_DEFAULT_WAREHOUSE_INVALID", pNone.status === 400 && pNone.code === "EMANET_DEFAULT_WAREHOUSE_INVALID", `${pNone.status} ${pNone.code ?? ""}`);
  const pBad = await call("PUT", "/api/feature-flags/emanet-default-warehouse", tk, { warehouseId: "depo" });
  check("§2 UUID olmayan gövde 400", pBad.status === 400, String(pBad.status));
  const noPerm = await call("PUT", "/api/feature-flags/emanet-default-warehouse", narrow, { warehouseId: emanetWh });
  const noPermGet = await call("GET", "/api/feature-flags/emanet-default-warehouse", narrow);
  check("§2 izinsiz yazım/okuma 403", noPerm.status === 403 && noPermGet.status === 403, `${noPerm.status} ${noPermGet.status}`);
  const raw = await call("PUT", `/api/admin/settings/${SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID}`, tk, { value: emanetWh });
  check("§2 ham ayar ucu 400 SETTING_KEY_RESERVED", raw.status === 400 && raw.code === "SETTING_KEY_RESERVED", `${raw.status} ${raw.code ?? ""}`);
  check("§2 reddedilen yazımlar ayarı doğurmadı", (await prisma.systemSetting.count({ where: { key: SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID } })) === 0);
  const since = new Date();
  const ok = await call("PUT", "/api/feature-flags/emanet-default-warehouse", tk, { warehouseId: emanetWh });
  const okWh = ok.data?.warehouse as { id?: string } | null | undefined;
  check("§2 geçerli depo yazılır, görünüm döner", ok.status === 200 && okWh?.id === emanetWh && ok.data?.problem === null, `${ok.status} ${ok.code ?? ""}`);
  const audit = await prisma.systemLog.count({ where: { tableName: "SYSTEM_SETTING", recordId: SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, createdAt: { gte: since } } });
  check("§2 yazım audit'li (SYSTEM_SETTING satırı)", audit >= 1, String(audit));

  console.log("§3 ayar dolu");
  check("§3 ⭐ KK1 sahipli giriş emanet deposunda", (await kk1(owner)) === emanetWh);
  check("§3 KK1 sahipsiz giriş varsayılan depoda (ayar yalnız emanete)", (await kk1(null)) === defaultWh);
  check("§3 açık depo seçimi kazanır (mal kabul emsali)", (await kk1(owner, explicitWh)) === explicitWh);
  const n3 = await approveNote("N3");
  check("§3 ⭐ gelen belge onayı topları emanet deposunda", n3.a.status === 200 && n3.warehouses.length === 2 && allIn(n3.warehouses, emanetWh), `${n3.a.status} ${n3.a.code ?? ""} ${n3.warehouses.length}`);
  const f3o = await fasonKabul(await fasonaGonder("F3O", owner));
  check("§3 ⭐ fason terbiye kabulü: sahipli doğan top emanet deposunda (defter girişi dahil)", f3o.res === "geçti" && allIn(f3o.warehouses, emanetWh) && allIn(f3o.ledger, emanetWh), JSON.stringify(f3o));
  const f3n = await fasonKabul(await fasonaGonder("F3N", null));
  const f3a = await fasonKabul(await fasonaGonder("F3A", owner, true));
  check("§3 ⭐ ara adım fason kabulü (doğan top IN_PRODUCTION): sahipli top emanet deposunda", f3a.res === "geçti" && allIn(f3a.warehouses, emanetWh) && f3a.statuses.every((st) => st === RollStatus.IN_PRODUCTION), JSON.stringify(f3a));
  check("§3 fason terbiye kabulü: sahipsiz doğan top varsayılan depoda (ayar yalnız emanete)", f3n.res === "geçti" && allIn(f3n.warehouses, defaultWh) && allIn(f3n.ledger, defaultWh), JSON.stringify(f3n));

  console.log("§4 arşiv kapısı");
  // Depodaki topları kapsam dışı tutmak için ayrı (boş) bir depoyu emanet deposu yapıp onu pasife almaya çalış.
  const emptyWh = await mkWarehouse("BOS");
  await setSetting(SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, emptyWh);
  const arc = await expectError(() => warehouseService.update(emptyWh, { isActive: false }, admin.id));
  const arcRefs = ((arc?.details as { references?: Array<{ kind: string; count: number }> } | undefined)?.references ?? []);
  check("§4 emanet deposu pasife alınamaz (409, ayar referansı)", codeOf(arc) === "MASTER_DATA_HAS_LIVE_REFERENCES" && arcRefs.some((r) => r.kind === "EMANET_DEFAULT_WAREHOUSE" && r.count === 1), codeOf(arc));
  check("§4 depo aktif kaldı", (await prisma.warehouse.findUniqueOrThrow({ where: { id: emptyWh }, select: { isActive: true } })).isActive);
  const hd = await expectError(() => warehouseService.hardDelete(emptyWh, admin.id));
  check("§4 ⭐ boş emanet deposu kalıcı silinemez (409)", hd?.statusCode === 409 && /emanet varsayılan deposu/.test(hd.message) && (await prisma.warehouse.count({ where: { id: emptyWh } })) === 1, `${hd?.statusCode ?? "geçti"} ${hd?.message.slice(0, 80) ?? ""}`);
  // Büyük harfli UUID: kapı ve okuyucu aynı kanonik biçimi görmeli (gövde biçimi kapıyı atlatmasın).
  const upWh = await mkWarehouse("BUYUK");
  const up = await call("PUT", "/api/feature-flags/emanet-default-warehouse", tk, { warehouseId: upWh.toUpperCase() });
  const stored = (await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID }, select: { value: true } }))?.value;
  check("§4 büyük harfli gövde kanonik (küçük harf) id olarak yazılır", up.status === 200 && stored === upWh, `${up.status} ${JSON.stringify(stored)}`);
  await setSetting(SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, upWh.toUpperCase());
  const upArc = await expectError(() => warehouseService.update(upWh, { isActive: false }, admin.id));
  const upHd = await expectError(() => warehouseService.hardDelete(upWh, admin.id));
  check("§4 ⭐ elle büyük harf yazılmış ayar da kapıya takılır (pasif 409 · silme 409)", codeOf(upArc) === "MASTER_DATA_HAS_LIVE_REFERENCES" && upHd?.statusCode === 409, `${codeOf(upArc)} ${upHd?.statusCode ?? "geçti"}`);
  check("§4 büyük harfli ayar doğumda aynı depoyu çözer", (await kk1(owner)) === upWh);
  await setSetting(SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, emptyWh);

  console.log("§5 fail-closed: depo sonradan pasif");
  // Kapıyı atlayan pasifleştirme (eski veri / elle müdahale) — doğum sessizce varsayılana düşmemeli.
  await prisma.warehouse.update({ where: { id: emptyWh }, data: { isActive: false } });
  const before = await prisma.roll.count({ where: { ownerCustomerId: owner } });
  const e5 = await expectError(() => kk1(owner));
  check("§5 ⭐ sahipli KK1 400 EMANET_DEFAULT_WAREHOUSE_UNUSABLE, top doğmadı", codeOf(e5) === "EMANET_DEFAULT_WAREHOUSE_UNUSABLE" && (await prisma.roll.count({ where: { ownerCustomerId: owner } })) === before, codeOf(e5));
  check("§5 sahipsiz KK1 etkilenmez (varsayılan)", (await kk1(null)) === defaultWh);
  const f5o = await fasonKabul(await fasonaGonder("F5O", owner));
  check("§5 ⭐ fason terbiye kabulü sahipli: 400 EMANET_DEFAULT_WAREHOUSE_UNUSABLE, makbuz yok, doğan top yok, kaynak top fasonda", f5o.res === "EMANET_DEFAULT_WAREHOUSE_UNUSABLE" && f5o.receipts === 0 && f5o.warehouses.length === 0 && f5o.srcStatus === RollStatus.AT_SUBCONTRACTOR, JSON.stringify(f5o));
  const f5a = await fasonKabul(await fasonaGonder("F5A", owner, true));
  check("§5 ⭐ ara adım fason kabulü sahipli: 400, makbuz yok, doğan top yok, kaynak top fasonda", f5a.res === "EMANET_DEFAULT_WAREHOUSE_UNUSABLE" && f5a.receipts === 0 && f5a.warehouses.length === 0 && f5a.srcStatus === RollStatus.AT_SUBCONTRACTOR, JSON.stringify(f5a));
  const f5k = await kilitliyken(await fasonaGonder("F5K", owner));
  check("§5 ⭐ ön kontrol iş emri kilidinden ÖNCE: satır kilitliyken 400 beklemeden döner, sonra da yazım yok", f5k.ilk === "EMANET_DEFAULT_WAREHOUSE_UNUSABLE" && f5k.son.receipts === 0 && f5k.son.warehouses.length === 0, JSON.stringify({ ilk: f5k.ilk, son: f5k.son }));
  const f5n = await fasonKabul(await fasonaGonder("F5N", null));
  check("§5 fason terbiye kabulü sahipsiz etkilenmez (varsayılan)", f5n.res === "geçti" && allIn(f5n.warehouses, defaultWh), JSON.stringify(f5n));
  const n5 = await approveNote("N5");
  check("§5 ⭐ gelen belge onayı ön kontrolde 400, başlık DRAFT, top yok", n5.a.status === 400 && n5.a.code === "EMANET_DEFAULT_WAREHOUSE_UNUSABLE" && n5.status === "DRAFT" && n5.warehouses.length === 0, `${n5.a.status} ${n5.a.code ?? ""} ${n5.status}`);
  const g5 = await call("GET", "/api/feature-flags/emanet-default-warehouse", tk);
  check("§5 GET problem taşır", g5.status === 200 && typeof g5.data?.problem === "string", JSON.stringify(g5.data?.problem));
  await prisma.warehouse.update({ where: { id: emptyWh }, data: { isActive: true } });

  console.log("§6 okunamayan değer · emanet kapalı");
  await setSetting(SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, "çöp-değer");
  check("§6 çöp değer → bugünkü varsayılan", (await kk1(owner)) === defaultWh);
  await setSetting(SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, passiveWh);
  // Emanet açıkken fasona giden sahipli top: modül sonradan kapanınca kalıntı sahipli kaynak olarak döner.
  const g6 = await fasonaGonder("F6O", owner);
  await setSetting(SETTING_KEYS.EMANET_ENABLED, false);
  const off = await resolveEmanetBirthWarehouseIdTx(prisma, owner).then((v) => ({ v, err: "" }), (e: unknown) => ({ v: "hata", err: codeOf(e instanceof AppError ? e : null) }));
  check("§6 ⭐ emanet kapalı: boğaz ayarı okumaz (null)", off.v === null, off.err);
  check("§6 emanet kapalı: sahipsiz KK1 varsayılanda", (await kk1(null)) === defaultWh);
  const f6o = await fasonKabul(g6);
  check("§6 ⭐ emanet kapalı: fason kabulü kalıntı sahipli kaynakla varsayılan depoda (pasif emanet deposu 400'ü değil)", f6o.res === "geçti" && allIn(f6o.warehouses, defaultWh), JSON.stringify(f6o));
  const e6 = await expectError(() => kk1(owner));
  check("§6 emanet kapalı: sahipli KK1 403 MODULE_DISABLED (pasif emanet deposu 400'ü değil)", codeOf(e6) === "MODULE_DISABLED", codeOf(e6));
  await setSetting(SETTING_KEYS.EMANET_ENABLED, true);

  console.log("§7 temizleme");
  await setSetting(SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, emanetWh);
  const clr = await call("PUT", "/api/feature-flags/emanet-default-warehouse", tk, { warehouseId: null });
  check("§7 null temizler", clr.status === 200 && clr.data?.warehouse === null, `${clr.status} ${clr.code ?? ""}`);
  check("§7 temizlenince sahipli KK1 yine varsayılanda", (await kk1(owner)) === defaultWh);
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const noteRolls = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const rollIds = [...new Set([...made.rolls, ...noteRolls])];
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: { in: made.notes } }, data: { scanId: null } }).catch(swallow);
  await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } }).catch(swallow);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  const recIds = (await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: made.wos } }, select: { id: true } })).map((r) => r.id);
  const dispIds = (await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: made.wos } }, select: { id: true } })).map((d) => d.id);
  await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: recIds } } });
  await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispIds } } });
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "rollVariance", "warehouseMovement"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(swallow);
  }
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: recIds } } });
  await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispIds } } });
  await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: made.wos } } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: made.wos } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: made.wos } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: made.wos } } });
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } });
  await prisma.warehouse.deleteMany({ where: { id: { in: made.warehouses } } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.updateMany({ where: { id: { in: made.users } }, data: { isActive: false } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Emanet varsayılan deposu bekçisi ===\n");
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
