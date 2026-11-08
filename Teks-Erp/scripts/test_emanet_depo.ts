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
//   §4 emanet deposu pasife ALINAMAZ (arşiv kapısı canlı referans, 409)
//   §5 ⭐ fail-closed: depo sonradan pasif → sahipli doğum 400 EMANET_DEFAULT_WAREHOUSE_UNUSABLE (top doğmaz); gelen belge onayı
//      ön kontrolde 400 (başlık DRAFT kalır); GET `problem` taşır
//   §6 okunamayan değer (çöp) → bugünkü varsayılan; emanet KAPALIYKEN ayar etkisiz (sahipli doğum 403 kalır, 400 değil)
//   §7 temizleme (null) → bugünkü davranış
// Negatif sonda: `createInitialEntry`te `resolveBirthWarehouseIdTx` yerine `resolveTargetWarehouseId(tx, warehouseId)` → §3
// kırmızı; helper'daki `readEmanetEnabled` dalı silinince §6 "emanet kapalı" kırmızı; arşiv kapısındaki ayar satırı silinince §4.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { InventoryService } from "../src/services/inventory.service";
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
const made = { customers: [] as string[], users: [] as string[], notes: [] as string[], items: [] as string[], scans: [] as string[], warehouses: [] as string[], rolls: [] as string[] };
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

  console.log("§1 ayar boş = bugünkü davranış");
  check("§1 ⭐ KK1 sahipli giriş varsayılan depoda", (await kk1(owner)) === defaultWh);
  check("§1 KK1 sahipsiz giriş varsayılan depoda", (await kk1(null)) === defaultWh);
  const n1 = await approveNote("N1");
  check("§1 ⭐ gelen belge onayı topları varsayılan depoda", n1.a.status === 200 && n1.warehouses.length === 2 && allIn(n1.warehouses, defaultWh), `${n1.a.status} ${n1.a.code ?? ""} ${n1.warehouses.length}`);

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

  console.log("§4 arşiv kapısı");
  // Depodaki topları kapsam dışı tutmak için ayrı (boş) bir depoyu emanet deposu yapıp onu pasife almaya çalış.
  const emptyWh = await mkWarehouse("BOS");
  await setSetting(SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, emptyWh);
  const arc = await expectError(() => warehouseService.update(emptyWh, { isActive: false }, admin.id));
  const arcRefs = ((arc?.details as { references?: Array<{ kind: string; count: number }> } | undefined)?.references ?? []);
  check("§4 emanet deposu pasife alınamaz (409, ayar referansı)", codeOf(arc) === "MASTER_DATA_HAS_LIVE_REFERENCES" && arcRefs.some((r) => r.kind === "EMANET_DEFAULT_WAREHOUSE" && r.count === 1), codeOf(arc));
  check("§4 depo aktif kaldı", (await prisma.warehouse.findUniqueOrThrow({ where: { id: emptyWh }, select: { isActive: true } })).isActive);

  console.log("§5 fail-closed: depo sonradan pasif");
  // Kapıyı atlayan pasifleştirme (eski veri / elle müdahale) — doğum sessizce varsayılana düşmemeli.
  await prisma.warehouse.update({ where: { id: emptyWh }, data: { isActive: false } });
  const before = await prisma.roll.count({ where: { ownerCustomerId: owner } });
  const e5 = await expectError(() => kk1(owner));
  check("§5 ⭐ sahipli KK1 400 EMANET_DEFAULT_WAREHOUSE_UNUSABLE, top doğmadı", codeOf(e5) === "EMANET_DEFAULT_WAREHOUSE_UNUSABLE" && (await prisma.roll.count({ where: { ownerCustomerId: owner } })) === before, codeOf(e5));
  check("§5 sahipsiz KK1 etkilenmez (varsayılan)", (await kk1(null)) === defaultWh);
  const n5 = await approveNote("N5");
  check("§5 ⭐ gelen belge onayı ön kontrolde 400, başlık DRAFT, top yok", n5.a.status === 400 && n5.a.code === "EMANET_DEFAULT_WAREHOUSE_UNUSABLE" && n5.status === "DRAFT" && n5.warehouses.length === 0, `${n5.a.status} ${n5.a.code ?? ""} ${n5.status}`);
  const g5 = await call("GET", "/api/feature-flags/emanet-default-warehouse", tk);
  check("§5 GET problem taşır", g5.status === 200 && typeof g5.data?.problem === "string", JSON.stringify(g5.data?.problem));
  await prisma.warehouse.update({ where: { id: emptyWh }, data: { isActive: true } });

  console.log("§6 okunamayan değer · emanet kapalı");
  await setSetting(SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, "çöp-değer");
  check("§6 çöp değer → bugünkü varsayılan", (await kk1(owner)) === defaultWh);
  await setSetting(SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, passiveWh);
  await setSetting(SETTING_KEYS.EMANET_ENABLED, false);
  const off = await resolveEmanetBirthWarehouseIdTx(prisma, owner).then((v) => ({ v, err: "" }), (e: unknown) => ({ v: "hata", err: codeOf(e instanceof AppError ? e : null) }));
  check("§6 ⭐ emanet kapalı: boğaz ayarı okumaz (null)", off.v === null, off.err);
  check("§6 emanet kapalı: sahipsiz KK1 varsayılanda", (await kk1(null)) === defaultWh);
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
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "rollVariance", "warehouseMovement"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(swallow);
  }
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
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
