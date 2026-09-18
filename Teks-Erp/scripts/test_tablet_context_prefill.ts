// =============================================================================
// BEKÇİ — TABLET ÖN-DOLGU PAKETİ (Z5, 2026-09-18): E2 doff zinciri · E3 koşum önerileri · E4 kumaş → çözgü kartı ·
// E6 son sarım varsayılanları + autoConsume — hepsi ÖNERİ, null-güvenli; eski istemci etkilenmez
// =============================================================================
//   §1 E2: bağlanmamış indirme satırı koşum → iş zincirini taşır (item/color/weavingOrder); koşumsuz doff'ta üçü null;
//         koşumun kendi deseni işin kumaşını EZER; `machineRun` iç nesnesi yanıta sızmaz; makine süzgeci çalışır.
//   §2 E3: aynı desenin son kapanmış koşumu → unitsPerCm (önce bu tezgah) + `sourceMachineId`; devir MachineSpec'ten
//         (LAST_RUN yoksa); desen yokken yalnız devir; hiçbir veri yokken hepsi null (uydurulmaz).
//   §3 E4: `Item.warpSpecId` yalnız KUMAŞ + aktif kart (400 iki kod); dokuma işi `warpSpecId` vermezse kartın
//         varsayılanı, `null` verirse kartsız; pasif kart önerilmez.
//   §5 E3 bağı: 01'in `machine-runs tablet-context` ucu Z5 önerilerini taşır (tek satır bağ, null-güvenli)
//   §4 E6: devere tablet bağlamı `autoConsume` (ayar aynası) + `lastWindDefaults` (çözgü kartı başına SON IN_HOUSE
//         sarımın makine/iplik/dip satırları; sarımsız kart listede yok).
// Negatif sondalar (kırmızı görüldü): `doffPrefill` işin kumaşını koşumun deseninin ÖNÜNE alınca §1b ❌ ·
//   `runOpenSuggestions` makine eşleşmesini atlayınca §2a ❌ · `assertWarpSpecAssignable` FABRIC şartı kalkınca §3a ❌ ·
//   `lastWindDefaults` WARP_RETURN'ü süzmeyince §4b ❌.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { MachineDataSource, Prisma, StationType, WarpBeamOrigin, WarpKgSource, WeavingExecutionKind, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { ItemService } from "../src/services/item.service";
import { openDoff } from "../src/services/machine-doff.service";
import { closeMachineRun, openMachineRun } from "../src/services/machine-run.service";
import { listUnlinkedDoffs } from "../src/services/loom-list.service";
import { createWeavingOrder } from "../src/services/weaving-order.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { getWarpBeamTabletContext } from "../src/services/warp-beam-tablet.service";
import { runOpenSuggestions } from "../src/services/helpers/tablet-prefill.helper";
import { machineRunTabletContext } from "../src/services/helpers/machine-run-suggest.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const kod = (e: unknown): string => (e instanceof AppError ? String((e.details as { code?: string } | undefined)?.code ?? e.statusCode) : String((e as Error)?.message ?? e).slice(0, 80));
async function bekle<T>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: unknown }> {
  try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e }; }
}

const TAG = `TPF-${Date.now().toString(36)}`;
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_AUTO_CONSUME];
const items = new ItemService({ modelName: "item", tableName: "ITEM", searchFields: ["name"], codeSearchFields: ["code"], duplicateNameField: "name" });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(1); }
  console.log("\n=== Tablet ön-dolgu paketi (Z5): E2 · E3 · E4 · E6 ===\n");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const woIds: string[] = [];
  const beamIds: string[] = [];
  const itemIds: string[] = [];
  const stWeave = await prisma.station.create({ data: { name: `${TAG}-TEZGAH`, code: `${TAG}-TZ`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } });
  const stDevere = await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, kind: "WARPING", producesWarpBeam: true }, select: { id: true } });
  const loom1 = await prisma.machine.create({ data: { stationId: stWeave.id, name: `${TAG}-L1`, code: `${TAG}-L1`.slice(0, 32) }, select: { id: true } });
  const loom2 = await prisma.machine.create({ data: { stationId: stWeave.id, name: `${TAG}-L2`, code: `${TAG}-L2`.slice(0, 32) }, select: { id: true } });
  const devereM = await prisma.machine.create({ data: { stationId: stDevere.id, name: `${TAG}-D1`, code: `${TAG}-D1`.slice(0, 32) }, select: { id: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } });
  const specPasif = await prisma.warpSpec.create({ data: { code: `${TAG}-CKP`, name: `${TAG} çözgü pasif`, yarnItemId: yarn.id, endsCount: 100, isActive: false }, select: { id: true } });
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } });
  const fabric2 = await prisma.item.create({ data: { code: `${TAG}-KM2`, name: `${TAG} kumaş 2`, itemType: "FABRIC" }, select: { id: true } });
  const color = await prisma.color.create({ data: { code: `${TAG}-R`, name: `${TAG} renk` }, select: { id: true } });
  const wh = await prisma.warehouse.create({ data: { code: `${TAG}-D`, name: `${TAG} depo` }, select: { id: true } });
  await prisma.yarnMovement.create({ data: { itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.IN, qtyKg: 500 } });
  await prisma.yarnStock.create({ data: { itemId: yarn.id, warehouseId: wh.id, balanceKg: 500 } });

  try {
    for (const key of FLAGS) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: "true" }, update: { value: "true" } });

    // ── §1 E2 doff zinciri ─────────────────────────────────────────────────
    const wo = await createWeavingOrder({ itemId: fabric.id, colorId: color.id, executionKind: WeavingExecutionKind.IN_HOUSE, plannedM: 100 });
    woIds.push(wo.data.id);
    // Koşum deseni = kumaş 2 (operatör koşumda onayladı) — işin kumaşı 1'i EZMELİ.
    const run = await openMachineRun({ machineId: loom1.id, productionLineNo: 1, weavingOrderId: wo.data.id, itemId: fabric2.id, colorId: null, unitsPerCm: 24.5, targetUnitsPerMin: 600 });
    const d1 = await openDoff({ machineId: loom1.id, productionLineNo: 1, pieceCount: 1, counterSource: MachineDataSource.OPERATOR, machineRunId: run.data.id });
    const d2 = await openDoff({ machineId: loom2.id, productionLineNo: 1, pieceCount: 1, counterSource: MachineDataSource.OPERATOR });
    const list = await listUnlinkedDoffs({ machineId: null, sinceDays: 1 });
    const r1 = list.data.find((r) => r.id === d1.data.id);
    const r2 = list.data.find((r) => r.id === d2.data.id);
    check("§1a koşumlu doff satırı weavingOrder + item + color taşır (iş no dolu)", r1?.weavingOrder?.id === wo.data.id && r1?.weavingOrder?.weavingOrderNumber === wo.data.weavingOrderNumber && r1?.item != null && r1?.color != null, JSON.stringify({ wo: r1?.weavingOrder?.weavingOrderNumber, item: r1?.item?.code, color: r1?.color?.name }));
    check("§1b ⭐ koşumun kendi deseni işin kumaşını EZER (kumaş 2), renk koşumda yok → işin rengi", r1?.item?.id === fabric2.id && r1?.color?.id === color.id, `item=${r1?.item?.code}`);
    check("§1c koşumsuz doff: üçü null (uydurulmaz), satır yine listede", r2 != null && r2.weavingOrder === null && r2.item === null && r2.color === null);
    check("§1d `machineRun` iç nesnesi yanıta SIZMAZ (allowlist)", r1 != null && !("machineRun" in r1));
    const byMachine = await listUnlinkedDoffs({ machineId: loom1.id, sinceDays: 1 });
    check("§1e makine süzgeci: yalnız bu tezgahın indirmeleri (E8②, tablet 'önce bu tezgah')", byMachine.data.some((r) => r.id === d1.data.id) && !byMachine.data.some((r) => r.id === d2.data.id));

    // ── §2 E3 koşum önerileri ──────────────────────────────────────────────
    await closeMachineRun(run.data.id, { endedAt: new Date() });
    // İkinci tezgahta aynı desenle farklı sıklık — "önce bu tezgah" ayrımı ölçülsün.
    const run2 = await openMachineRun({ machineId: loom2.id, productionLineNo: 1, itemId: fabric2.id, unitsPerCm: 30, targetUnitsPerMin: 700 });
    await closeMachineRun(run2.data.id, { endedAt: new Date() });
    const s1 = await runOpenSuggestions(prisma, { machineId: loom1.id, itemId: fabric2.id });
    check("§2a ⭐ bu tezgahın son koşumu ÖNCE: unitsPerCm 24.5, kaynak LAST_RUN, sourceMachineId = bu tezgah", s1.suggestedUnitsPerCm === 24.5 && s1.unitsPerCmSource === "LAST_RUN" && s1.sourceMachineId === loom1.id && s1.suggestedTargetUnitsPerMin === 600 && s1.targetSource === "LAST_RUN", JSON.stringify(s1));
    const loom3 = await prisma.machine.create({ data: { stationId: stWeave.id, name: `${TAG}-L3`, code: `${TAG}-L3`.slice(0, 32) }, select: { id: true } });
    await prisma.machineSpec.create({ data: { machineId: loom3.id, nominalUnitsPerMin: 450 } });
    const s2 = await runOpenSuggestions(prisma, { machineId: loom3.id, itemId: fabric2.id });
    check("§2b koşumu olmayan tezgah: sıklık başka tezgahın son koşumundan (30, sourceMachineId = öteki tezgah), devir de LAST_RUN", s2.suggestedUnitsPerCm === 30 && s2.sourceMachineId === loom2.id && s2.targetSource === "LAST_RUN" && s2.suggestedTargetUnitsPerMin === 700, JSON.stringify(s2));
    const s3 = await runOpenSuggestions(prisma, { machineId: loom3.id, itemId: null });
    check("§2c desen yok: sıklık null, devir MachineSpec'ten (450, MACHINE_SPEC), sourceMachineId null", s3.suggestedUnitsPerCm === null && s3.unitsPerCmSource === null && s3.suggestedTargetUnitsPerMin === 450 && s3.targetSource === "MACHINE_SPEC" && s3.sourceMachineId === null, JSON.stringify(s3));
    const s4 = await runOpenSuggestions(prisma, { machineId: loom1.id, itemId: fabric.id });
    check("§2d hiç veri yok (bu desenle koşum yok, makine kartı yok): HEPSİ null — uydurulmaz", s4.suggestedUnitsPerCm === null && s4.suggestedTargetUnitsPerMin === null && s4.targetSource === null, JSON.stringify(s4));
    await prisma.machineSpec.deleteMany({ where: { machineId: loom3.id } });
    await prisma.machine.delete({ where: { id: loom3.id } });

    // ── §3 E4 kumaş → çözgü kartı ──────────────────────────────────────────
    const e3a = await bekle(items.update(yarn.id, { warpSpecId: spec.id }));
    check("§3a ⭐ iplik kartına çözgü kartı bağlanamaz → 400 ITEM_WARP_SPEC_FABRIC_ONLY", !e3a.ok && kod(e3a.e) === "ITEM_WARP_SPEC_FABRIC_ONLY", e3a.ok ? "kabul etti" : kod(e3a.e));
    const e3b = await bekle(items.update(fabric.id, { warpSpecId: specPasif.id }));
    check("§3b pasif çözgü kartı → 400 WARP_SPEC_NOT_FOUND", !e3b.ok && kod(e3b.e) === "WARP_SPEC_NOT_FOUND", e3b.ok ? "kabul etti" : kod(e3b.e));
    await items.update(fabric.id, { warpSpecId: spec.id });
    const woDef = await createWeavingOrder({ itemId: fabric.id, executionKind: WeavingExecutionKind.IN_HOUSE });
    woIds.push(woDef.data.id);
    const woNull = await createWeavingOrder({ itemId: fabric.id, executionKind: WeavingExecutionKind.IN_HOUSE, warpSpecId: null });
    woIds.push(woNull.data.id);
    check("§3c ⭐ dokuma işi çözgü kartı vermezse kumaş kartının varsayılanı; `null` verirse kartsız (açık tercih korunur)", woDef.data.warpSpecId === spec.id && woNull.data.warpSpecId === null, `${woDef.data.warpSpecId === spec.id} / ${woNull.data.warpSpecId}`);
    const created = await items.create({ code: `${TAG}-KM3`, name: `${TAG} kumaş 3`, itemType: "FABRIC", warpSpecId: spec.id });
    itemIds.push((created.data as { id: string }).id);
    check("§3d create de kartı yazar (aynı sözleşme)", (created.data as { warpSpecId?: string | null }).warpSpecId === spec.id);
    await prisma.warpSpec.update({ where: { id: spec.id }, data: { isActive: false } });
    const woPasif = await createWeavingOrder({ itemId: fabric.id, executionKind: WeavingExecutionKind.IN_HOUSE });
    woIds.push(woPasif.data.id);
    check("§3e kart sonradan pasifleşirse ÖNERİLMEZ (null; uydurulmaz)", woPasif.data.warpSpecId === null);
    await prisma.warpSpec.update({ where: { id: spec.id }, data: { isActive: true } });

    // ── §4 E6 son sarım varsayılanları + autoConsume ───────────────────────
    const ctx0 = await getWarpBeamTabletContext();
    check("§4a autoConsume ayar aynası (açık) ve sarımsız kart lastWindDefaults'ta YOK", ctx0.data.autoConsume === true && !ctx0.data.lastWindDefaults.some((d) => d.warpSpecId === spec.id));
    const p = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 100, originKind: WarpBeamOrigin.IN_HOUSE });
    beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: 100, kgSource: WarpKgSource.WEIGHED, machineId: devereM.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 12 }], yarnReturns: [{ warehouseId: wh.id, qtyKg: 1, reasonCode: "DEPOYA_IADE" }] });
    // Bayrak KAPAMA kendi try/finally'sinde: ölçüm biter bitmez açık değer geri gelir (`bekci-bayrak-upsert-try-icinde`
    // kuralı) — dış finally de fotoğrafı geri koyar; iki hat, sıradaki bekçi (`test_warp_beam_auto_consume`) miras almasın.
    let ctx1: Awaited<ReturnType<typeof getWarpBeamTabletContext>>;
    try {
      await prisma.systemSetting.update({ where: { key: SETTING_KEYS.DEVERE_AUTO_CONSUME }, data: { value: "false" } });
      ctx1 = await getWarpBeamTabletContext();
    } finally {
      await prisma.systemSetting.update({ where: { key: SETTING_KEYS.DEVERE_AUTO_CONSUME }, data: { value: "true" } }).catch(() => undefined);
    }
    const d = ctx1.data.lastWindDefaults.find((x) => x.warpSpecId === spec.id);
    // ── §5 E3 bağı: koşum tablet bağlamı (01 Z1 ucu) önerileri TAŞIR ─────────
    const ctxRun = await machineRunTabletContext(loom1.id);
    check("§5 ⭐ `machine-runs tablet-context` `suggested*`/`*Source`/`sourceMachineId` taşır (Z1 ucu + Z5 helper tek satır bağ); işsiz tezgahta null-güvenli", "suggestedUnitsPerCm" in ctxRun && "targetSource" in ctxRun && "sourceMachineId" in ctxRun && ctxRun.suggestedWeavingOrderId === null && ctxRun.suggestedUnitsPerCm === null, JSON.stringify({ u: ctxRun.suggestedUnitsPerCm, t: ctxRun.suggestedTargetUnitsPerMin, src: ctxRun.targetSource }));

    check("§4b ⭐ son sarım: makine + brüt çıkış (12 kg, depo) + dip iadesi (1 kg, DEPOYA_IADE) ayrı listelerde; autoConsume kapalı aynası false", ctx1.data.autoConsume === false && d?.machineId === devereM.id && d?.yarnIssues.length === 1 && d?.yarnIssues[0]?.qtyKg === 12 && d?.yarnIssues[0]?.warehouseId === wh.id && d?.yarnReturns.length === 1 && d?.yarnReturns[0]?.qtyKg === 1 && d?.yarnReturns[0]?.reasonCode === "DEPOYA_IADE", JSON.stringify(d));
  } finally {
    // Bayraklar EN ÖNCE geri (fikstür temizliği yarım kalsa bile sıradaki bekçiye bayrak sızmasın).
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } }).catch(() => undefined);
      else await prisma.systemSetting.deleteMany({ where: { key } }).catch(() => undefined);
    }
    await prisma.doffEvent.deleteMany({ where: { machineId: { in: [loom1.id, loom2.id] } } }).catch(() => undefined);
    await prisma.machineRun.deleteMany({ where: { machineId: { in: [loom1.id, loom2.id] } } }).catch(() => undefined);
    await prisma.yarnMovement.deleteMany({ where: { OR: [{ warpBeamId: { in: beamIds } }, { itemId: yarn.id }] } }).catch(() => undefined);
    await prisma.yarnStock.deleteMany({ where: { itemId: yarn.id } }).catch(() => undefined);
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } }).catch(() => undefined);
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...itemIds, fabric.id, yarn.id] } } }).catch(() => undefined);
    await prisma.weavingOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => undefined);
    await prisma.item.updateMany({ where: { id: { in: [fabric.id, ...itemIds] } }, data: { warpSpecId: null } }).catch(() => undefined);
    await prisma.warpSpec.deleteMany({ where: { id: { in: [spec.id, specPasif.id] } } }).catch(() => undefined);
    await prisma.item.deleteMany({ where: { id: { in: [fabric.id, fabric2.id, yarn.id, ...itemIds] } } }).catch(() => undefined);
    await prisma.color.deleteMany({ where: { id: color.id } }).catch(() => undefined);
    await prisma.warehouse.deleteMany({ where: { id: wh.id } }).catch(() => undefined);
    await prisma.machineSpec.deleteMany({ where: { machineId: { in: [loom1.id, loom2.id, devereM.id] } } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { stationId: { in: [stWeave.id, stDevere.id] } } }).catch(() => undefined);
    await prisma.station.deleteMany({ where: { id: { in: [stWeave.id, stDevere.id] } } }).catch(() => undefined);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("❌ bekçi çöktü:", e);
  await prisma.$disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
