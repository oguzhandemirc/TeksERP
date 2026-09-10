// =============================================================================
// Test: Paketleme grubu (çalışma yaftası) — sayaç · canlı yüklem · claim · kapı
// Çalıştır: npx tsx scripts/run-all-tests.ts test_packing_group
//
// Doğrulananlar:
//   §1 Advisory kilit `nextPackingGroupSeqTx`in İLK ifadesi mi (kaynak metni)
//   §2 Uzay 8031 parti no'nun 8022'sinden AYRI + envanterde yazılı
//   §3 `artan` rejimi: boşalan numaraya GERİ DÖNÜLMEZ (P3 sevk, P5 canlı → P6)
//   §4 `bosluk-doldur` rejimi: EN KÜÇÜK boş numara
//   §5 Havuz tamamen boşalınca sayaç 1'e döner (canlı grup kalmadı)
//   §6 Grup SİLİNMEZ, GÖRÜNMEZ olur — son çuval sevk edilince listede yok
//   §7 Bayrak KAPALIYKEN yazma uçları 403 (fail-closed), okuma serbest
//   §8 Atomik claim: sevkiyattaki / başka carinin çuvalı gruplanamaz (409)
//   §9 Bir çuval TEK grupta — ikinci gruba atanınca TAŞINIR
//  §10 Ad override `seq`i DÜŞÜRÜR ve sayacı ilerletmez
//  §11 clientToken replay: aynı grup döner; grup boşalmışsa 409 (dördüncü durum)
//  §12 Ölü grup DİRİLTİLMEZ (addSacks → 409)
// =============================================================================

// ⭐ NEGATİF SONDA (2026-09-10, ölçüldü):
//   (a) `nextPackingGroupSeqTx` içindeki `pg_advisory_xact_lock` satırı okumadan
//       SONRAYA alındı -> §1 KIRMIZI (1 kontrol).
//   (b) `artan` dalı `seqs.length + 1` yapıldı (boşluğu doldurur) -> §3 KIRMIZI.
//   (c) `LIVE_GROUP_WHERE` `{}` yapıldı (ölü grup da canlı sayıldı) -> §5 ve §6
//       KIRMIZI (2 kontrol).
//   (d) `assertPackingGroupsEnabled` gövdesi `return` yapıldı -> §7 KIRMIZI.
//   (e) `claimSacksIntoGroupTx` WHERE'inden `shipmentId: null` silindi -> §8 KIRMIZI.
//   Hepsi geri alındığında yeşil.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Prisma, RollStatus, RollEntrySource } from "@prisma/client";

import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { PackingGroupService } from "../src/services/packing-group.service";
import { PACKING_GROUP_LOCK_NS } from "../src/services/helpers/packing-group.helper";
import { BATCH_NUMBER_LOCK_NS } from "../src/services/batch.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { ShippingService } from "../src/services/shipping.service";
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
async function expectErr(label: string, fn: () => Promise<unknown>, status: number): Promise<void> {
  let code: number | null = null;
  try { await fn(); } catch (e) { code = e instanceof AppError ? e.statusCode : -1; }
  check(label, code === status, `beklenen ${status}, gelen ${code ?? "(hata YOK)"}`);
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
    create: { key, value, description: "test_packing_group" },
    update: { value },
  });
}

const sackIds: string[] = [];
const rollIds: string[] = [];
const groupIds: string[] = [];
const shipmentIds: string[] = [];
let customerId = "";
let otherCustomerId = "";

/** Dolu bir havuz çuvalı (grup sayaçları içerik ister: boş çuval da gruplanır ama
 *  "canlı" yüklemi çuvalın VARLIĞINA bakar, içeriğine değil). */
async function makeSack(owner: string): Promise<string> {
  const res = await ship.openSack({ customerId: owner });
  const id = (res.data as { id: string }).id;
  sackIds.push(id);
  return id;
}

async function createGroup(sacks: string[], name?: string, token?: string) {
  const r = await PackingGroupService.createWithSacks({
    customerId, sackIds: sacks, name, clientToken: token,
  });
  const g = r.data as { id: string; name: string; seq: number | null };
  groupIds.push(g.id);
  return g;
}

/** Çuvalı havuzdan çıkar — "sevk edildi" etkisini TEK kolonla kurar
 *  (tam sevk akışı bu bekçinin konusu değil; canlı yüklemi `shipmentId`ye bakar). */
async function leavePool(sackId: string, shipmentId: string): Promise<void> {
  await prisma.sack.update({ where: { id: sackId }, data: { shipmentId } });
}

async function main(): Promise<void> {
  // ---- §1 + §2: kaynak metni ve uzay (DB'siz, fixture'dan ÖNCE) -------------
  const helperSrc = readFileSync(
    join(__dirname, "../src/services/helpers/packing-group.helper.ts"), "utf-8",
  );
  const fnBody = helperSrc.slice(helperSrc.indexOf("export async function nextPackingGroupSeqTx"));
  const lockAt = fnBody.indexOf("pg_advisory_xact_lock");
  const firstReadAt = Math.min(
    ...["tx.packingGroup.findMany", "tx.packingGroup.findFirst", "tx.sack."]
      .map((needle) => { const i = fnBody.indexOf(needle); return i === -1 ? Number.MAX_SAFE_INTEGER : i; }),
  );
  check("§1 kilit alınıyor", lockAt !== -1);
  check("§1 kilit İLK ifade (her okumadan ÖNCE)", lockAt !== -1 && lockAt < firstReadAt,
    `kilit@${lockAt} < ilk okuma@${firstReadAt}`);
  check("§2 uzay 8031", PACKING_GROUP_LOCK_NS === 8031, String(PACKING_GROUP_LOCK_NS));
  check("§2 parti no uzayından AYRI", PACKING_GROUP_LOCK_NS !== BATCH_NUMBER_LOCK_NS);
  const envanter = readFileSync(
    join(__dirname, "../src/services/helpers/period-guard.helper.ts"), "utf-8",
  );
  check("§2 envanterde yazılı", /\/\/\s+8031\s+PACKING_GROUP_LOCK_NS/.test(envanter));

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true }, orderBy: { code: "asc" } });
  if (!item) throw new Error("Seed Item bulunamadı — önce `npm run seed`");

  const c1 = await prisma.customer.create({
    data: { code: `TST-PG-${TS}`, name: `PAKETLEME GRUBU TEST ${TS}` }, select: { id: true },
  });
  customerId = c1.id;
  const c2 = await prisma.customer.create({
    data: { code: `TST-PG2-${TS}`, name: `PAKETLEME GRUBU TEST-2 ${TS}` }, select: { id: true },
  });
  otherCustomerId = c2.id;

  const shipment = await prisma.shipment.create({
    data: { shipmentNo: `TST-PG-SEV-${TS}`, customerId, status: "PLANNED" },
    select: { id: true },
  });
  shipmentIds.push(shipment.id);

  try {
    // ---- §7: bayrak KAPALIYKEN fail-closed --------------------------------
    await setFlag(SETTING_KEYS.PACKING_GROUPS_ENABLE, "false");
    const s0 = await makeSack(customerId);
    await expectErr("§7 bayrak kapalı → createWithSacks 403",
      () => PackingGroupService.createWithSacks({ customerId, sackIds: [s0] }), 403);
    const listClosed = await PackingGroupService.list(customerId);
    check("§7 okuma kapılı DEĞİL (boş liste döner)", listClosed.success && (listClosed.data ?? []).length === 0);

    await setFlag(SETTING_KEYS.PACKING_GROUPS_ENABLE, "true");
    await setFlag(SETTING_KEYS.PACKING_GROUP_NUMBERING, "artan");

    // ---- §3: `artan` — boşalan numaraya geri dönülmez ----------------------
    const g1 = await createGroup([s0]);
    check("§3 ilk grup seq=1", g1.seq === 1 && g1.name === "P1", `${g1.name}/${g1.seq}`);
    const s2 = await makeSack(customerId);
    const g2 = await createGroup([s2]);
    const s3 = await makeSack(customerId);
    const g3 = await createGroup([s3]);
    check("§3 sayaç ilerliyor (2, 3)", g2.seq === 2 && g3.seq === 3, `${g2.seq}/${g3.seq}`);

    // 2. Grup sevk edildi → numarası BOŞA ÇIKTI ama geri dönülmemeli.
    await leavePool(s2, shipment.id);
    const s4 = await makeSack(customerId);
    const g4 = await createGroup([s4]);
    check("§3 ⭐ boşalan 2'ye DÖNMEDİ, 4 verdi", g4.seq === 4, `seq=${g4.seq}`);

    // ---- §6: ölü grup listelenmez -----------------------------------------
    const liste = (await PackingGroupService.list(customerId)).data ?? [];
    check("§6 ⭐ boşalan grup listede YOK", !liste.some((g) => g.id === g2.id), `${liste.length} canlı grup`);
    check("§6 ölü grup DB'de duruyor (silinmedi)",
      (await prisma.packingGroup.count({ where: { id: g2.id } })) === 1);

    // ---- §4: `bosluk-doldur` — en küçük boş numara -------------------------
    await setFlag(SETTING_KEYS.PACKING_GROUP_NUMBERING, "bosluk-doldur");
    const s5 = await makeSack(customerId);
    const g5 = await createGroup([s5]);
    check("§4 ⭐ en küçük boş numara (2) verildi", g5.seq === 2, `seq=${g5.seq}`);
    await setFlag(SETTING_KEYS.PACKING_GROUP_NUMBERING, "artan");

    // ---- §10: ad override -------------------------------------------------
    const s6 = await makeSack(customerId);
    const gNamed = await createGroup([s6], "Cuma tırı");
    check("§10 elle ad → seq NULL", gNamed.seq === null && gNamed.name === "Cuma tırı");
    const s7 = await makeSack(customerId);
    const gAfter = await createGroup([s7]);
    check("§10 ⭐ elle ad sayacı İLERLETMEDİ", gAfter.seq === 5, `seq=${gAfter.seq}`);

    // ---- §9: bir çuval tek grupta ----------------------------------------
    await PackingGroupService.addSacks(g1.id, [s7]);
    const s7row = await prisma.sack.findUnique({ where: { id: s7 }, select: { packingGroupId: true } });
    check("§9 ⭐ çuval TAŞINDI (tek grup üyeliği)", s7row?.packingGroupId === g1.id);
    const gAfterRow = (await PackingGroupService.list(customerId)).data ?? [];
    check("§9 boşalan eski grup listeden düştü", !gAfterRow.some((g) => g.id === gAfter.id));

    // ---- §8: atomik claim reddi ------------------------------------------
    const sShipped = await makeSack(customerId);
    await leavePool(sShipped, shipment.id);
    await expectErr("§8 ⭐ sevkiyattaki çuval gruplanamaz → 409",
      () => PackingGroupService.createWithSacks({ customerId, sackIds: [sShipped] }), 409);
    const sForeign = await makeSack(otherCustomerId);
    await expectErr("§8 ⭐ başka carinin çuvalı gruplanamaz → 409",
      () => PackingGroupService.createWithSacks({ customerId, sackIds: [sForeign] }), 409);

    // ---- §11: clientToken replay -----------------------------------------
    const token = "11111111-2222-4333-8444-" + String(TS).slice(-12).padStart(12, "0");
    const sTok = await makeSack(customerId);
    const gTok1 = await createGroup([sTok], undefined, token);
    const gTok2 = await createGroup([sTok], undefined, token);
    check("§11 aynı token → AYNI grup (ikinci grup doğmadı)", gTok1.id === gTok2.id);
    check("§11 token mükerrer grup yaratmadı",
      (await prisma.packingGroup.count({ where: { clientToken: token } })) === 1);
    // Dördüncü durum: token'lı grup boşaldı → cached dönmek YANLIŞ cevap.
    await leavePool(sTok, shipment.id);
    await expectErr("§11 ⭐ boşalmış token grubu → 409 (dördüncü durum)",
      () => PackingGroupService.createWithSacks({ customerId, sackIds: [s0], clientToken: token }), 409);

    // ---- §12: ölü grup diriltilmez ---------------------------------------
    const sNew = await makeSack(customerId);
    await expectErr("§12 ⭐ ölü gruba çuval eklenemez → 409",
      () => PackingGroupService.addSacks(gTok1.id, [sNew]), 409);

    // ---- §5: havuz boşalınca sayaç 1'e döner ------------------------------
    await prisma.sack.updateMany({
      where: { customerId, shipmentId: null }, data: { shipmentId: shipment.id },
    });
    const sFresh = await prisma.sack.create({
      data: { sackNo: `TST-PG-FRESH-${TS}`, customerId }, select: { id: true },
    });
    sackIds.push(sFresh.id);
    const gFresh = await createGroup([sFresh.id]);
    check("§5 ⭐ havuz boşaldı → sayaç 1'e döndü", gFresh.seq === 1, `seq=${gFresh.seq}`);
  } finally {
    for (const [k, v] of prevFlags) {
      if (v === undefined) await prisma.systemSetting.deleteMany({ where: { key: k } }).catch(() => {});
      else await prisma.systemSetting.update({ where: { key: k }, data: { value: v } }).catch(() => {});
    }
    await prisma.sack.updateMany({ where: { id: { in: sackIds } }, data: { shipmentId: null, packingGroupId: null } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } }).catch(() => {});
    await prisma.packingGroup.deleteMany({ where: { customerId: { in: [customerId, otherCustomerId] } } }).catch(() => {});
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: [customerId, otherCustomerId] } } }).catch(() => {});
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
