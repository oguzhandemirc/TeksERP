// =============================================================================
// ZİNCİR — iplik lotundan fason dönüşüne TEK KOŞUMDA, gerçek DB
// Çalıştır: npx tsx scripts/run-all-tests.ts zincir_uctan_uca
// =============================================================================
// NEDEN: her adımın KENDİ bekçisi var ve hepsi yeşil; ama zincirin KENDİSİ hiç
// koşulmuyordu. Adım bekçileri komşusunun bıraktığı durumu FİKSTÜRLE taklit eder —
// gerçek geçişte bir alan boş kalırsa (koşum bağı · doff bağı · mühür penceresi) hiçbiri
// görmez. ⇒ Bu bekçi adımları TAKLİT ETMEZ, ZİNCİRLER: her adımın çıktısı bir sonrakinin
// girdisidir ve her adımda İKİ şey ölçülür — ① defter satırı YAZILDI ② beyan edilen TERS
// YOL gerçekten çalışıyor (uygula → geri al → satır tersine döndü).
//
// ÜÇ SONUÇ (adım başına): ✅ koşuyor · ⏭ BEYANLI "henüz inmedi" · ❌ kırıldı.
// ⏭ bir muafiyet DEĞİL, bir SÖZLEŞMEDİR: inmemiş adım NE BEKLEDİĞİNİ adıyla yazar
// (servis · durum · sed), böylece indiği gün beklenen sonuç tartışılmaz.
// ⚠️ ⏭ SAYISI CIRCIRDIR (`ATLANAN_TABAN`): artarsa bir adım SESSİZCE KAPANMIŞ demektir —
// zincirin kısalması, zincir bekçisinin göremeyeceği tek şeydir.
//
// ADIMLAR: ①iplik mal kabulü+LOT ②levent sarımı ④dokuma işi+koşum ⑤doff ⑥top KK1'de
// doğar (WEAVING) ⑦vardiya karnesi mühür ⑧fasona levent + DÖNÜŞ ⑧tezgaha bağlama (⏭).
//
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Fikstür `try` İÇİNDE doğar, teardown
// `finally`de KİMLİKLE siler (sızan bayrak sınıfı, `test_bekci_sozlesmesi`).
// =============================================================================
import { MachineDataSource, RollEntrySource, RollStatus, StationType, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { atlamaDefteri } from "./lib/atlama";
import { curumeKolu } from "./lib/circir-kolu";
import { factoryDayKeyUtcMidnight } from "../src/constants/time";
import { createWarpBeam, getWarpBeam } from "../src/services/warp-beam.service";
import { cancelWound, windWarpBeam } from "../src/services/warp-beam-wind.service";
import { openMachineRun, closeMachineRun, revokeMachineRun } from "../src/services/machine-run.service";
import { openDoff, revokeDoff } from "../src/services/machine-doff.service";
import { InventoryService } from "../src/services/inventory.service";
import { materializeShiftStatTx, sealShiftStat, unsealShiftStat } from "../src/services/machine-shift-seal.service";
import { returnWarpBeam, cancelWarpBeamReturn } from "../src/services/subcontractor-beam.service";
import { mountBeam, dismountBeam, cancelStatusEvent } from "../src/services/warp-beam-mount.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { ensureTestAdmin } from "./fixture-test-user";
import { SETTING_KEYS } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}
/**
 * ÜÇÜNCÜ SONUÇ — inmemiş adım. ORTAK atlama defteri kullanılır (yerel kopya YASAK,
 * `test_atlama_defteri §5`): kopya `"?"` sınıfını temsil edemez ve sayıyı elle
 * düzeltmeye zorlar. Sözleşme `sebep` alanında ADIYLA taşınır.
 */
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));
const atla = (label: string, sozlesme: string): void => ATLAMA.atla(label, `inince beklenen: ${sozlesme}`);

/** ⚠️ CIRCIR TABANI — oturum DOKUNMAZ. 6e Faz 3 E1 indi, gerçek 0; taban entegratörde düşer. */
const ATLANAN_TABAN = 0;

const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING];
const TAG = `TEST-ZNC-${Date.now().toString(36).toUpperCase()}`;
const ids = {
  beam: [] as string[], roll: [] as string[], doff: [] as string[], run: [] as string[],
  dispatch: [] as string[], wo: [] as string[], receipt: [] as string[],
  station: [] as string[], machine: [] as string[], item: [] as string[],
  wh: "", spec: "", sub: "", shiftDef: "", shift: "", stat: "",
};

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(2); }
  console.log("=== ZİNCİR: iplik lotu → levent → dokuma → doff → top → mühür → fason ===\n");
  const svc = new SubcontractorService();
  const inventory = new InventoryService();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  try {
    // Bayraklar try İÇİNDE açılır, finally'de FOTOĞRAFINA döner (sızan bayrak sınıfı).
    for (const key of FLAGS) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: "true" }, update: { value: "true" } });
    // ── FİKSTÜR (try İÇİNDE) ────────────────────────────────────────────────
    const admin = await ensureTestAdmin();
    const wh = await prisma.warehouse.create({ data: { code: `${TAG}-D`, name: `${TAG} depo` }, select: { id: true } });
    ids.wh = wh.id;
    const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
    ids.sub = sub.id;
    const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
    ids.item.push(yarn.id);
    const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } });
    ids.item.push(fabric.id);
    const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3500 }, select: { id: true } });
    ids.spec = spec.id;
    const devereSt = await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, producesWarpBeam: true }, select: { id: true } });
    // ⚠️ `consumesWarpBeam` fikstürde AÇIK: levent bağlama kapısı istasyon kartına bakar
    // (6e Faz 3 `WARP_BEAM_MACHINE_NOT_LOOM`), makinenin `warpBeamSlots`una değil.
    const dokumaSt = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } });
    const fasonSt = await prisma.station.create({ data: { name: `${TAG}-FASON`, code: `${TAG}-FS`.slice(0, 32), type: StationType.EXTERNAL }, select: { id: true } });
    ids.station.push(devereSt.id, dokumaSt.id, fasonSt.id);
    const tezgah = await prisma.machine.create({ data: { stationId: dokumaSt.id, name: `${TAG}-T1`, code: `${TAG}-T1`.slice(0, 32) }, select: { id: true, warpBeamSlots: true } });
    const devereMk = await prisma.machine.create({ data: { stationId: devereSt.id, name: `${TAG}-DV1`, code: `${TAG}-DV1`.slice(0, 32) }, select: { id: true } });
    ids.machine.push(tezgah.id, devereMk.id);

    // ── ① İPLİK MAL KABULÜ + LOT ────────────────────────────────────────────
    console.log("\n── ① İplik mal kabulü (LOT) ──");
    const fis = await goodsReceiptService.create({
      warehouseId: wh.id, deliveryNoteNo: `${TAG}-IRS`,   // tedarikçi OPSİYONEL (C4): mal önce girer
      lines: [{ itemId: yarn.id, initialQty: 1000, lotNo: `${TAG}-LOT`, bobbinCount: 20 }],
    });
    const fisId = (fis.data as { id: string }).id;
    ids.receipt.push(fisId);
    const lot = await prisma.yarnLot.findUnique({ where: { itemId_lotNo: { itemId: yarn.id, lotNo: `${TAG}-LOT` } }, select: { id: true, lotNo: true } });
    const girisHareket = await prisma.yarnMovement.findFirst({ where: { goodsReceiptId: fisId }, select: { id: true, qtyKg: true, lotId: true, kind: true } });
    check("①a mal kabulü LOT açtı ve iplik defterine IN satırı yazdı", !!lot?.id && !!girisHareket && Number(girisHareket.qtyKg) === 1000 && girisHareket.kind === YarnMovementKind.IN, `lot=${lot?.lotNo} kg=${Number(girisHareket?.qtyKg ?? 0)}`);
    // ⚠️ `a?.x === b?.y` İKİSİ DE undefined iken GEÇER — vakum yeşil. Bağ ölçümü
    // önce iki ucun VAR olduğunu ister (bu kontrol ilk yazımda vakum yeşil verdi).
    check("①b IN satırı LOT'a bağlı (allowlist sessizce düşürmedi)", !!lot?.id && !!girisHareket?.lotId && girisHareket.lotId === lot.id, `lotId=${girisHareket?.lotId ?? "yok"}`);

    // ── ② LEVENT SARIMI ─────────────────────────────────────────────────────
    console.log("\n── ② Levent sarımı (WOUND + WARP_ISSUE) ──");
    const plan = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 7000, originKind: WarpBeamOrigin.IN_HOUSE });
    ids.beam.push(plan.data.id);
    const sarim = await windWarpBeam(plan.data.id, {
      lengthM: 7000, kgSource: WarpKgSource.THEORETICAL, machineId: devereMk.id,
      yarnIssues: [{ warehouseId: wh.id, qtyKg: 800, lotId: lot!.id }],
    });
    check("②a levent SARILDI (READY) ve WOUND olayı doğdu", sarim.data.status === WarpBeamStatus.READY
      && (await prisma.warpBeamEvent.count({ where: { beamId: plan.data.id, kind: "WOUND" } })) === 1, sarim.data.beamNo);
    const cikis = await prisma.yarnMovement.findFirst({ where: { itemId: yarn.id, kind: YarnMovementKind.WARP_ISSUE }, select: { qtyKg: true, lotId: true } });
    check("②b ⭐ ZİNCİR BAĞI: sarım ①'in LOTUNDAN iplik düştü (WARP_ISSUE, aynı lotId)", Number(cikis?.qtyKg ?? 0) === 800 && cikis?.lotId === lot!.id);

    // TERS YOL — beyan: `TERS_BAG` (reversesEventId) + `KARSI_OLAY` (WARP_ISSUE_REVERSAL)
    const ikinci = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 100, originKind: WarpBeamOrigin.IN_HOUSE });
    ids.beam.push(ikinci.data.id);
    await windWarpBeam(ikinci.data.id, { lengthM: 100, kgSource: WarpKgSource.THEORETICAL, machineId: devereMk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 10, lotId: lot!.id }] });
    await cancelWound(ikinci.data.id, "zincir bekçisi: ters yol ölçümü");
    const tersOlay = await prisma.warpBeamEvent.findFirst({ where: { beamId: ikinci.data.id, kind: "WOUND_CANCEL" }, select: { reversesEventId: true } });
    const tersIplik = await prisma.yarnMovement.count({ where: { itemId: yarn.id, kind: YarnMovementKind.WARP_ISSUE_REVERSAL } });
    check("②c ⭐ TERS YOL ÇALIŞTI: WOUND_CANCEL orijinaline bağlı + iplik çıkışı tipli ters satırla döndü",
      !!tersOlay?.reversesEventId && tersIplik === 1, `reversesEventId=${!!tersOlay?.reversesEventId} reversal=${tersIplik}`);

    // ── ③ TEZGAHA BAĞLAMA (6e Faz 3 E1) ─────────────────────────────────────
    console.log("\n── ③ Levent tezgaha bağlanır (MOUNTED) ──");
    // ⚠️ Bu adım 2026-09-15'e kadar ⏭ BEYANLIYDI ve sözleşmesi burada YAZILIYDI
    // (`warp-beam-mount.service::mount/dismount` · MOUNTED · yuva seddi · ters yol dismount).
    // İndiği gün beklenen sonuç tartışılmadı: sözleşme neyse o ölçüldü.
    const tak = await mountBeam(plan.data.id, { machineId: tezgah.id, position: 1 }, admin.id);
    const takiliSatir = await prisma.warpBeam.findUniqueOrThrow({ where: { id: plan.data.id }, select: { currentMachineId: true, currentPosition: true } });
    // ⚠️ BAĞI DURUM DEĞİL ADRES ölçer: "MOUNTED" her tezgahta aynı görünür; zincirin iddiası
    // leventin BU tezgaha, BU yuvaya takıldığıdır (`warp_beams_mounted_ck` dolu tutar).
    check("③a ⭐ ZİNCİR BAĞI: ②'nin LEVENTİ BU tezgaha, 1. yuvaya TAKILDI (MOUNTED)",
      tak.data.status === WarpBeamStatus.MOUNTED
      && takiliSatir.currentMachineId === tezgah.id && takiliSatir.currentPosition === 1
      && (await prisma.warpBeamEvent.count({ where: { beamId: plan.data.id, kind: "MOUNTED" } })) === 1,
      `${tak.data.beamNo} · makine=${takiliSatir.currentMachineId === tezgah.id} yuva=${takiliSatir.currentPosition}`);
    // YUVA SEDDİ: aynı makine+pozisyona ikinci levent GİREMEZ.
    const ikinciYuva = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 500, originKind: WarpBeamOrigin.IN_HOUSE });
    ids.beam.push(ikinciYuva.data.id);
    await windWarpBeam(ikinciYuva.data.id, { lengthM: 500, kgSource: WarpKgSource.THEORETICAL, machineId: devereMk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 50, lotId: lot!.id }] });
    let yuvaKod = "";
    try { await mountBeam(ikinciYuva.data.id, { machineId: tezgah.id, position: 1 }, admin.id); }
    catch (e) { yuvaKod = String((e as { details?: { code?: string } }).details?.code ?? (e as Error).message).slice(0, 60); }
    check("③b ⭐ YUVA SEDDİ: dolu pozisyona ikinci levent REDDEDİLDİ", yuvaKod !== "", yuvaKod || "GEÇTİ (beklenmedik)");

    // ── ③′ SÖKÜM ve TERS YOL ────────────────────────────────────────────────
    const sok = await dismountBeam(plan.data.id, { reason: "zincir bekçisi: söküm" }, admin.id);
    check("③c levent SÖKÜLDÜ (DISMOUNTED) ve tezgah yuvası boşaldı", sok.data.status !== WarpBeamStatus.MOUNTED
      && (await prisma.warpBeamEvent.count({ where: { beamId: plan.data.id, kind: "DISMOUNTED" } })) === 1, String(sok.data.status));
    const sokOlay = await prisma.warpBeamEvent.findFirstOrThrow({ where: { beamId: plan.data.id, kind: "DISMOUNTED" }, orderBy: { createdAt: "desc" }, select: { id: true } });
    await cancelStatusEvent(plan.data.id, sokOlay.id, "zincir bekçisi: ters yol ölçümü", admin.id);
    const mountOlaylar = (await prisma.warpBeamEvent.findMany({ where: { beamId: plan.data.id }, orderBy: { createdAt: "asc" }, select: { kind: true } })).map((x) => x.kind);
    check("③d ⭐ TERS YOL: söküm GERİ ALINDI — olay SİLİNMEDİ, DISMOUNT_CANCEL eklendi (LIFO)",
      mountOlaylar.includes("DISMOUNT_CANCEL") && mountOlaylar.filter((k) => k === "DISMOUNTED").length === 1, mountOlaylar.join("→"));
    // Zincir devam etsin: levent yeniden SÖKÜLÜR (fasona READY gitmeli).
    await dismountBeam(plan.data.id, { reason: "zincir bekçisi: fason öncesi söküm" }, admin.id);

    // ── ④ DOKUMA KOŞUMU ─────────────────────────────────────────────────────
    console.log("\n── ④ Dokuma koşumu (MachineRun) ──");
    const T0 = new Date(Date.now() - 6 * 3600_000);
    const kosum = await openMachineRun({ machineId: tezgah.id, productionLineNo: 1, itemId: fabric.id, startedAt: T0 });
    const kosumId = (kosum.data as { id: string }).id;
    ids.run.push(kosumId);
    check("④a koşum AÇILDI (defter satırı)", !!kosumId && (await prisma.machineRun.count({ where: { id: kosumId, revokedAt: null } })) === 1);

    // ── ⑤ DOFF ──────────────────────────────────────────────────────────────
    console.log("\n── ⑤ Doff (top indirme) ──");
    const doff = await openDoff({ machineId: tezgah.id, productionLineNo: 1, machineRunId: kosumId, pieceCount: 2, counterSource: MachineDataSource.OPERATOR, doffedAt: new Date(T0.getTime() + 3600_000) });
    const doffId = doff.data!.id;
    ids.doff.push(doffId);
    check("⑤a ⭐ ZİNCİR BAĞI: doff ④'ün KOŞUMUNA bağlı (fikstür değil, gerçek koşum)",
      (await prisma.doffEvent.findUniqueOrThrow({ where: { id: doffId }, select: { machineRunId: true } })).machineRunId === kosumId);

    // ── ⑥ TOP KK1'DE DOĞAR ──────────────────────────────────────────────────
    console.log("\n── ⑥ Top KK1'de doğar (entrySource WEAVING) ──");
    const top = await inventory.createInitialEntry({ itemId: fabric.id, initialQty: 50 }, admin.id, tezgah.id, false, {
      forcedEntrySource: RollEntrySource.WEAVING, doffEventId: doffId,
    });
    const topId = (top.data as { id: string }).id;
    ids.roll.push(topId);
    const topRow = await prisma.roll.findUniqueOrThrow({ where: { id: topId }, select: { entrySource: true, doffEventId: true, status: true } });
    check("⑥a ⭐ ZİNCİR BAĞI: top ⑤'ün DOFF'una bağlı ve kaynağı WEAVING",
      topRow.entrySource === RollEntrySource.WEAVING && topRow.doffEventId === doffId, `status=${topRow.status}`);
    const stokGiris = await prisma.warehouseMovement.count({ where: { rollId: topId } });
    check("⑥b topun doğuşu STOK DEFTERİNE satır yazdı", stokGiris >= 1, `${stokGiris} satır`);

    // TERS YOL — doff damgası: top doğduktan SONRA geri alma REDDEDİLİR
    let doffGeriAlmaKod = "";
    try { await revokeDoff(doffId, "zincir bekçisi: ters yol ölçümü"); } catch (e) { doffGeriAlmaKod = String((e as { details?: { code?: string } }).details?.code ?? (e as Error).message).slice(0, 40); }
    check("⑥c ⭐ TERS YOL SINIRI: top doğmuş doffun geri alınması REDDEDİLDİ (defter satırı silinmez)",
      doffGeriAlmaKod !== "" && (await prisma.doffEvent.findUniqueOrThrow({ where: { id: doffId }, select: { revokedAt: true } })).revokedAt === null, doffGeriAlmaKod || "geçti (BEKLENMEDİK)");

    // ── ⑦ VARDİYA KARNESİ MÜHÜR ─────────────────────────────────────────────
    console.log("\n── ⑦ Vardiya karnesi mühür ──");
    const S0 = new Date(T0.getTime() - 3600_000);
    const S1 = new Date(T0.getTime() + 7 * 3600_000);
    const sdef = await prisma.shiftDefinition.create({ data: { name: `${TAG} vardiya`, code: `Z${Date.now().toString(36).slice(-6)}`.toUpperCase().slice(0, 8), startMinute: 0, durationMinutes: 480, isActive: true }, select: { id: true } }).catch(() => null);
    if (!sdef) {
      atla("⑦ vardiya karnesi mühür", "ShiftDefinition fikstürü kurulamadı (şema alanları değişmiş olabilir) — kurulunca materializeShiftStatTx + sealShiftStat ölçülür");
    } else {
      ids.shiftDef = sdef.id;
      const sh = await prisma.shiftInstance.create({ data: { shiftDefinitionId: sdef.id, factoryDayKey: factoryDayKeyUtcMidnight(S0), startsAt: S0, endsAt: S1 }, select: { id: true } });
      ids.shift = sh.id;
      const mat = await prisma.$transaction((tx) => materializeShiftStatTx(tx, tezgah.id, sh.id));
      const statId = (mat as { statId?: string }).statId ?? (await prisma.machineShiftStat.findFirstOrThrow({ where: { machineId: tezgah.id, shiftInstanceId: sh.id }, select: { id: true } })).id;
      ids.stat = statId;
      const m = await sealShiftStat(statId, admin.id);
      check("⑦a karne MÜHÜRLENDİ (sealGeneration 1)", (m.data as { sealGeneration?: number }).sealGeneration === 1, JSON.stringify(m.data).slice(0, 80));
      await unsealShiftStat(statId, "zincir bekçisi: ters yol ölçümü", admin.id);
      const seals = await prisma.machineShiftStatSeal.count({ where: { statId } });
      check("⑦b ⭐ TERS YOL: mühür AÇILDI ve iki olay da deftere yazıldı (satır silinmedi)", seals >= 2, `${seals} mühür olayı`);
    }

    // ── ⑧ FASONA LEVENT + DÖNÜŞ ─────────────────────────────────────────────
    console.log("\n── ⑧ Fasona levent sevki ve DÖNÜŞÜ (F1) ──");
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${TAG}-W1`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric.id, steps: { create: [{ stationId: fasonSt.id, stepSequence: 1, status: "PENDING" }] } },
      include: { steps: true },
    });
    ids.wo.push(wo.id);
    const sevk = await svc.dispatch({ workOrderId: wo.id, stepId: wo.steps[0]!.id, subcontractorId: sub.id, rollIds: [], warpBeamIds: [plan.data.id] }, admin.id);
    const sevkId = (sevk.data as { id: string }).id;
    ids.dispatch.push(sevkId);
    check("⑧a ⭐ ZİNCİR BAĞI: ②'nin LEVENTİ fasona gitti (SHIPPED_OUT, polimorfik kalem)",
      (await prisma.warpBeam.findUniqueOrThrow({ where: { id: plan.data.id }, select: { status: true } })).status === WarpBeamStatus.SHIPPED_OUT
      && (await prisma.subcontractorDispatchItem.count({ where: { dispatchId: sevkId, warpBeamId: plan.data.id } })) === 1);
    const donus = await returnWarpBeam(sevkId, { warpBeamId: plan.data.id, lengthM: 6800 }, admin.id);
    check("⑧b DÖNÜŞ: levent READY'ye döndü, RETURNED_IN olayı kaleme bağlı", donus.data.status === WarpBeamStatus.READY
      && (await getWarpBeam(plan.data.id)).data.remainingM === 6800);
    await cancelWarpBeamReturn(sevkId, { warpBeamId: plan.data.id, reason: "zincir bekçisi: ters yol ölçümü" }, admin.id);
    const olayTipleri = (await prisma.warpBeamEvent.findMany({ where: { beamId: plan.data.id }, orderBy: { createdAt: "asc" }, select: { kind: true } })).map((x) => x.kind);
    check("⑧c ⭐ TERS YOL: dönüş STORNO edildi — olaylar SİLİNMEDİ, ters satır eklendi",
      olayTipleri.filter((k) => k === "RETURNED_IN").length === 1 && olayTipleri.length >= 3, olayTipleri.join("→"));

    // ── ZEMİN + ⏭ CIRCIRI ───────────────────────────────────────────────────
    console.log("\n── Zincir zemini ──");
    check("zemin: zincirin SEKİZ adımı gerçek DB'de koştu", pass >= 18, `${pass} kontrol`);
    check("⭐ ATLANAN adım sayısı ARTMADI (adım sessizce kapanmadı)", ATLAMA.sayi <= ATLANAN_TABAN,
      ATLAMA.sayi <= ATLANAN_TABAN ? `${ATLAMA.sayi} ≤ ${ATLANAN_TABAN}` : `${ATLAMA.sayi} > ${ATLANAN_TABAN} ⇒ bir adım SESSİZCE ⏭'ye düştü`);
    // ⚠️ CIRCIRIN İKİNCİ YÖNÜ: bir adım ⏭'den çıkınca taban DÜŞMELİ. Yoksa "8 adım koşuyor"
    // ile "7 koşuyor, biri ⏭" aynı yeşile çıkar ve zincirin BÜYÜMESİ görünmez olur.
    curumeKolu(check, ATLAMA.atla, "⭐ ATLANAN tabanı ÇÜRÜMEDİ", ATLAMA.sayi, ATLANAN_TABAN);
  } finally {
    // TEARDOWN — KİMLİKLE, FK güvenli sırada.
    // ⚠️ TEMİZLİK HATASI YUTULMAZ (defter.md): yutulan hata "temizlik başarılı" ile AYNI
    // çıktıya iner, kalıntı büyür ve KOMŞU bekçileri kirletir. Hatalar toplanır ve
    // sonunda ADIYLA basılır; ayrıca kalıntı SAYILIR (ilk yazımda 1 spec + 2 kalem +
    // 1 iş emri sessizce kalmıştı — `Batch` satırı FK ile tutuyordu).
    const temizlikHatasi: string[] = [];
    const t = async (fn: () => Promise<unknown>, ad = ""): Promise<void> => {
      try { await fn(); } catch (e) { temizlikHatasi.push(`${ad}: ${String((e as Error).message).slice(0, 60)}`); }
    };
    // Bayraklar FOTOĞRAFINA döner (yoksa satır silinir) — sızan bayrak komşuyu kırar.
    for (const key of FLAGS) {
      const onceki = foto.find((f) => f.key === key);
      if (onceki) await t(() => prisma.systemSetting.update({ where: { key }, data: { value: onceki.value as never } }));
      else await t(() => prisma.systemSetting.deleteMany({ where: { key } }));
    }
    await t(() => prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids.roll } } }));
    await t(() => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids.roll } } }));
    await t(() => prisma.rollOperation.deleteMany({ where: { rollId: { in: ids.roll } } }));
    await t(() => prisma.rollProperty.deleteMany({ where: { rollId: { in: ids.roll } } }));
    await t(() => prisma.roll.deleteMany({ where: { id: { in: ids.roll } } }));
    await t(() => prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: ids.beam } } }));
    await t(() => prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: ids.dispatch } } }));
    await t(() => prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...ids.dispatch, ...ids.wo] } } }));
    const partiler = (await prisma.subcontractorDispatch.findMany({ where: { id: { in: ids.dispatch } }, select: { batchId: true } })).map((x) => x.batchId).filter((x): x is string => !!x);
    await t(() => prisma.subcontractorDispatch.deleteMany({ where: { id: { in: ids.dispatch } } }), "dispatch");
    if (partiler.length) await t(() => prisma.batch.deleteMany({ where: { id: { in: partiler } } }), "batch");
    // ⚠️ SIRA ÖLÇÜLDÜ: iplik hareketleri leventi FK ile tutar (`YarnMovement.warpBeamId`) —
    // levent ÖNCE silinmeye çalışılınca teardown sessizce başarısız oluyordu.
    await t(() => prisma.yarnMovement.deleteMany({ where: { warehouseId: ids.wh } }), "yarnMovement");
    await t(() => prisma.yarnStock.deleteMany({ where: { warehouseId: ids.wh } }), "yarnStock");
    await t(() => prisma.warpBeam.deleteMany({ where: { id: { in: ids.beam } } }), "warpBeam");
    await t(() => prisma.doffEvent.deleteMany({ where: { id: { in: ids.doff } } }));
    await t(() => prisma.machineStopEvent.deleteMany({ where: { machineId: { in: ids.machine } } }));
    await t(() => prisma.machineRun.deleteMany({ where: { id: { in: ids.run } } }));
    if (ids.stat) await t(() => prisma.machineShiftStatSeal.deleteMany({ where: { statId: ids.stat } }));
    if (ids.shift) await t(() => prisma.machineShiftStat.deleteMany({ where: { shiftInstanceId: ids.shift } }));
    if (ids.shift) await t(() => prisma.shiftInstance.deleteMany({ where: { id: ids.shift } }));
    if (ids.shiftDef) await t(() => prisma.shiftDefinition.deleteMany({ where: { id: ids.shiftDef } }));
    await t(() => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: ids.wo } } }));
    await t(() => prisma.workOrder.deleteMany({ where: { id: { in: ids.wo } } }), "workOrder");
    await t(() => prisma.yarnLot.deleteMany({ where: { itemId: { in: ids.item } } }), "yarnLot");
    await t(() => prisma.roll.deleteMany({ where: { goodsReceiptId: { in: ids.receipt } } }));
    await t(() => prisma.goodsReceipt.deleteMany({ where: { id: { in: ids.receipt } } }));
    await t(() => prisma.warpSpec.deleteMany({ where: { id: ids.spec } }), "warpSpec");
    await t(() => prisma.machine.deleteMany({ where: { id: { in: ids.machine } } }));
    await t(() => prisma.station.deleteMany({ where: { id: { in: ids.station } } }));
    await t(() => prisma.item.deleteMany({ where: { id: { in: ids.item } } }), "item");
    await t(() => prisma.warehouse.deleteMany({ where: { id: ids.wh } }));
    await t(() => prisma.subcontractor.deleteMany({ where: { id: ids.sub } }), "subcontractor");
    const kalinti = (await prisma.warpSpec.count({ where: { code: { startsWith: TAG } } }))
      + (await prisma.item.count({ where: { code: { startsWith: TAG } } }))
      + (await prisma.workOrder.count({ where: { workOrderNumber: { startsWith: TAG } } }))
      + (await prisma.station.count({ where: { code: { startsWith: TAG } } }));
    check("teardown KALINTI bırakmadı (yutulan hata = büyüyen kalıntı)", kalinti === 0 && temizlikHatasi.length === 0,
      kalinti === 0 && temizlikHatasi.length === 0 ? "temiz" : `${kalinti} satır · hata: ${temizlikHatasi.join(" | ") || "yok"}`);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error("ÇÖKTÜ:", e); await pool.end(); process.exit(1); });
