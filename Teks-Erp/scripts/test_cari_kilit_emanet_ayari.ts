// =============================================================================
// BEKÇİ — KİLİTLİ CARİDE EMANET SEVKİ AYARI (D4-I1c, S11; tasarım DALGA4 K22 · §10.5 md. 6)
// =============================================================================
//   §0 statik — kod sabiti `CARI_HOLD_EMANET_SHIPMENT` yok; "işlenmiş" yüklemi (Roll where'inde `meterReadings`
//      süzgeci) ve ayar okuması yalnız `helpers/emanet-shipment.helper.ts`te; `rollsAllOwnedByTx` yalnız oradan
//      çağrılır (kilit + risk kapısı kararı aynı fonksiyondan alır); üç sevk boğazı kararı o helper'dan verir
//   §1 ayar — kayıt yokken EXEMPT (bugünkü); tanınmayan değer 400; geçerli değer yazılır
//   §2 EXEMPT — emanet (işlenmiş dahil) kilitli caride geçer, karışık sevk 409 (D4-I1b ile aynı)
//   §3 PROCESSED_HELD — işlenmemiş emanet geçer; işlem izi / tambur parçası olan emanet 409 CARI_HOLD + details.heldRolls;
//      geri alınmış iz işlenmiş SAYILMAZ; önizleme warnings[] + cariHold.heldRolls; PLANNED dispatch 409
//   §4 ALL_HELD — her emanet sevk 409 (tutulan toplar listede); kilit açılınca geçer
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31): ① `PROCESSED_ROLL_WHERE` `NOT:` ile ters çevrildi → §3a/§3b/§3c ❌;
//    ② `shipping.service`e `meterReadings: { some: {} }` süzgeçli ikinci yüklem eklendi → §0b ❌. Geri alındı → yeşil.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Ayarlar fotoğrafa döner; olumlu yollar GERİ SARILAN tx'te koşar.
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { firstGrade } from "./fixture-quality-grade";
import { SETTING_KEYS, systemSettingService, readFinanceCariHoldEmanetShipment } from "../src/services/system-setting.service";
import { customerService } from "../src/routes/customer.routes";
import { shippingService } from "../src/services/shipping.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
type Hata = { statusCode?: number; details?: { code?: string; heldRolls?: { barcode: string | null; reason: string }[]; emanetShipment?: string } };
class Rollback extends Error {}
/** Olumlu yol geri sarılır: "GEÇTİ" ya da hata nesnesi. */
async function geriSarilan(fn: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<"GEÇTİ" | Hata> {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    }, { timeout: 60_000 });
    return { details: { code: "yazdı?!" } };
  } catch (e) {
    return e instanceof Rollback ? "GEÇTİ" : (e as Hata);
  }
}
const kod = (r: "GEÇTİ" | Hata): string => (r === "GEÇTİ" ? r : String(r.details?.code ?? r.statusCode ?? "?"));
const tutulan = (r: "GEÇTİ" | Hata): string[] => (r === "GEÇTİ" ? [] : (r.details?.heldRolls ?? []).map((h) => h.barcode ?? "?"));

const SRC = path.resolve(__dirname, "..", "src");
const HELPER = "services/helpers/emanet-shipment.helper.ts";
const TAG = `TEST-CKE-${process.pid}`;
const AYARLAR = [SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.FINANCE_CARI_HOLD_EMANET_SHIPMENT];

function tsDosyalari(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? tsDosyalari(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/** Dosyadaki `meterReadings: { some: … }` süzgeçleri — "işlenmiş" yükleminin imzası (top where'inde ölçüm izi). */
function olcumSuzgeciSay(src: string): number {
  const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true);
  let n = 0;
  const gez = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText(sf) === "meterReadings" && ts.isObjectLiteralExpression(node.initializer)) {
      if (node.initializer.properties.some((p) => p.name?.getText(sf) === "some")) n++;
    }
    ts.forEachChild(node, gez);
  };
  gez(sf);
  return n;
}

function statik(): void {
  console.log("── §0 Statik ──");
  const dosyalar = tsDosyalari(SRC).map((f) => ({ rel: path.relative(SRC, f), src: readFileSync(f, "utf8") }));
  const sabit = dosyalar.filter((d) => /\bCARI_HOLD_EMANET_SHIPMENT\b/.test(d.src)).map((d) => d.rel);
  check("§0a kod sabiti CARI_HOLD_EMANET_SHIPMENT kaynakta yok (karar ayardan)", sabit.length === 0, sabit.join(", ") || "temiz");
  const yuklem = dosyalar.filter((d) => olcumSuzgeciSay(d.src) > 0).map((d) => d.rel);
  check("§0b ⭐ 'işlenmiş' yüklemi (meterReadings.some süzgeci) yalnız emanet-shipment.helper'da", JSON.stringify(yuklem) === JSON.stringify([HELPER]), yuklem.join(", "));
  const okuyan = dosyalar.filter((d) => /readFinanceCariHoldEmanetShipment\(/.test(d.src)).map((d) => d.rel).sort();
  check("§0c ayar okuması yalnız helper + ayar servisi (getFeatureFlags)", JSON.stringify(okuyan) === JSON.stringify([HELPER, "services/system-setting.service.ts"]), okuyan.join(", "));
  const sahip = dosyalar.filter((d) => /rollsAllOwnedByTx\(/.test(d.src)).map((d) => d.rel).sort();
  check("§0d rollsAllOwnedByTx yalnız emanet-owner (tanım) + emanet-shipment (karar) — kilit ve risk kapısı kopya kurmaz", JSON.stringify(sahip) === JSON.stringify(["services/helpers/emanet-owner.helper.ts", HELPER]), sahip.join(", "));
  const ship = dosyalar.find((d) => d.rel === "services/shipping.service.ts")?.src ?? "";
  check("§0e üç sevk boğazı (core · önizleme · dispatch) kararı emanetShipmentReleaseTx'ten alır", (ship.match(/emanetShipmentReleaseTx\(/g) ?? []).length >= 3);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== KİLİTLİ CARİDE EMANET SEVKİ AYARI BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const ayar = (key: string, v: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  const admin = await ensureTestAdmin();
  const ids = { customers: [] as string[], items: [] as string[], rolls: [] as string[], sacks: [] as string[], shipments: [] as string[], wos: [] as string[], stations: [] as string[] };
  try {
    await ayar(SETTING_KEYS.FINANCE_ENABLED, true);
    await ayar(SETTING_KEYS.EMANET_ENABLED, true);

    // ── §1 Ayar ──
    console.log("\n── §1 Ayar ──");
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FINANCE_CARI_HOLD_EMANET_SHIPMENT } });
    check("§1a kayıt yokken EXEMPT (bugünkü davranış)", (await readFinanceCariHoldEmanetShipment()) === "EXEMPT");
    let e1b: Hata | null = null;
    try {
      await systemSettingService.setFeatureFlags({ financeCariHoldEmanetShipment: "BLOCK" as never }, admin.id);
    } catch (e) {
      e1b = e as Hata;
    }
    check("§1b tanınmayan değer → 400", e1b?.statusCode === 400, String(e1b?.statusCode));
    await systemSettingService.setFeatureFlags({ financeCariHoldEmanetShipment: "ALL_HELD" }, admin.id);
    check("§1c geçerli değer yazılır ve okunur", (await readFinanceCariHoldEmanetShipment()) === "ALL_HELD");
    check("§1d getFeatureFlags alanı taşır", (await systemSettingService.getFeatureFlags()).data?.financeCariHoldEmanetShipment === "ALL_HELD");
    const mod = (v: "EXEMPT" | "PROCESSED_HELD" | "ALL_HELD") => ayar(SETTING_KEYS.FINANCE_CARI_HOLD_EMANET_SHIPMENT, v);

    // ── Fikstür ──
    const r = (await customerService.create({ name: `${TAG} A`, isCustomerRole: true }, admin.id)) as { data: { id: string } };
    ids.customers.push(r.data.id);
    const A = { customerId: r.data.id, cariId: (await prisma.cariAccount.findFirstOrThrow({ where: { customerId: r.data.id }, select: { id: true } })).id };
    const item = await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} perde`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    ids.items.push(item.id);
    const st = await prisma.station.create({ data: { code: `CKE${process.pid}`.slice(0, 32), name: `${TAG} kurşun`, type: "INTERNAL" }, select: { id: true } });
    ids.stations.push(st.id);
    const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-IE` }, select: { id: true } });
    ids.wos.push(wo.id);
    const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: st.id, stepSequence: 1 }, select: { id: true } });
    const wh = await fixtureWarehouseId();
    const grade = await firstGrade();
    const top = async (ek: string, data: Partial<Prisma.RollUncheckedCreateInput> = {}) => {
      const t = await prisma.roll.create({ data: { barcode: `${TAG}-${ek}`, itemId: item.id, initialQty: 50, currentQty: 50, qualityGrade: grade.code, qualityGradeId: grade.id, width: 150, status: RollStatus.WAREHOUSE, entrySource: "SUPPLIER_RECEIPT", warehouseId: wh, ownerCustomerId: A.customerId, ...data }, select: { id: true } });
      ids.rolls.push(t.id);
      return t.id;
    };
    const cuval = async (rolls: string[]) => {
      const s = await prisma.sack.create({ data: { sackNo: `${TAG}-S${ids.sacks.length}`, seq: 1 }, select: { id: true } });
      ids.sacks.push(s.id);
      await prisma.roll.updateMany({ where: { id: { in: rolls } }, data: { sackId: s.id } });
      return s.id;
    };
    const ham = await cuval([await top("HAM1"), await top("HAM2")]);
    const islenmis = await top("ISL");
    await prisma.rollOperation.create({ data: { rollId: islenmis, workOrderStepId: step.id, operationType: "KURSUN_APPLIED", operatorId: admin.id } });
    const geriAlinan = await top("GERI");
    await prisma.rollOperation.create({ data: { rollId: geriAlinan, workOrderStepId: step.id, operationType: "KURSUN_APPLIED", revokedAt: new Date(), revokeReason: TAG } });
    const ata = await top("ATA");
    const parca = await top("PARCA", { entrySource: "TAMBUR_SPLIT", parentRollId: ata });
    const karisikIslenmis = await cuval([await top("HAM3"), islenmis]);
    const geriAlinmis = await cuval([geriAlinan]);
    const tamburParca = await cuval([parca]);
    const karisik = await cuval([await top("HAM4"), await top("FAB", { ownerCustomerId: null })]);

    const svc = shippingService as unknown as {
      createShipmentCoreTx(tx: Prisma.TransactionClient, p: Record<string, unknown>): Promise<{ id: string }>;
      performDispatchTx(tx: Prisma.TransactionClient, id: string, d: Record<string, unknown>, u?: string): Promise<unknown>;
    };
    const core = (tx: Prisma.TransactionClient, sackId: string, anindaSevk = true) =>
      svc.createShipmentCoreTx(tx, { sackIds: [sackId], customerId: A.customerId, branchId: null, orderIds: [], orderless: true, assertDestination: () => undefined, confirmationEnabled: !anindaSevk, userId: admin.id });
    const sevk = (sackId: string) => geriSarilan((tx) => core(tx, sackId));
    type Onizleme = { data: { warnings: string[]; cariHold: { holdId: string; exempt?: boolean; emanetShipment?: string; heldRolls?: { barcode: string | null }[] } | null } };
    const onizle = async (sackId: string) => ((await shippingService.previewCreateShipment({ sackIds: [sackId], customerId: A.customerId })) as Onizleme).data;
    // PLANNED: kilitten ÖNCE kurulan işlenmiş emanet sevkiyatı (dispatch boğazı için).
    const planli = await prisma.$transaction((tx) => core(tx, karisikIslenmis, false), { timeout: 60_000 });
    ids.shipments.push(planli.id);
    await prisma.cariHold.create({ data: { cariId: A.cariId, blocksIntake: false, blocksShipment: true, blocksInvoice: false, reasonCode: "BORC", reasonText: TAG, placedById: admin.id, clientToken: randomUUID() } });

    // ── §2 EXEMPT ──
    console.log("\n── §2 EXEMPT (varsayılan) ──");
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FINANCE_CARI_HOLD_EMANET_SHIPMENT } });
    check("§2a işlenmemiş emanet geçer", kod(await sevk(ham)) === "GEÇTİ");
    check("§2b işlenmiş emanet de geçer (bugünkü K22)", kod(await sevk(tamburParca)) === "GEÇTİ");
    const k2c = await sevk(karisik);
    check("§2c karışık sevk 409 CARI_HOLD, heldRolls YOK (D4-I1b details'ı aynı)", kod(k2c) === "CARI_HOLD" && k2c !== "GEÇTİ" && k2c.details?.heldRolls === undefined, kod(k2c));
    const p2 = await onizle(tamburParca);
    check("§2d önizleme: exempt=true, emanetShipment alanı YOK (bayt-aynı)", p2.cariHold?.exempt === true && p2.cariHold.emanetShipment === undefined, JSON.stringify(p2.cariHold));

    // ── §3 PROCESSED_HELD ──
    console.log("\n── §3 PROCESSED_HELD ──");
    await mod("PROCESSED_HELD");
    const k3a = await sevk(karisikIslenmis);
    check("§3a ⭐ işlem izli emanet top → 409 CARI_HOLD, details.heldRolls yalnız işlenmiş top", kod(k3a) === "CARI_HOLD" && JSON.stringify(tutulan(k3a)) === JSON.stringify([`${TAG}-ISL`]), `${kod(k3a)} ${tutulan(k3a)}`);
    const k3b = await sevk(tamburParca);
    check("§3b ⭐ tambur parçası (işlemden doğmuş) → 409, heldRolls PARCA", kod(k3b) === "CARI_HOLD" && JSON.stringify(tutulan(k3b)) === JSON.stringify([`${TAG}-PARCA`]), `${kod(k3b)} ${tutulan(k3b)}`);
    check("§3c ⭐ işlenmemiş emanet geçer (iade edilebilir)", kod(await sevk(ham)) === "GEÇTİ");
    check("§3d geri alınmış işlem izi işlenmiş SAYILMAZ → geçer", kod(await sevk(geriAlinmis)) === "GEÇTİ");
    check("§3e karışık sevk yine 409 (heldRolls yok)", kod(await sevk(karisik)) === "CARI_HOLD");
    const p3 = await onizle(karisikIslenmis);
    check("§3f önizleme: cariHold.heldRolls + warnings[] tutulan barkodu söyler", p3.cariHold?.heldRolls?.[0]?.barcode === `${TAG}-ISL` && p3.warnings.some((w) => w.includes(`${TAG}-ISL`) && /işlenmiş/.test(w)), JSON.stringify(p3.cariHold));
    const p3g = await onizle(ham);
    check("§3g önizleme işlenmemiş: exempt + 'hiçbiri işlenmemiş' uyarısı", p3g.cariHold?.exempt === true && p3g.warnings.some((w) => /işlenmemiş/.test(w)), JSON.stringify(p3g.warnings));
    const d3 = await geriSarilan((tx) => svc.performDispatchTx(tx, planli.id, {}, admin.id));
    check("§3h ⭐ PLANNED işlenmiş emanet sevkiyatı dispatch → 409, tutulan top listede", kod(d3) === "CARI_HOLD" && tutulan(d3).includes(`${TAG}-ISL`), `${kod(d3)} ${tutulan(d3)}`);

    // ── §4 ALL_HELD ──
    console.log("\n── §4 ALL_HELD ──");
    await mod("ALL_HELD");
    const k4a = await sevk(ham);
    check("§4a ⭐ işlenmemiş emanet de 409, iki top da listede", kod(k4a) === "CARI_HOLD" && tutulan(k4a).length === 2 && k4a !== "GEÇTİ" && k4a.details?.emanetShipment === "ALL_HELD", `${kod(k4a)} ${tutulan(k4a)}`);
    check("§4b geri alınmış izli emanet de 409", kod(await sevk(geriAlinmis)) === "CARI_HOLD");
    await prisma.cariHold.updateMany({ where: { cariId: A.cariId, releasedAt: null }, data: { releasedAt: new Date(), releasedById: admin.id, releaseReason: TAG } });
    check("§4c kilit açılınca emanet serbest", kod(await sevk(ham)) === "GEÇTİ" && kod(await sevk(tamburParca)) === "GEÇTİ");
  } finally {
    await temizle(ids).catch((e) => {
      fail++;
      console.log(`❌ temizlik — ${String(e).slice(0, 300)}`);
    });
    for (const key of AYARLAR) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(ids: { customers: string[]; items: string[]; rolls: string[]; sacks: string[]; shipments: string[]; wos: string[]; stations: string[] }): Promise<void> {
  const accIds = (await prisma.cariAccount.findMany({ where: { customerId: { in: ids.customers } }, select: { id: true } })).map((a) => a.id);
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.rolls, ...ids.shipments, ...ids.sacks, ...ids.customers, ...accIds] } } });
  await prisma.roll.updateMany({ where: { id: { in: ids.rolls } }, data: { shipmentId: null, sackId: null, parentRollId: null } });
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: ids.sacks } } });
  await prisma.sack.updateMany({ where: { id: { in: ids.sacks } }, data: { shipmentId: null } });
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: ids.shipments } } });
  await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: ids.shipments } } });
  await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
  await prisma.sack.deleteMany({ where: { id: { in: ids.sacks } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids.rolls } } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids.rolls } } });
  await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: ids.wos } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: ids.wos } } });
  await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
  await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
  await prisma.cariHold.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exitCode = 1;
});
