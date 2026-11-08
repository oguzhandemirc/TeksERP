// =============================================================================
// EMANET EKSTRESİ BEKÇİSİ — genel fason F2: `GET /api/consigned-work/:customerId/statement`
// =============================================================================
// Koşum: npx tsx scripts/test_emanet_ekstre.ts   (DB'li; TEST- fikstürü; ayarlar fotoğrafa döner; sunucu süreç içi)
//
// Ölçer:
//   §1 T1 anlık görüntüsü — top (giriş · fire = sapma + iptal düşümü, sapmaya bağlı ADJUST ÇİFT SAYILMAZ) ·
//      iplik lotu (giriş, çözgüye çıkış) · levent (sarım) · başka müşterinin / sahipsiz top SIZMAZ
//   §2 ⭐ AS-OF — T1 sonrası storno + sevk + DSK yazılır; [T0,T1] yeniden hesaplanınca BAYT BAYT aynı;
//      sonraki dönemin açılışı = T1 kapanışı
//   §3 storno AYRI satır — sevk geri alma (OUT −), iptal geri alma (fire −), sapma terslemesi (`:rev`),
//      sarım iptali (giren −); ileri satır kendi yerinde kalır · BRÜT sevk · DSK kolonu
//   §4 değişmezler — açılış + Σ satır etkisi = kalan · Σ konu = toplam · canlı mutabakat farkı 0
//   §5 HTTP — 200 sözleşmesi (fabrika günü sınırı) · fail-closed 400 (tanınmayan parametre, bozuk/takvim dışı
//      gün, ters dönem, uuid olmayan müşteri, 366+ gün) · 404 · emanet kapalı 403 MODULE_DISABLED · `roll:read`
//      yoksa 403 · bölüm izni yoksa / modül kapalıysa `omitted` (veri gövdeye girmez)
//
// NEGATİF SONDALAR (kırmızı görülerek, 2026-11-08):
//   · storno satırı ayrı yazılmayıp yalnız toplama netlenince (assemble `if (e.reversal) continue`) §3a–§3e/§4a/§5c ❌
//   · sapmaya bağlı ADJUST satırı da okununca (`rollWarehouseLedgerWhere` kolu ADJUST'u süzgeçsiz alınca) §1a/§2c/§5b ❌
//     (çift sayım; bugün sapmaya bağlı satırların hepsi ADJUST — CANCEL kolundaki `rollVarianceId: null` savunmadır)
//   · stok defteri sorgusundan `createdAt ≤ toAt` düşünce §2a ❌ (as-of)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Sapma terslemesi `reversedAt` damgasıyla fikstürdür (okuyucu
// testi; ters yolların kendisi tambur/fason bekçilerinde ölçülür).
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as bcrypt from "bcryptjs";
import { Prisma, RollStatus, StationType, WarpBeamOrigin, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import app from "../src/app";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { InventoryService } from "../src/services/inventory.service";
import { shippingService } from "../src/services/shipping.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { YarnLotService } from "../src/services/yarn-lot.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { cancelWound, windWarpBeam } from "../src/services/warp-beam-wind.service";
import { buildRollSection } from "../src/services/consigned-statement.service";
import type { StatementSection } from "../src/services/consigned-statement.service";
import { assembleSection } from "../src/services/consigned-statement/assemble";
import { readWarpBeamEvents, readYarnLotEvents } from "../src/services/consigned-statement/yarn-beam-ledger";
import { factoryDayStartOfKey, factoryYmd } from "../src/constants/time";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const TAG = `TEST-EKS-${Date.now().toString(36)}`;
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED,
] as const;
const inventory = new InventoryService();
const made = {
  customers: [] as string[], users: [] as string[], items: [] as string[], rolls: [] as string[], shipments: [] as string[],
  lots: [] as string[], beams: [] as string[], specs: [] as string[], machines: [] as string[], stations: [] as string[], wos: [] as string[],
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const setSetting = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });

interface Sections { rolls: StatementSection; yarn: StatementSection; beam: StatementSection }
async function sections(customerId: string, fromAt: Date, toAt: Date): Promise<Sections> {
  return {
    rolls: await buildRollSection(customerId, fromAt, toAt),
    yarn: assembleSection({ kind: "YARN_LOT", unit: "kg", scope: "-" }, await readYarnLotEvents(customerId, toAt), fromAt),
    beam: assembleSection({ kind: "WARP_BEAM", unit: "m", scope: "-" }, await readWarpBeamEvents(customerId, toAt), fromAt),
  };
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Açılış + Σ satır etkisi = kalan · Σ konu = toplam (her kolonda). */
function invariants(s: StatementSection): string | null {
  const t = s.totals;
  const sumEffect = r3(s.lines.reduce((a, l) => a + l.effect, 0));
  if (r3(t.opening + sumEffect) !== t.closing) return `açılış ${t.opening} + Σetki ${sumEffect} ≠ kalan ${t.closing}`;
  for (const k of ["opening", "in", "out", "dsk", "scrap", "closing"] as const) {
    const sum = r3(s.subjects.reduce((a, x) => a + x[k], 0));
    if (sum !== t[k]) return `Σkonu.${k} ${sum} ≠ toplam ${t[k]}`;
  }
  for (const c of ["IN", "OUT", "DSK", "SCRAP"] as const) {
    const key = c === "IN" ? "in" : c === "OUT" ? "out" : c === "DSK" ? "dsk" : "scrap";
    const sum = r3(s.lines.filter((l) => l.column === c).reduce((a, l) => a + l.qty, 0));
    if (sum !== t[key]) return `Σsatır ${c} ${sum} ≠ toplam ${t[key]}`;
  }
  return null;
}
const tot = (s: StatementSection) => JSON.stringify(s.totals);

async function run(base: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of SETTINGS) await setSetting(k, true);
  const whId = await fixtureWarehouseId();

  // ── fikstür ──
  const custA = (await prisma.customer.create({ data: { code: `${TAG}-A`, name: `${TAG} Müşteri A` }, select: { id: true } })).id;
  const custB = (await prisma.customer.create({ data: { code: `${TAG}-B`, name: `${TAG} Müşteri B` }, select: { id: true } })).id;
  made.customers.push(custA, custB);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-K`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  const yarnItem = (await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } })).id;
  made.items.push(fabric, yarnItem);
  const st = (await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, producesWarpBeam: true }, select: { id: true } })).id;
  made.stations.push(st);
  const mk = (await prisma.machine.create({ data: { stationId: st, name: `${TAG}-M1`, code: `${TAG}-M1`.slice(0, 32) }, select: { id: true } })).id;
  made.machines.push(mk);
  const spec = (await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarnItem, endsCount: 3000 }, select: { id: true } })).id;
  made.specs.push(spec);

  const kk1 = async (qty: number, owner: string | null, status?: RollStatus): Promise<string> => {
    const r = await inventory.createInitialEntry({ itemId: fabric, initialQty: qty, width: 150 }, admin.id, null, false, { ownerCustomerId: owner, gradeRequired: false, warehouseId: whId, ...(status ? { forcedStatus: status } : {}) });
    made.rolls.push(r.data.id);
    return r.data.id;
  };

  await wait(5);
  const T0 = new Date();
  await wait(5);
  console.log("── §1 T1 anlık görüntüsü ──");
  const r1 = await kk1(100, custA, RollStatus.WAREHOUSE);
  const r2 = await kk1(60, custA, RollStatus.WAREHOUSE);
  const r3id = await kk1(40, custA);
  const rB = await kk1(70, custB, RollStatus.WAREHOUSE);
  const rN = await kk1(50, null, RollStatus.WAREHOUSE);
  await inventory.adjustRollQty(r2, { newQty: 55, reason: `${TAG} ölçüm farkı` }, admin.id);
  await inventory.softDelete(r3id, admin.id, { reason: `${TAG} iptal`, confirmActive: true });
  const lot = await new YarnLotService().create({ itemId: yarnItem, lotNo: `${TAG}-LA`, ownerCustomerId: custA }, admin.id);
  made.lots.push(lot.data.id);
  // Lot girişi fikstürdür (iplik giriş yolu kendi bekçisinde); okuyucu işareti `yarnMovementSign`ten alır.
  await prisma.yarnMovement.create({ data: { itemId: yarnItem, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 300, lotId: lot.data.id } });
  await prisma.yarnStock.upsert({ where: { itemId_warehouseId: { itemId: yarnItem, warehouseId: whId } }, create: { itemId: yarnItem, warehouseId: whId, balanceKg: 300 }, update: { balanceKg: { increment: 300 } } });
  const beam = await createWarpBeam({ warpSpecId: spec, plannedLengthM: 100, originKind: WarpBeamOrigin.IN_HOUSE });
  made.beams.push(beam.data.id);
  await windWarpBeam(beam.data.id, { lengthM: 100, kgSource: WarpKgSource.THEORETICAL, machineId: mk, yarnIssues: [{ warehouseId: whId, qtyKg: 10, lotId: lot.data.id }] }, admin.id);
  await wait(5);
  const T1 = new Date();
  await wait(5);

  const S1 = await sections(custA, T0, T1);
  check("§1a ⭐ top: giren 200 · fire 45 (sapma 5 + iptal 40; sapmaya bağlı ADJUST çift sayılmadı) · çıkan 0 · kalan 155",
    tot(S1.rolls) === JSON.stringify({ opening: 0, in: 200, out: 0, dsk: 0, scrap: 45, closing: 155 }), tot(S1.rolls));
  const ids1 = S1.rolls.subjects.map((s) => s.id);
  check("§1b başka müşterinin ve sahipsiz top SIZMAZ (konu: yalnız A'nın üç topu)", ids1.length === 3 && !ids1.includes(rB) && !ids1.includes(rN) && [r1, r2, r3id].every((x) => ids1.includes(x)));
  check("§1c iplik lotu: giren 300 · çıkan 10 (çözgüye) · kalan 290", S1.yarn.totals.in === 300 && S1.yarn.totals.out === 10 && S1.yarn.totals.closing === 290, tot(S1.yarn));
  check("§1d levent (sarımla A'ya kalıttı): giren 100 · kalan 100", S1.beam.totals.in === 100 && S1.beam.totals.closing === 100, tot(S1.beam));

  console.log("\n── §2 T1 sonrası yazım + AS-OF ──");
  await inventory.restoreCancelledRoll(r3id, admin.id, { reason: `${TAG} geri al` });
  const sh1 = (await shippingService.createShipmentFromRolls({ rollIds: [r1], customerId: custA, orderless: true }, admin.id)).data as { id: string };
  made.shipments.push(sh1.id);
  await shippingService.undoDispatch(sh1.id, `${TAG} yanlış araç`, admin.id);
  // Sapma terslemesi: damga + metre geri (ters yolların yaptığı); sonra r2 60 m BRÜT sevk edilir.
  const v = await prisma.rollVariance.findFirstOrThrow({ where: { rollId: r2 }, select: { id: true } });
  await prisma.rollVariance.update({ where: { id: v.id }, data: { reversedAt: new Date(), reversedById: admin.id } });
  await prisma.roll.update({ where: { id: r2 }, data: { currentQty: 60 } });
  const sh2 = (await shippingService.createShipmentFromRolls({ rollIds: [r2], customerId: custA, orderless: true }, admin.id)).data as { id: string };
  made.shipments.push(sh2.id);
  await cancelWound(beam.data.id, `${TAG} sarım iptali`, admin.id);
  // DSK: A'nın topu fasona gider, fasoncudan doğrudan A'ya sevk edilir.
  const sub = await ensureTestDyeHouse();
  const stF = (await prisma.station.create({ data: { code: `${TAG}-FSN`.slice(0, 32), name: `${TAG} fason`, type: "EXTERNAL", kind: "SUBCONTRACTOR" }, select: { id: true } })).id;
  made.stations.push(stF);
  const w = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-IE`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric, steps: { create: [{ stationId: stF, stepSequence: 1, status: "PENDING" }] } },
    select: { id: true, steps: { select: { id: true } } },
  });
  made.wos.push(w.id);
  await prisma.$transaction((tx) => new TravelerCardService().createForWorkOrder(tx, w.id, admin.id));
  const rD = await kk1(80, custA);
  const subSvc = new SubcontractorService();
  const disp = (await subSvc.dispatch({ workOrderId: w.id, stepId: w.steps[0]!.id, subcontractorId: sub.id, rollIds: [rD] }, admin.id)).data as { id: string };
  await subSvc.executeDirectShip({ dispatchId: disp.id, reason: `${TAG} doğrudan sevk`, customerId: custA }, admin.id);

  const S1again = await sections(custA, T0, T1);
  check("§2a ⭐ AS-OF: [T0,T1] yeni kayıtlardan sonra yeniden hesaplandı — üç bölüm BAYT BAYT aynı",
    JSON.stringify(S1again) === JSON.stringify(S1), `${tot(S1again.rolls)} ${tot(S1again.yarn)} ${tot(S1again.beam)}`);
  const now = new Date();
  const S2 = await sections(custA, new Date(T1.getTime() + 1), now);
  check("§2b sonraki dönemin açılışı = T1 kalanı (üç bölüm)",
    S2.rolls.totals.opening === S1.rolls.totals.closing && S2.yarn.totals.opening === S1.yarn.totals.closing && S2.beam.totals.opening === S1.beam.totals.closing,
    `${S2.rolls.totals.opening}/${S2.yarn.totals.opening}/${S2.beam.totals.opening}`);
  check("§2c top dönemi 2: giren 80 · çıkan BRÜT 100−100+60=60 · DSK 80 · fire −45 (iki storno) · kalan 140",
    tot(S2.rolls) === JSON.stringify({ opening: 155, in: 80, out: 60, dsk: 80, scrap: -45, closing: 140 }), tot(S2.rolls));

  console.log("\n── §3 storno ayrı satır ──");
  const L = S2.rolls.lines;
  const sevk = L.filter((l) => l.subjectId === r1 && l.column === "OUT");
  check("§3a ⭐ sevk geri alma: ileri satır +100 YERİNDE, storno ayrı satır −100 (reversal, aynı belge)",
    sevk.length === 2 && sevk.some((l) => l.qty === 100 && !l.reversal) && sevk.some((l) => l.qty === -100 && l.reversal && l.code === "SHIPMENT_CANCEL") && sevk.every((l) => l.document?.id === sh1.id),
    JSON.stringify(sevk.map((l) => [l.qty, l.reversal, l.code])));
  const iptal = L.filter((l) => l.subjectId === r3id);
  check("§3b iptal geri alma: fire kolonunda −40 storno satırı (ileri iptal dönem 1'de kaldı)", iptal.length === 1 && iptal[0]!.column === "SCRAP" && iptal[0]!.qty === -40 && iptal[0]!.reversal, JSON.stringify(iptal.map((l) => [l.qty, l.code])));
  const rev = L.filter((l) => l.subjectId === r2 && l.column === "SCRAP");
  check("§3c sapma terslemesi `reversedAt` anına ayrı satır (−5, reversal); r2 BRÜT 60 sevk", rev.length === 1 && rev[0]!.qty === -5 && rev[0]!.reversal && L.some((l) => l.subjectId === r2 && l.column === "OUT" && l.qty === 60), JSON.stringify(rev));
  const dsk = L.filter((l) => l.column === "DSK");
  check("§3d DSK kolonu: tek satır 80 m, belge DIRECT_SHIPMENT", dsk.length === 1 && dsk[0]!.qty === 80 && dsk[0]!.subjectId === rD && dsk[0]!.document?.type === "DIRECT_SHIPMENT", JSON.stringify(dsk));
  const wc = S2.beam.lines.filter((l) => l.code === "WOUND_CANCEL");
  check("§3e sarım iptali: giren kolonunda −100 storno satırı; levent kalanı 0", wc.length === 1 && wc[0]!.qty === -100 && wc[0]!.reversal && S2.beam.totals.closing === 0, tot(S2.beam));
  check("§3f her storno satırının katkısı negatif, ileri satırların pozitif (aynı satırda netlenmez)",
    [...L, ...S2.yarn.lines, ...S2.beam.lines].every((l) => (l.reversal ? l.qty < 0 : l.qty > 0)));

  console.log("\n── §4 değişmezler ──");
  const bad = [S1.rolls, S1.yarn, S1.beam, S2.rolls, S2.yarn, S2.beam].map(invariants).filter(Boolean);
  check("§4a ⭐ açılış + Σ satır etkisi = kalan · Σ konu = toplam · Σ kolon satırı = kolon toplamı (altı bölüm)", bad.length === 0, bad.join(" | "));

  console.log("\n── §5 HTTP ──");
  const login = async (username: string, password: string): Promise<string> => {
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  type Resp = { status: number; code?: string; data?: Record<string, unknown>; warnings?: string[] };
  const get = async (p: string, token: string): Promise<Resp> => {
    const r = await fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await r.json().catch(() => ({}))) as { data?: Record<string, unknown>; details?: { code?: string }; warnings?: string[] };
    return { status: r.status, code: j.details?.code, data: j.data, warnings: j.warnings };
  };
  const user = async (suffix: string, perms: string[]): Promise<string> => {
    const parola = kosumaOzguParola();
    const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
    const u = await prisma.user.create({
      data: { username: `${TAG}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
      select: { id: true, username: true },
    });
    made.users.push(u.id);
    return login(u.username, parola);
  };
  const tkFull = await user("full", ["roll:read", "warehouse:read", "warpbeam:read"]);
  const tkRoll = await user("roll", ["roll:read"]);
  const tkNone = await user("none", ["warehouse:read"]);
  check("§5 giriş (üç dar izinli kullanıcı)", tkFull.length > 0 && tkRoll.length > 0 && tkNone.length > 0);
  const today = factoryYmd(new Date());
  const url = (q: string, c = custA) => `/api/consigned-work/${c}/statement?${q}`;

  const ok = await get(url(`from=${today}&to=${today}`), tkFull);
  const d = ok.data as { period?: { fromAt?: string }; rolls?: StatementSection; yarnLots?: StatementSection | null; warpBeams?: StatementSection | null; omitted?: unknown[]; reconciliation?: { rolls: { diffQty: number; liveQty: number } } | null } | undefined;
  check("§5a ⭐ 200: dönem başı fabrika günü sınırı · üç bölüm · omitted boş", ok.status === 200 && d?.period?.fromAt === factoryDayStartOfKey(today).toISOString() && !!d?.rolls && !!d?.yarnLots && !!d?.warpBeams && d?.omitted?.length === 0, `${ok.status} ${ok.code ?? ""}`);
  check("§5b bugünü kapsayan dönem: top kalanı 140 · canlı mutabakat farkı 0 (uyarı yok)",
    d?.rolls?.totals.closing === 140 && d?.reconciliation?.rolls.diffQty === 0 && d?.reconciliation?.rolls.liveQty === 140 && !(ok.warnings ?? []).some((x) => x.includes("farklı")),
    JSON.stringify(d?.reconciliation));
  const bad5 = [d?.rolls, d?.yarnLots, d?.warpBeams].filter((s): s is StatementSection => !!s).map(invariants).filter(Boolean);
  check("§5c HTTP gövdesinde de değişmezler tutar", bad5.length === 0, bad5.join(" | "));

  const past = factoryYmd(new Date(Date.now() - 400 * 86_400_000));
  const bads: Array<[string, string]> = [
    ["tanınmayan parametre", url(`from=${today}&to=${today}&scope=ALL`)],
    ["bozuk gün", url(`from=2026-1-1&to=${today}`)],
    ["takvim dışı gün (02-30)", url(`from=2026-02-30&to=2026-03-01`)],
    ["ters dönem", url(`from=${today}&to=2026-01-01`)],
    ["eksik `to`", url(`from=${today}`)],
    ["366+ gün", url(`from=${past}&to=${today}`)],
    ["uuid olmayan müşteri", url(`from=${today}&to=${today}`, "abc")],
  ];
  const codes: string[] = [];
  for (const [label, p] of bads) {
    const r = await get(p, tkFull);
    if (!(r.status === 400 && r.code === "CONSIGNED_STATEMENT_PARAM_INVALID")) codes.push(`${label}: ${r.status} ${r.code ?? ""}`);
  }
  check("§5d ⭐ fail-closed: yedi bozuk istek → 400 CONSIGNED_STATEMENT_PARAM_INVALID", codes.length === 0, codes.join(" | "));
  const nf = await get(url(`from=${today}&to=${today}`, randomUUID()), tkFull);
  check("§5e bilinmeyen müşteri → 404 CUSTOMER_NOT_FOUND", nf.status === 404 && nf.code === "CUSTOMER_NOT_FOUND", `${nf.status} ${nf.code ?? ""}`);
  const np = await get(url(`from=${today}&to=${today}`), tkNone);
  check("§5f ⭐ `roll:read` yok → 403 PERMISSION_DENIED", np.status === 403 && np.code === "PERMISSION_DENIED", `${np.status} ${np.code ?? ""}`);
  const ro = await get(url(`from=${today}&to=${today}`), tkRoll);
  const roD = ro.data as { yarnLots?: unknown; warpBeams?: unknown; omitted?: Array<{ kind: string; reason: string }> } | undefined;
  check("§5g yalnız `roll:read`: iplik/levent bölümü null + omitted PERMISSION_DENIED (veri gövdeye girmez)",
    ro.status === 200 && roD?.yarnLots === null && roD?.warpBeams === null && roD?.omitted?.length === 2 && roD.omitted.every((o) => o.reason === "PERMISSION_DENIED") && !JSON.stringify(ro.data).includes(`${TAG}-LA`),
    JSON.stringify(roD?.omitted));
  await setSetting(SETTING_KEYS.IPLIK_ENABLED, false);
  const mo = await get(url(`from=${today}&to=${today}`), tkFull);
  const moD = mo.data as { yarnLots?: unknown; omitted?: Array<{ kind: string; reason: string }> } | undefined;
  check("§5h iplik modülü kapalı: iplik bölümü null + omitted MODULE_DISABLED", mo.status === 200 && moD?.yarnLots === null && !!moD?.omitted?.some((o) => o.kind === "YARN_LOT" && o.reason === "MODULE_DISABLED"), JSON.stringify(moD?.omitted));
  await setSetting(SETTING_KEYS.EMANET_ENABLED, false);
  const off = await get(url(`from=${today}&to=${today}`), tkFull);
  check("§5i ⭐ emanet kapalı → 403 MODULE_DISABLED", off.status === 403 && off.code === "MODULE_DISABLED", `${off.status} ${off.code ?? ""}`);
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const dispIds = (await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: made.wos } }, select: { id: true } })).map((x) => x.id);
  const dsIds = (await prisma.directShipment.findMany({ where: { dispatchId: { in: dispIds } }, select: { id: true } })).map((x) => x.id);
  // DSK kısmi bölme çocuk top doğurabilir — A'nın bütün TEST topları süpürülür.
  const rollIds = [...new Set([...made.rolls, ...(await prisma.roll.findMany({ where: { ownerCustomerId: { in: made.customers } }, select: { id: true } })).map((r) => r.id)])];
  const shipIds = [...new Set([...made.shipments, ...(await prisma.shipment.findMany({ where: { customerId: { in: made.customers } }, select: { id: true } })).map((s) => s.id)])];
  const sackIds = (await prisma.sack.findMany({ where: { OR: [{ shipmentId: { in: shipIds } }, { rolls: { some: { id: { in: rollIds } } } }] }, select: { id: true } })).map((s) => s.id);
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } }).catch(swallow);
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipIds } } }).catch(swallow);
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...shipIds, ...dsIds] } } }).catch(swallow);
  await prisma.rollReturn.deleteMany({ where: { OR: [{ fromShipmentId: { in: shipIds } }, { rollId: { in: rollIds } }] } }).catch(swallow);
  await prisma.subcontractorDirectShipAllocation.deleteMany({ where: { dispatchId: { in: dispIds } } }).catch(swallow);
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null, directShipmentId: null } });
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "warehouseMovement", "rollVariance", "rollStatusEvent"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(swallow);
  }
  await prisma.subcontractorReceiptItem.deleteMany({ where: { receipt: { workOrderId: { in: made.wos } } } }).catch(swallow);
  await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispIds } } }).catch(swallow);
  await prisma.roll.updateMany({ where: { parentRollId: { in: rollIds } }, data: { parentRollId: null } }).catch(swallow);
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.directShipment.deleteMany({ where: { id: { in: dsIds } } }).catch(swallow);
  await prisma.subcontractorReceipt.deleteMany({ where: { workOrderId: { in: made.wos } } }).catch(swallow);
  await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispIds } } }).catch(swallow);
  await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipIds } } }).catch(swallow);
  await prisma.shipment.deleteMany({ where: { id: { in: shipIds } } });
  await prisma.sack.deleteMany({ where: { id: { in: sackIds } } }).catch(swallow);
  await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: made.wos } } }).catch(swallow);
  await prisma.batch.deleteMany({ where: { workOrderId: { in: made.wos } } }).catch(swallow);
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: made.wos } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: made.wos } } });
  await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: made.beams } } });
  await prisma.yarnMovement.deleteMany({ where: { itemId: { in: made.items } } });
  await prisma.yarnStock.deleteMany({ where: { itemId: { in: made.items } } });
  await prisma.warpBeam.deleteMany({ where: { id: { in: made.beams } } });
  await prisma.yarnLot.deleteMany({ where: { id: { in: made.lots } } });
  await prisma.warpSpec.deleteMany({ where: { id: { in: made.specs } } });
  await prisma.machine.deleteMany({ where: { id: { in: made.machines } } });
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } });
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...made.beams, ...made.lots, ...shipIds] } } }).catch(swallow);
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.updateMany({ where: { id: { in: made.users } }, data: { isActive: false } }).catch(swallow);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== EMANET EKSTRESİ BEKÇİSİ (F2) ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTINGS] } }, select: { key: true, value: true } });
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
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

void main();
