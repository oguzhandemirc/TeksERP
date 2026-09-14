// =============================================================================
// RAŞEL TAKIMI (#23) — "N adet" sarım: N ayrı levent, N WOUND, tek tx; iplik payı ÷ N; kardeş bağı `setKey`
// =============================================================================
// NEDEN: raşel takımında N levent aynı cağlıktan aynı anda sarılır — cağlığa yüklenen kg TOPLAMDIR,
// levent başına nominal tam boydur ⇒ pay ÷ N (kuruş SON levente, Σ = toplam birebir). count=1 bugünkü
// sarımla bayt bayt aynı (setKey null, tek satır). Kardeşler bağımsız levent: biri iptal olunca diğerleri
// durur. Atomik: kardeşte gövde meşgulse HİÇBİRİ doğmaz. Replay (aynı token) ilk levent + kardeşleri döner.
// NEGATİF SONDALAR (2026-09-15): `splitShares` kuruşu son paya değil ilk paya → §2c ❌ (Σ tutar ama sıra) ·
//   kardeş `assertPhysicalBeamFreeTx` çağrısı düşürüldü → §4 ❌ (ham P2002) · `lineShares` `n` yerine 1 → §2b ❌ (N katı).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar FOTOĞRAFINA döner.
// =============================================================================
import { Prisma, StationType, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { cancelWound, windWarpBeam } from "../src/services/warp-beam-wind.service";
import { splitShares } from "../src/services/helpers/warp-beam-set.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
async function beklenenHata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    if (e instanceof Prisma.PrismaClientKnownRequestError) return AppError.conflict(`prisma ${e.code}`, { code: e.code });
    throw e;
  }
}
const kod = (e: AppError | null): string => String((e?.details as { code?: string } | undefined)?.code ?? e?.statusCode ?? "geçti");
const TAG = `TEST-SET-${process.pid}`;
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED];
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

function statik(): void {
  console.log("── §0 Statik ──");
  const s = splitShares(D("10"), 3);
  check("§0a splitShares 10 ÷ 3 → 3.333 · 3.333 · 3.334 (kuruş sonda, Σ birebir)", s.map(String).join(",") === "3.333,3.333,3.334" && s.reduce((a, b) => a.plus(b), D(0)).equals(10));
  check("§0b splitShares n=1 → [toplam]", splitShares(D("7.5"), 1).map(String).join() === "7.5");
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== RAŞEL TAKIMI (N ADET) BEKÇİSİ ===\n");
  statik();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const st = await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, producesWarpBeam: true }, select: { id: true } });
  const mk = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG}-M1`, code: `${TAG}-M1`.slice(0, 32) }, select: { id: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } });
  const wh = await prisma.warehouse.create({ data: { code: `${TAG}-D`, name: `${TAG} depo` }, select: { id: true } });
  const lot = await prisma.yarnLot.create({ data: { itemId: yarn.id, lotNo: `${TAG}-LOT` }, select: { id: true } });
  await prisma.yarnMovement.create({ data: { itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.IN, qtyKg: 1000, lotId: lot.id } });
  await prisma.yarnStock.create({ data: { itemId: yarn.id, warehouseId: wh.id, balanceKg: 1000 } });
  const beamIds: string[] = [];
  const plan = async (physicalBeamNo: string | null = null) => {
    const p = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 100, originKind: WarpBeamOrigin.IN_HOUSE, physicalBeamNo });
    beamIds.push(p.data.id);
    return p.data;
  };
  const setOf = (setKey: string | null) => prisma.warpBeam.findMany({ where: { setKey: setKey ?? "00000000-0000-0000-0000-000000000000" }, orderBy: { beamNo: "asc" }, select: { id: true, beamNo: true, status: true, physicalBeamNo: true } });
  const issueOf = (beamId: string) => prisma.yarnMovement.findMany({ where: { warpBeamId: beamId, kind: YarnMovementKind.WARP_ISSUE }, select: { qtyKg: true, lotId: true } });
  try {
    await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, create: { key: SETTING_KEYS.DEVERE_ENABLED, value: "true" }, update: { value: "true" } });
    await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.IPLIK_ENABLED }, create: { key: SETTING_KEYS.IPLIK_ENABLED, value: "true" }, update: { value: "true" } });
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DEVERE_LOT_REQUIRED } });

    console.log("\n── §1 count=1 (bugün) ──");
    const p1 = await plan();
    const r1 = await windWarpBeam(p1.id, { lengthM: 100, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 10 }] });
    check("§1a tek levent: setKey null, siblings [], iplik 10 (bölünmedi), bakiye 990", r1.data.setKey === null && r1.data.siblings.length === 0 && (await issueOf(p1.id))[0]?.qtyKg.equals(10) === true && (await prisma.yarnStock.findUniqueOrThrow({ where: { itemId_warehouseId: { itemId: yarn.id, warehouseId: wh.id } } })).balanceKg.equals(990));
    const p1b = await plan();
    check("§1b count=1 alanı gönderilince de aynı (varsayılan davranış)", (await windWarpBeam(p1b.id, { lengthM: 100, kgSource: WarpKgSource.THEORETICAL, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 1 }], count: 1 })).data.siblings.length === 0);

    console.log("\n── §2 count=3: üç levent, üç WOUND, tek tx, iplik ÷ 3 ──");
    const p2 = await plan();
    const tok = crypto.randomUUID();
    const r2 = await windWarpBeam(p2.id, { lengthM: 100, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 10, lotId: lot.id }], yarnReturns: [{ warehouseId: wh.id, qtyKg: 1, reasonCode: "DEPOYA_IADE", lotId: lot.id }], count: 3, physicalBeamNoPrefix: `${TAG}-R`, clientToken: tok });
    const set2 = await setOf(r2.data.setKey);
    beamIds.push(...set2.map((b) => b.id));
    const ids2 = set2.map((b) => b.id);
    check("§2a ⭐ 3 levent aynı setKey, hepsi READY, LV no sıralı, kardeşler yanıtta (2)", set2.length === 3 && set2.every((b) => b.status === WarpBeamStatus.READY) && r2.data.siblings.length === 2 && set2[0].beamNo < set2[1].beamNo && set2[1].beamNo < set2[2].beamNo, set2.map((b) => b.beamNo).join(","));
    check("§2a2 her levent kendi WOUND'unu taşır (3 WOUND), token yalnız ilkinde", (await prisma.warpBeamEvent.count({ where: { beamId: { in: ids2 }, kind: "WOUND" } })) === 3 && (await prisma.warpBeamEvent.count({ where: { beamId: { in: ids2 }, kind: "WOUND", clientToken: tok } })) === 1);
    const shares = await Promise.all(set2.map((b) => issueOf(b.id)));
    const toplam = shares.reduce((a, s) => a.plus(s[0]?.qtyKg ?? 0), D(0));
    check("§2b ⭐ iplik çıkışı ÷ 3: 3.333 · 3.333 · 3.334, Σ = 10 birebir, lot her satırda kopyalı", shares.map((s) => String(s[0]?.qtyKg)).sort().join(",") === "3.333,3.333,3.334" && toplam.equals(10) && shares.every((s) => s[0]?.lotId === lot.id), shares.map((s) => String(s[0]?.qtyKg)).join(","));
    check("§2c kuruş SON levente (LV no en büyük olan 3.334)", String((await issueOf(set2[2].id))[0]?.qtyKg) === "3.334");
    const iade = await prisma.yarnMovement.findMany({ where: { warpBeamId: { in: ids2 }, kind: YarnMovementKind.WARP_RETURN }, select: { qtyKg: true } });
    check("§2d dip iadesi de ÷ 3 (0.333 · 0.333 · 0.334), Σ = 1; depo bakiyesi 990 − 1 − 10 + 1 = 980", iade.length === 3 && iade.reduce((a, r) => a.plus(r.qtyKg), D(0)).equals(1) && (await prisma.yarnStock.findUniqueOrThrow({ where: { itemId_warehouseId: { itemId: yarn.id, warehouseId: wh.id } } })).balanceKg.equals(980));
    check("§2e gövde no öneki: R-1 · R-2 · R-3", set2.map((b) => b.physicalBeamNo).join(",") === `${TAG}-R-1,${TAG}-R-2,${TAG}-R-3`);
    check("§2f mesaj üç adı ve adedi söyler", /\(3 adet\)/.test(r2.message ?? "") && set2.every((b) => (r2.message ?? "").includes(b.beamNo)));

    console.log("\n── §3 Replay: aynı token → ilk levent + kardeşler, satır yok ──");
    const r3 = await windWarpBeam(p2.id, { lengthM: 100, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 10 }], count: 3, clientToken: tok });
    check("§3 ⭐ replay: 'yeniden gönderim', siblings 2, toplam levent hâlâ 3, WOUND 3", /yeniden gönderim/.test(r3.message ?? "") && r3.data.siblings.length === 2 && (await setOf(r2.data.setKey)).length === 3 && (await prisma.warpBeamEvent.count({ where: { beamId: { in: ids2 }, kind: "WOUND" } })) === 3);
    check("§3b takım parçası yeniden takım açamaz → 409 WARP_BEAM_SET_EXISTS (READY zaten; ilk kapı setKey)", kod(await beklenenHata(() => windWarpBeam(set2[1].id, { lengthM: 1, kgSource: WarpKgSource.THEORETICAL, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 1 }], count: 2 }))) === "WARP_BEAM_SET_EXISTS");

    console.log("\n── §4 Atomik: kardeşte gövde meşgul → hiçbiri doğmaz ──");
    // İlk leventin KENDİ gövde no'su var (önek onu ezmez) → busy olan yalnız 2. kardeşin R-2'si (kardeş ön kontrolü izole).
    const p4 = await plan(`${TAG}-OWN`);
    const onceki = await prisma.warpBeam.count();
    const e4 = await beklenenHata(() => windWarpBeam(p4.id, { lengthM: 50, kgSource: WarpKgSource.THEORETICAL, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 3 }], count: 2, physicalBeamNoPrefix: `${TAG}-R` }));
    check("§4 ⭐ 2. kardeşin gövdesi R-2 dolu → 409 WARP_BEAM_PHYSICAL_BUSY (adıyla), ilk levent PLANNED kaldı, levent sayısı değişmedi, iplik düşmedi", kod(e4) === "WARP_BEAM_PHYSICAL_BUSY" && (await prisma.warpBeam.findUniqueOrThrow({ where: { id: p4.id }, select: { status: true } })).status === WarpBeamStatus.PLANNED && (await prisma.warpBeam.count()) === onceki && (await issueOf(p4.id)).length === 0, kod(e4));

    console.log("\n── §5 Kardeşler bağımsız: biri iptal, diğerleri durur ──");
    await cancelWound(set2[0].id, `${TAG} yanlış`);
    const after = await setOf(r2.data.setKey);
    check("§5 ⭐ ilk kardeş CANCELLED, iki kardeş READY; iptal edilen 3.333 kg + 0.333 iade net geri (bakiye 983)", after.filter((b) => b.status === WarpBeamStatus.CANCELLED).length === 1 && after.filter((b) => b.status === WarpBeamStatus.READY).length === 2 && (await prisma.yarnStock.findUniqueOrThrow({ where: { itemId_warehouseId: { itemId: yarn.id, warehouseId: wh.id } } })).balanceKg.equals(983));

    console.log("\n── §6 Sınırlar ──");
    const p6a = await plan();
    check("§6a count 25 → 400", (await beklenenHata(() => windWarpBeam(p6a.id, { lengthM: 1, kgSource: WarpKgSource.THEORETICAL, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 1 }], count: 25 })))?.statusCode === 400);
    const p6b = await plan();
    check("§6b count 0 → 400", (await beklenenHata(() => windWarpBeam(p6b.id, { lengthM: 1, kgSource: WarpKgSource.THEORETICAL, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 1 }], count: 0 })))?.statusCode === 400);
  } finally {
    const all = [...new Set(beamIds)];
    await prisma.yarnMovement.deleteMany({ where: { OR: [{ warpBeamId: { in: all } }, { itemId: yarn.id }] } });
    await prisma.yarnStock.deleteMany({ where: { itemId: yarn.id } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: all } } });
    await prisma.warpBeam.deleteMany({ where: { OR: [{ id: { in: all } }, { warpSpecId: spec.id }] } });
    await prisma.yarnLot.delete({ where: { id: lot.id } }).catch(() => undefined);
    await prisma.warpSpec.delete({ where: { id: spec.id } }).catch(() => undefined);
    await prisma.item.delete({ where: { id: yarn.id } }).catch(() => undefined);
    await prisma.warehouse.delete({ where: { id: wh.id } }).catch(() => undefined);
    await prisma.machine.delete({ where: { id: mk.id } }).catch(() => undefined);
    await prisma.station.delete({ where: { id: st.id } }).catch(() => undefined);
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
