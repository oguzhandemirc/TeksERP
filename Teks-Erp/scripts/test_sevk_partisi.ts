// =============================================================================
// Test: SEVK PARTİSİ (`packing.groupMode = sevk-partisi`) — yaşam döngüsü · ambalaj no ·
//       sevk bağı · grup modunda değişmezlik
// Çalıştır: DATABASE_URL=… npx tsx scripts/run-all-tests.ts test_sevk_partisi
// Tasarım: docs/design/SEVK-PARTISI-TASARIM.md
//
// Doğrulananlar:
//   §1 (DB'siz) "canlı grup" yüklemi TEK KAYNAK: `sacks: { some: { shipmentId: null } }` literali
//      yalnız helper'da; servisler `liveGroupWhere(mode)`den geçer
//   §2 (DB'siz) 8033 `PACKAGE_NO_LOCK_NS` envanterde; `bosluk-doldur` dalında kilit ilk ifade
//   §3 GRUP MODUNDA (varsayılan) parti uçları kapalı: openSack+packingGroupId 400 · close 400 ·
//      boş grup 400 · liste `status` süzgeci 400 — davranış bayt bayt eski (negatif sonda)
//   §4 Boş parti doğar ve YAŞAR (OPEN · listede · nextPackageNo = 1); eski grup P1 sayaçta sayılır → SP-2
//   §5 Çuval partide doğar: openSack({packingGroupId}) → 1, 2, 3; cari partinin carisi
//   §6 Ezme: packageNo:10 → sayaç 11'e sıçrar; aynı numara 409 PACKAGE_NO_TAKEN; setPackageNo;
//      mod `otomatik` → ezme 400
//   §7 Mod `elle`: numarasız 400, numaralı OK
//   §8 `packageNoStartsAtZero`: yeni parti 0'dan başlar
//   §9 `artan`: partiden çıkan çuvalın numarası GERİ VERİLMEZ; `bosluk-doldur`: en küçük boş
//  §10 Transfer (addSacks başka partiye): hedefte yeni numara, kaynakta boşluk; zaten üye → 409
//  §11 Kapat / yeniden aç: CLOSED listeden düşer, kapalıya çuval 409, reopen; iki kez kapat 409;
//      `closedAt` yeniden açılınca NULL'LANMAZ
//  §12 Sil: boş parti silinir; çuvalı olan 409 PACKING_LOT_NOT_EMPTY
//  §13 Parti sırası KAPALI partilere de bakar (hepsi kapalıyken yeni parti en büyük+1, 1 değil)
//  §14 Kısmi sevk: alt küme sevk edilir, çuval partide numarasıyla KALIR, parti OPEN;
//      `lotPartialDispatch=false` → alt küme 400 PACKING_LOT_WHOLE, tam küme OK
//  §15 `lotAutoClose`: son açık çuval gidince CLOSED; planlı sevk iptali çuvalı geri getirince OPEN
//  §16 Eşzamanlı sayaç: iki paralel tx `reservePackageNosTx(artan)` → farklı numaralar
//  §17 DB unique: aynı partide aynı packageNo → P2002 (son sed)
//  §18 `lotRequired`: partisiz açma 400 PACKING_LOT_REQUIRED, partide OK
//
// ⭐ NEGATİF SONDA (2026-09-21, ölçüldü):
//   (a) `reservePackageNosTx` artan dalı `RETURNING` yerine `findFirst max+1` yapıldı → §16 KIRMIZI
//   (b) `claimSacksIntoGroupTx`in numaralama bloğu (`reservePackageNosTx` + döngü) kapatıldı → §10 KIRMIZI
//       (transfer/havuzdan-al numara vermedi; yalnız `packageNo: null` düşürmek ISIRMAZ — döngü ezer, ölçüldü)
//   (c) `autoCloseLotsForSacksTx` `enabled` kapısı kaldırıldı → §14 KIRMIZI (parti kapanmamalıyken kapandı)
//   (d) `nextPackingGroupSeqTx` lot dalı silindi → §13 KIRMIZI
//   (e) `openSack` lot kapısında `PACKING_LOT_MODE_OFF` dalı silindi → §3 KIRMIZI
//   Hepsi geri alındığında yeşil.
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { Prisma } from "@prisma/client";

import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { PackingGroupService } from "../src/services/packing-group.service";
import { PackingLotService } from "../src/services/packing-lot.service";
import { PACKAGE_NO_LOCK_NS, reservePackageNosTx } from "../src/services/helpers/packing-group.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { ShippingService } from "../src/services/shipping.service";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { firstGrade } from "./fixture-quality-grade";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

const ship = new ShippingService();
const TS = Date.now();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function expectErr(label: string, fn: () => Promise<unknown>, status: number, code?: string): Promise<void> {
  let got: { status: number; code: string | undefined } | null = null;
  try { await fn(); } catch (e) {
    got = e instanceof AppError
      ? { status: e.statusCode, code: (e.details as { code?: string } | undefined)?.code }
      : { status: -1, code: undefined };
  }
  const ok = got !== null && got.status === status && (code === undefined || got.code === code);
  check(label, ok, `beklenen ${status}${code ? `/${code}` : ""}, gelen ${got ? `${got.status}/${got.code ?? "-"}` : "(hata YOK)"}`);
}

const prevFlags = new Map<string, Prisma.InputJsonValue | undefined>();
async function setFlag(key: string, value: Prisma.InputJsonValue | null): Promise<void> {
  if (!prevFlags.has(key)) {
    const cur = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
    prevFlags.set(key, cur ? (cur.value as Prisma.InputJsonValue) : undefined);
  }
  if (value === null) { await prisma.systemSetting.deleteMany({ where: { key } }); return; }
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value, description: "test_sevk_partisi" },
    update: { value },
  });
}

const sackIds: string[] = [];
const rollIds: string[] = [];
const shipmentIds: string[] = [];
let customerId = "";
let itemId = "";
let colorId = "";
let rollN = 0;

type SackDto = { id: string; sackNo: string; customerId: string | null; packingGroupId: string | null; packageNo: number | null };
async function openIn(groupId: string | null, packageNo?: number | null): Promise<SackDto> {
  const res = await ship.openSack({ packingGroupId: groupId, packageNo: packageNo ?? null, customerId: groupId ? null : customerId });
  const s = res.data as SackDto;
  sackIds.push(s.id);
  return s;
}
async function fillSack(sackId: string): Promise<void> {
  rollN += 1;
  const grade = await firstGrade();
  const r = await prisma.roll.create({
    data: {
      warehouseId: await fixtureWarehouseId(),
      barcode: `TEST-SP-R${rollN}-${TS}`,
      itemId, colorId,
      status: "WAREHOUSE",
      currentQty: 50, initialQty: 50, width: 150,
      qualityGrade: grade.code,
      qualityGradeId: grade.id,
      entrySource: "SUPPLIER_RECEIPT",
      sackId,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
}
async function readSack(id: string) {
  return prisma.sack.findUniqueOrThrow({ where: { id }, select: { packingGroupId: true, packageNo: true, shipmentId: true, customerId: true } });
}
async function readGroup(id: string) {
  return prisma.packingGroup.findUniqueOrThrow({ where: { id }, select: { status: true, closedAt: true, nextPackageNo: true, seq: true, name: true } });
}
type GroupDto = { id: string; name: string; seq: number | null; status: string; nextPackageNo: number; sackCount: number; shippedSackCount: number };
async function createLot(name?: string): Promise<GroupDto> {
  const r = await PackingGroupService.createWithSacks({ customerId, sackIds: [], name });
  return r.data as GroupDto;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

async function main(): Promise<void> {
  // ---- §1 + §2: kaynak metni (DB'siz) --------------------------------------
  const SRC = join(__dirname, "../src");
  const helperPath = join(SRC, "services/helpers/packing-group.helper.ts");
  const literal = /sacks:\s*\{\s*some:\s*\{\s*shipmentId:\s*null\s*\}\s*\}/;
  const kopyalar = walk(join(SRC, "services"))
    .filter((p) => p !== helperPath && literal.test(readFileSync(p, "utf-8")))
    .map((p) => p.slice(SRC.length + 1));
  check("§1 ⭐ canlı-grup literali yalnız helper'da (servislerde kopya yok)", kopyalar.length === 0, kopyalar.join(", ") || "temiz");
  const helperSrc = readFileSync(helperPath, "utf-8");
  check("§1 `liveGroupWhere(mode)` helper'da tanımlı", /export function liveGroupWhere\(/.test(helperSrc));
  const svcSrc = readFileSync(join(SRC, "services/packing-group.service.ts"), "utf-8");
  check("§1 servis LIVE_GROUP_WHERE'i doğrudan kullanmaz", !/\bLIVE_GROUP_WHERE\b/.test(svcSrc));

  check("§2 uzay 8033", PACKAGE_NO_LOCK_NS === 8033, String(PACKAGE_NO_LOCK_NS));
  const envanter = readFileSync(join(SRC, "services/helpers/period-guard.helper.ts"), "utf-8");
  check("§2 envanterde yazılı", /\/\/\s+8033\s+PACKAGE_NO_LOCK_NS/.test(envanter));
  const reserveStart = helperSrc.indexOf("export async function reservePackageNosTx");
  const reserveBody = helperSrc.slice(reserveStart, helperSrc.indexOf("\nexport ", reserveStart + 1));
  check("§2 `bosluk-doldur` dalında kilit okumadan ÖNCE", reserveBody.indexOf("pg_advisory_xact_lock") !== -1
    && reserveBody.indexOf("pg_advisory_xact_lock") < reserveBody.indexOf("tx.sack.findMany"));

  // ---- fixture --------------------------------------------------------------
  const c1 = await prisma.customer.create({
    data: { code: `TST-SP-${TS}`, name: `SEVK PARTİSİ TEST ${TS}` }, select: { id: true },
  });
  customerId = c1.id;
  const item = await prisma.item.create({
    data: { code: `TST-SP-I-${TS}`, name: `SP KUMAŞ ${TS}`, itemType: "FABRIC", unit: "MT" }, select: { id: true },
  });
  itemId = item.id;
  const color = await prisma.color.create({ data: { code: `TST-SP-C-${TS}`, name: `SP EKRU ${TS}` }, select: { id: true } });
  colorId = color.id;

  try {
    await setFlag(SETTING_KEYS.PACKING_GROUPS_ENABLE, "true");
    await setFlag(SETTING_KEYS.PACKING_GROUP_NUMBERING, "artan");
    await setFlag(SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, "true"); // sevk PLANNED kalsın (iptal edilebilsin)
    await setFlag(SETTING_KEYS.SHIPPING_ORDER_REQUIREMENT, "off");
    await setFlag(SETTING_KEYS.PACKAGE_NO_MODE, "otomatik-ezilebilir");
    await setFlag(SETTING_KEYS.PACKAGE_NUMBERING, "artan");
    await setFlag(SETTING_KEYS.PACKAGE_NO_STARTS_AT_ZERO, "false");
    await setFlag(SETTING_KEYS.PACKING_LOT_AUTO_CLOSE, "false");
    await setFlag(SETTING_KEYS.PACKING_LOT_REQUIRED, "false");
    await setFlag(SETTING_KEYS.PACKING_LOT_PARTIAL_DISPATCH, "true");

    // ---- §3: GRUP MODU — parti uçları kapalı, davranış eski --------------------
    await setFlag(SETTING_KEYS.PACKING_GROUP_MODE, "grup");
    await expectErr("§3 grup modunda boş grup 400", () => PackingGroupService.createWithSacks({ customerId, sackIds: [] }), 400);
    const sGrup = await openIn(null);
    const gGrup = (await PackingGroupService.createWithSacks({ customerId, sackIds: [sGrup.id] })).data as GroupDto;
    check("§3 grup modunda ad P1, packageNo NULL, status OPEN (okunmaz)", gGrup.name === "P1" && (await readSack(sGrup.id)).packageNo === null && gGrup.status === "OPEN");
    await expectErr("§3 ⭐ grup modunda openSack+packingGroupId 400 PACKING_LOT_MODE_OFF",
      () => ship.openSack({ packingGroupId: gGrup.id }), 400, "PACKING_LOT_MODE_OFF");
    await expectErr("§3 grup modunda close 400", () => PackingLotService.close(gGrup.id), 400, "PACKING_LOT_MODE_OFF");
    await expectErr("§3 grup modunda liste status=CLOSED 400", () => PackingGroupService.list(customerId, { status: "CLOSED" }), 400);
    await prisma.sack.update({ where: { id: sGrup.id }, data: { packingGroupId: null } });

    // ---- §4: parti modu — boş parti -------------------------------------------
    await setFlag(SETTING_KEYS.PACKING_GROUP_MODE, "sevk-partisi");
    const p1 = await createLot();
    // Grup modundan kalan P1 (seq 1) sayılır → ilk parti SP-2 (geçiş kuralı: eski gruplar parti sayılır).
    check("§4 boş parti SP-2 · OPEN · nextPackageNo 1", p1.name === "SP-2" && p1.seq === 2 && p1.status === "OPEN" && p1.nextPackageNo === 1, `${p1.name}/${p1.status}/${p1.nextPackageNo}`);
    const l1 = (await PackingGroupService.list(customerId)).data ?? [];
    check("§4 ⭐ boş parti listede (yaşıyor)", l1.some((g) => g.id === p1.id));
    // Grup modundan kalan P1 (çuvalsız) da parti listesinde OPEN görünür — geçiş kuralı (§7 belge).
    check("§4 eski grup OPEN parti sayılır", l1.some((g) => g.id === gGrup.id));

    // ---- §5: çuval partide doğar ---------------------------------------------
    const a1 = await openIn(p1.id);
    const a2 = await openIn(p1.id);
    const a3 = await openIn(p1.id);
    check("§5 ambalaj no 1, 2, 3", a1.packageNo === 1 && a2.packageNo === 2 && a3.packageNo === 3, `${a1.packageNo}/${a2.packageNo}/${a3.packageNo}`);
    check("§5 cari partinin carisi + üyelik", a1.customerId === customerId && a1.packingGroupId === p1.id);
    check("§5 sayaç 4'te", (await readGroup(p1.id)).nextPackageNo === 4);

    // ---- §6: ezme -------------------------------------------------------------
    const a10 = await openIn(p1.id, 10);
    check("§6 ezme 10", a10.packageNo === 10);
    const a11 = await openIn(p1.id);
    check("§6 ⭐ sayaç 11'e sıçradı (GREATEST)", a11.packageNo === 11, String(a11.packageNo));
    await expectErr("§6 aynı numara 409 PACKAGE_NO_TAKEN", () => ship.openSack({ packingGroupId: p1.id, packageNo: 10 }), 409, "PACKAGE_NO_TAKEN");
    const set = await PackingLotService.setPackageNo(a3.id, 20);
    check("§6 setPackageNo 20", set.data?.packageNo === 20 && (await readSack(a3.id)).packageNo === 20);
    await expectErr("§6 setPackageNo dolu numara 409", () => PackingLotService.setPackageNo(a3.id, 10), 409, "PACKAGE_NO_TAKEN");
    await setFlag(SETTING_KEYS.PACKAGE_NO_MODE, "otomatik");
    await expectErr("§6 mod otomatik → ezme 400", () => ship.openSack({ packingGroupId: p1.id, packageNo: 30 }), 400);
    await expectErr("§6 mod otomatik → setPackageNo 400", () => PackingLotService.setPackageNo(a3.id, 31), 400);

    // ---- §7: elle -------------------------------------------------------------
    await setFlag(SETTING_KEYS.PACKAGE_NO_MODE, "elle");
    await expectErr("§7 elle mod numarasız 400", () => ship.openSack({ packingGroupId: p1.id }), 400);
    const e40 = await openIn(p1.id, 40);
    check("§7 elle mod numaralı OK", e40.packageNo === 40);
    await setFlag(SETTING_KEYS.PACKAGE_NO_MODE, "otomatik-ezilebilir");

    // ---- §8: 0'dan başla --------------------------------------------------------
    await setFlag(SETTING_KEYS.PACKAGE_NO_STARTS_AT_ZERO, "true");
    const p0 = await createLot();
    const z0 = await openIn(p0.id);
    check("§8 ⭐ 0'dan başlayan parti: ilk çuval 0", p0.nextPackageNo === 0 && z0.packageNo === 0, `${p0.nextPackageNo}/${z0.packageNo}`);
    await setFlag(SETTING_KEYS.PACKAGE_NO_STARTS_AT_ZERO, "false");

    // ---- §9: artan / bosluk-doldur ---------------------------------------------
    await PackingGroupService.removeSacks([a2.id]);
    check("§9 partiden çıkan çuval: packingGroupId+packageNo NULL", (await readSack(a2.id)).packingGroupId === null && (await readSack(a2.id)).packageNo === null);
    const a41 = await openIn(p1.id);
    check("§9 ⭐ artan: 2 geri verilmedi (41 alındı)", a41.packageNo === 41, String(a41.packageNo));
    await setFlag(SETTING_KEYS.PACKAGE_NUMBERING, "bosluk-doldur");
    const b2 = await openIn(p1.id);
    check("§9 ⭐ bosluk-doldur: en küçük boş (2)", b2.packageNo === 2, String(b2.packageNo));
    await setFlag(SETTING_KEYS.PACKAGE_NUMBERING, "artan");

    // ---- §10: transfer ---------------------------------------------------------
    const p2 = await createLot();
    await PackingGroupService.addSacks(p2.id, [a10.id]);
    const t = await readSack(a10.id);
    check("§10 ⭐ transfer: hedefte yeni numara 1, üyelik p2", t.packingGroupId === p2.id && t.packageNo === 1, `${t.packageNo}`);
    const a42 = await openIn(p1.id);
    check("§10 kaynakta boşluk kaldı (10 geri verilmedi → 42)", a42.packageNo === 42, String(a42.packageNo));
    await expectErr("§10 zaten üye → 409", () => PackingGroupService.addSacks(p2.id, [a10.id]), 409);
    // Havuzdan al: partisiz çuval partiye girer, numara alır.
    const havuz = await openIn(null);
    await PackingGroupService.addSacks(p2.id, [havuz.id]);
    check("§10 havuzdan al: numara 2", (await readSack(havuz.id)).packageNo === 2);

    // ---- §11: kapat / yeniden aç ------------------------------------------------
    await PackingLotService.close(p2.id);
    const g2c = await readGroup(p2.id);
    check("§11 CLOSED + closedAt", g2c.status === "CLOSED" && g2c.closedAt !== null);
    const openList = (await PackingGroupService.list(customerId)).data ?? [];
    const closedList = (await PackingGroupService.list(customerId, { status: "CLOSED" })).data ?? [];
    check("§11 ⭐ kapalı parti OPEN listesinde yok, CLOSED listesinde var", !openList.some((g) => g.id === p2.id) && closedList.some((g) => g.id === p2.id));
    await expectErr("§11 kapalıya openSack 409 PACKING_LOT_CLOSED", () => ship.openSack({ packingGroupId: p2.id }), 409, "PACKING_LOT_CLOSED");
    await expectErr("§11 kapalıya addSacks 409", () => PackingGroupService.addSacks(p2.id, [a42.id]), 409, "PACKING_LOT_CLOSED");
    await expectErr("§11 iki kez kapat 409", () => PackingLotService.close(p2.id), 409, "PACKING_LOT_ALREADY_CLOSED");
    await PackingLotService.reopen(p2.id);
    const g2o = await readGroup(p2.id);
    check("§11 reopen → OPEN, closedAt KORUNUR", g2o.status === "OPEN" && g2o.closedAt !== null);
    await expectErr("§11 açığı yeniden aç 409", () => PackingLotService.reopen(p2.id), 409, "PACKING_LOT_ALREADY_OPEN");

    // ---- §12: sil ----------------------------------------------------------------
    const pBos = await createLot();
    const del = await PackingLotService.remove(pBos.id);
    check("§12 boş parti silindi", del.success && (await prisma.packingGroup.findUnique({ where: { id: pBos.id } })) === null);
    await expectErr("§12 ⭐ çuvalı olan parti silinmez 409", () => PackingLotService.remove(p2.id), 409, "PACKING_LOT_NOT_EMPTY");

    // ---- §13: parti sırası kapalıya da bakar ----------------------------------------
    // Şu an seq: P1(grup) · SP-2(p1) · SP-3(p0) · SP-4(p2); SP-5 SİLİNDİ (taslak — hiç belgeye
    // girmedi, numarası yeniden verilir). Hepsini kapat: yeni parti 1 DEĞİL, en büyük+1 = 5.
    await PackingLotService.close(p1.id);
    await PackingLotService.close(p0.id);
    await PackingLotService.close(p2.id);
    await PackingLotService.close(gGrup.id);
    const p5 = await createLot();
    check("§13 ⭐ kapalı partiler sayılır (SP-5; silinen taslağın 5'i yeniden verilir)", p5.seq === 5 && p5.name === "SP-5", p5.name);
    await PackingLotService.reopen(p1.id);

    // ---- §14: kısmi sevk -------------------------------------------------------------
    // p1 açık çuvalları: a1(1) a3(20) a10→p2'ye gitti; a11(11) e40(40) a41(41) b2(2) a42(42). Dolu olsunlar.
    const p1Open = await prisma.sack.findMany({ where: { packingGroupId: p1.id, shipmentId: null }, select: { id: true } });
    for (const s of p1Open) await fillSack(s.id);
    const sub = [a1.id, a3.id];
    const sh1 = (await ship.createShipment({ sackIds: sub, customerId, orderless: true })).data as { id: string };
    shipmentIds.push(sh1.id);
    const a1s = await readSack(a1.id);
    check("§14 ⭐ sevk edilen çuval partide numarasıyla KALIR", a1s.shipmentId === sh1.id && a1s.packingGroupId === p1.id && a1s.packageNo === 1);
    const p1AfterDto = (await PackingGroupService.get(p1.id)).data as GroupDto;
    check("§14 parti OPEN, özet: açık 5 · sevk edilen 2", p1AfterDto.status === "OPEN" && p1AfterDto.shippedSackCount === 2 && p1AfterDto.sackCount === 5, `${p1AfterDto.sackCount}/${p1AfterDto.shippedSackCount}`);
    await expectErr("§14 sevk edilmiş çuvalın numarası donmuş (setPackageNo 409)", () => PackingLotService.setPackageNo(a1.id, 99), 409);
    await setFlag(SETTING_KEYS.PACKING_LOT_PARTIAL_DISPATCH, "false");
    await expectErr("§14 ⭐ kısmi sevk kapalı → alt küme 400 PACKING_LOT_WHOLE",
      () => ship.createShipment({ sackIds: [a11.id], customerId, orderless: true }), 400, "PACKING_LOT_WHOLE");
    const rest = (await prisma.sack.findMany({ where: { packingGroupId: p1.id, shipmentId: null }, select: { id: true } })).map((s) => s.id);
    // ---- §15: otomatik kapanış + iptalle yeniden açılma ------------------------------
    await setFlag(SETTING_KEYS.PACKING_LOT_AUTO_CLOSE, "true");
    const sh2 = (await ship.createShipment({ sackIds: rest, customerId, orderless: true })).data as { id: string };
    shipmentIds.push(sh2.id);
    check("§14 tam küme sevk OK", !!sh2.id);
    check("§15 ⭐ son açık çuval gidince parti CLOSED", (await readGroup(p1.id)).status === "CLOSED");
    await ship.cancelShipment(sh2.id);
    const back = await readSack(a11.id);
    check("§15 ⭐ planlı sevk iptali → parti OPEN, numara aynı", (await readGroup(p1.id)).status === "OPEN" && back.shipmentId === null && back.packageNo === 11 && back.packingGroupId === p1.id);
    await setFlag(SETTING_KEYS.PACKING_LOT_AUTO_CLOSE, "false");
    await setFlag(SETTING_KEYS.PACKING_LOT_PARTIAL_DISPATCH, "true");

    // ---- §16: eşzamanlı sayaç ------------------------------------------------------
    const pC = await createLot();
    // İki AYRI tx aynı anda başlar (Promise.all değil — o kural tek tx'in içi içindir;
    // iki bağımsız işlemi yan yana başlatmak yarışın kendisidir).
    const reserve = (count: number) =>
      prisma.$transaction((tx) => reservePackageNosTx(tx, { groupId: pC.id, count, numbering: "artan", startsAtZero: false }));
    const r1 = reserve(2);
    const r2 = reserve(3);
    const n1 = await r1;
    const n2 = await r2;
    const all = [...n1, ...n2].sort((a, b) => a - b);
    check("§16 ⭐ iki paralel tx: 5 farklı numara (1..5)", all.join(",") === "1,2,3,4,5", all.join(","));

    // ---- §17: DB unique son sed ------------------------------------------------------
    const u1 = await openIn(pC.id);
    const u2 = await openIn(pC.id);
    let p2002 = false;
    try { await prisma.sack.update({ where: { id: u2.id }, data: { packageNo: u1.packageNo } }); }
    catch (e) { p2002 = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"; }
    check("§17 ⭐ aynı partide aynı packageNo → P2002", p2002);

    // ---- §18: lotRequired --------------------------------------------------------------
    await setFlag(SETTING_KEYS.PACKING_LOT_REQUIRED, "true");
    await expectErr("§18 ⭐ partisiz açma 400 PACKING_LOT_REQUIRED", () => ship.openSack({ customerId }), 400, "PACKING_LOT_REQUIRED");
    const req = await openIn(pC.id);
    check("§18 partide açma OK", req.packingGroupId === pC.id);
  } finally {
    for (const [k, v] of prevFlags) {
      if (v === undefined) await prisma.systemSetting.deleteMany({ where: { key: k } }).catch(() => {});
      else await prisma.systemSetting.update({ where: { key: k }, data: { value: v } }).catch(() => {});
    }
    // Sevkiyatlar PLANNED (onay açık) → iptal defter yazmadan çuvalı serbest bırakır; sonra sil.
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } }).catch(() => {});
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } }).catch(() => {});
    await prisma.sack.updateMany({ where: { id: { in: sackIds } }, data: { shipmentId: null, packingGroupId: null, packageNo: null } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } }).catch(() => {});
    await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } }).catch(() => {});
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } }).catch(() => {});
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } }).catch(() => {});
    await prisma.packingGroup.deleteMany({ where: { customerId } }).catch(() => {});
    await prisma.color.deleteMany({ where: { id: colorId } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
    await cleanupTestCustomers([customerId]);
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
