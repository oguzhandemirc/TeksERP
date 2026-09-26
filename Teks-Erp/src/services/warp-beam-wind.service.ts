// =============================================================================
// LEVENT SARIM SERVİSİ — devere Faz 1b: sar (WOUND + brüt iplik + dip iadesi) · sarım iptali (WOUND_CANCEL, NET ters)
// =============================================================================
// Tasarım: docs/design/DEVERE-LEVENT-TARAMASI.md §4.7. TEK YAZAR `helpers/warp-beam-event.helper` `applyWarpBeamEventTx`
// (ilk ifadesi devere kapısı; claim `updateMany WHERE status=from`) — olay satırı + durum kolonu + (IN_HOUSE) iplik satırları AYNI tx'te.
// Ters yol tipli `WOUND_CANCEL` + `reversesEventId @unique` (çift iptal DB'de imkânsız); iplik NET geri
// (§4.9-4: ISSUE ve RETURN toplamları AYRI AYRI sıfırlanır). Durum CANCELLED terminaldir — PLANNED'a DÖNMEZ.
// =============================================================================
import { Prisma, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, YarnMovementKind, ReasonPresetKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { readDevereLotRequired } from "./system-setting.service";
import { applyYarnMovementTx } from "./yarn.service";
import { assertWarpBeamReplayAlive, tokenReplay } from "./helpers/token-replay.helper";
import { resolveDenier, warpTheoreticalKg } from "../constants/warp-beam";
import { WARP_BEAM_SELECT } from "./helpers/warp-beam.helper";
import { applyWarpBeamEventTx, logWarpBeamEventAudit } from "./helpers/warp-beam-event.helper";
import { assertPhysicalBeamFreeTx, lineShares, siblingPhysicalNo } from "./helpers/warp-beam-set.helper";
import { nextBeamNoTx } from "./helpers/warp-beam.helper";
import { AuditService } from "./audit.service";
import { assertReturnReasonTx, kg, lotWarnings, siblingsOf, windResult, writeWoundTx, type WindResultDto } from "./helpers/warp-beam-wind-write.helper";
export type { WindResultDto };
import { toWarpBeamDto, toWarpBeamEventDto, type WarpBeamDto, type WarpBeamEventDto } from "./warp-beam.service";
import { resolveOwnerFromLotsTx } from "./helpers/emanet-owner.helper";
import { assertBeamWeavingLinkGate, assertWeavingOrderLinkableTx, warpSpecMismatchWarning } from "./helpers/production-chain-gates.helper";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

// ── SAR (PLANNED → READY, WOUND) ─────────────────────────────────────────────────
export interface YarnIssueLine {
  warehouseId: string;
  qtyKg: number | string;
  /** Devere Faz 2: tedarikçi lotu (opsiyonel). Lotsuz satır ya da >1 lot UYARI (`warnings`), `devere.lotRequired` açıksa lotsuz 400. */
  lotId?: string | null;
}
export interface YarnReturnLine extends YarnIssueLine {
  reasonCode: string;
}
export interface WindWarpBeamInput {
  lengthM: number | string;
  kgSource: WarpKgSource;
  /** IN_HOUSE kökeninde ZORUNLU (devere makinesi, `Station.producesWarpBeam`); diğer kökenlerde boş. */
  machineId?: string | null;
  /** IN_HOUSE: cağlığa yüklenen BRÜT iplik (≥ 1 satır); diğer kökenlerde YAZILMAZ (§3.9). */
  yarnIssues?: YarnIssueLine[];
  /** Dönen bobin dipleri — AYRI satır, sebep zorunlu (§3.7). */
  yarnReturns?: YarnReturnLine[];
  sectionCount?: number | null;
  endsPerSection?: number | null;
  breakCount?: number | null;
  startedAt?: Date | null;
  clientToken?: string | null;
  /**
   * G1c: yalnız SUBCONTRACT kökeninde — leventin sarıldığı iplik hangi fason sevk kaleminden gitti
   * (`SubcontractorDispatchItem.kind=YARN`, aynı fasoncu, aynı iplik kartı). Opsiyonel; verilirse WOUND
   * olayı bağı taşır ve fasondaki türetilmiş bakiye leventin nominal kg'sını ayrı kalem olarak düşer.
   */
  dispatchItemId?: string | null;
  /** RAŞEL TAKIMI (#23): kaç levent birlikte sarıldı (1..24; DEFAULT 1 = bugün). N>1 → N−1 kardeş aynı tx'te doğar, iplik ÷ N. */
  count?: number | null;
  /** Z1 (Y2): sarım anında iş bağı — verilirse plana yazılır (açık + IN_HOUSE iş), verilmezse plandaki kalır;
   *  `devere.beamWeavingLinkRequired` açıkken işsiz sarım 400. Kardeşler (takım) aynı bağı alır. */
  weavingOrderId?: string | null;
  /** Takımda gövde numarası öneki → `${önek}-${k}`; ilkinin kendi gövde no'su varsa korunur. */
  physicalBeamNoPrefix?: string | null;
}

/** G1c — iplik kalemi bağı kapısı (köken kapısı çağıranda): kalem YARN · sevk iptal edilmemiş · fasoncu leventinki · iplik kartı çözgünün ipliği. */
async function assertYarnDispatchItemTx(
  tx: Prisma.TransactionClient,
  dispatchItemId: string,
  beam: { subcontractorId: string | null; yarnItemId: string },
): Promise<void> {
  const item = await tx.subcontractorDispatchItem.findUnique({
    where: { id: dispatchItemId },
    select: { kind: true, yarnItemId: true, dispatch: { select: { subcontractorId: true, cancelledAt: true, dispatchNo: true } } },
  });
  if (!item || item.kind !== "YARN") throw AppError.badRequest("Böyle bir fason iplik kalemi yok", { code: "WARP_YARN_ITEM_NOT_FOUND" });
  if (item.dispatch.cancelledAt) throw AppError.conflict(`${item.dispatch.dispatchNo} iptal edilmiş — iplik kalemi bağlanamaz`, { code: "DISPATCH_CANCELLED" });
  if (item.dispatch.subcontractorId !== beam.subcontractorId) throw AppError.badRequest("İplik kalemi başka bir fasoncuya gitmiş — leventin fasoncusuyla uyuşmuyor", { code: "WARP_YARN_ITEM_MISMATCH" });
  if (item.yarnItemId !== beam.yarnItemId) throw AppError.badRequest("İplik kalemi çözgü kartının ipliği değil", { code: "WARP_YARN_ITEM_KIND" });
}

/** Köken ↔ girdi uyumu (tx DIŞI, DB'siz): IN_HOUSE makine+çıkış ister; fason/hazır satır yazmaz; iplik kalemi bağı (G1c) yalnız SUBCONTRACT. */
function assertOriginInputs(beam: { originKind: WarpBeamOrigin; beamNo: string }, input: WindWarpBeamInput, inHouse: boolean): void {
  const issues = input.yarnIssues ?? [];
  const returns = input.yarnReturns ?? [];
  if (input.dispatchItemId && beam.originKind !== WarpBeamOrigin.SUBCONTRACT) {
    throw AppError.badRequest(`${beam.beamNo} fasona sardırılmış değil — iplik kalemi bağı yalnız fason kökeninde yazılır`, { code: "WARP_YARN_ITEM_ORIGIN" });
  }
  if (inHouse) {
    if (!input.machineId) throw AppError.badRequest("İçeride sarılan levent için devere makinesi zorunludur");
    if (issues.length === 0) throw AppError.badRequest("İçeride sarılan levent için en az bir iplik çıkış satırı gerekir (cağlığa yüklenen brüt kg)");
  } else if (input.machineId || issues.length > 0 || returns.length > 0) {
    throw AppError.badRequest("Fasona sardırılan ya da hazır alınan levente makine ve iplik satırı yazılmaz — iplik tüketimi bizim defterde değil (§3.9)");
  }
}

async function assertDevereMachineTx(tx: Prisma.TransactionClient, machineId: string): Promise<void> {
  const m = await tx.machine.findUnique({ where: { id: machineId }, select: { isActive: true, station: { select: { producesWarpBeam: true, name: true } } } });
  if (!m || !m.isActive) throw AppError.badRequest("Devere makinesi bulunamadı ya da pasif");
  if (!m.station.producesWarpBeam) throw AppError.badRequest(`"${m.station.name}" istasyonu levent üretmez — makine bir devere istasyonunda olmalı (istasyon kartında "levent üretir").`, { code: "WARP_BEAM_MACHINE_NOT_DEVERE" });
}


/** Sarım replay'i: aynı levent + WOUND + aynı metre; sarımı iptal edilmiş levent 409 `WARP_BEAM_CANCELLED`. */
const windReplay = (id: string, input: WindWarpBeamInput) =>
  tokenReplay<{ beamId: string; kind: string; lengthM: Prisma.Decimal | null; beam: { id: string; beamNo: string; status: string; setKey: string | null } }, ApiResponse<WindResultDto>>({
    find: (db, clientToken) =>
      db.warpBeamEvent.findUnique({ where: { clientToken }, select: { beamId: true, kind: true, lengthM: true, beam: { select: { id: true, beamNo: true, status: true, setKey: true } } } }),
    alive: (p) => assertWarpBeamReplayAlive(p.beam),
    identity: (p) => [
      { ad: "beamId", mevcut: p.beamId, gelen: id },
      { ad: "kind", mevcut: p.kind, gelen: "WOUND" },
      { ad: "lengthM", mevcut: p.lengthM, gelen: kg(input.lengthM, "Sarılan metre") },
    ],
    collision: "Bu istemci anahtarı BAŞKA bir sarımla (farklı levent ya da metre) kullanılmış — formu yenileyip yeniden deneyin.",
    respond: (p) => windResult(id, p.beam.setKey, `${p.beam.beamNo} zaten sarılmış (yeniden gönderim)`, []),
  });

/** Levent sarımı (R): token her kuraldan önce okunur, sarım hangi hatayla düşerse düşsün yeniden okunur. */
export async function windWarpBeam(id: string, input: WindWarpBeamInput, userId?: string): Promise<ApiResponse<WindResultDto>> {
  return windReplay(id, input).run(input.clientToken, () => windWarpBeamFresh(id, input, userId));
}

async function windWarpBeamFresh(id: string, input: WindWarpBeamInput, userId?: string): Promise<ApiResponse<WindResultDto>> {
  const beam = await prisma.warpBeam.findUnique({ where: { id }, select: WARP_BEAM_SELECT });
  if (!beam) throw AppError.notFound("Levent bulunamadı");
  // RAŞEL TAKIMI (#23): N adet → aynı tx'te N−1 kardeş doğar ve sarılır; iplik payı ÷ N. DEFAULT 1 = bugün.
  const count = input.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 24) throw AppError.badRequest("Adet 1..24 olmalı");
  if (count > 1 && beam.setKey) throw AppError.conflict(`${beam.beamNo} zaten bir takımın parçası — takım yeniden açılamaz`, { code: "WARP_BEAM_SET_EXISTS" });
  const lengthM = kg(input.lengthM, "Sarılan metre");
  const denier = resolveDenier(beam.warpSpec.yarnItem);
  if (denier === null) throw AppError.badRequest(`"${beam.warpSpec.yarnItem.name}" kaleminin denye değeri boş — nominal kg hesaplanamaz; kalem kartından denyeyi girin.`, { code: "WARP_DENIER_MISSING" });
  const inHouse = beam.originKind === WarpBeamOrigin.IN_HOUSE;
  const issues = input.yarnIssues ?? [];
  const returns = input.yarnReturns ?? [];
  assertOriginInputs(beam, input, inHouse);
  const theoreticalKg = warpTheoreticalKg(beam.warpSpec.endsCount, denier, lengthM);
  const yarnItemId = beam.warpSpec.yarnItem.id;
  // K4 — KİLİT SIRASI: iplik satırları (kalem sabit) depo → sebep sırasına dizilir; iki paralel sarım depoları
  // ters sırayla kilitlerse FOR UPDATE 40P01'e düşer (`yarn-balance-guard` başlığı: kanonik sıra her yolun işi).
  const issuesSorted = [...issues].sort((a, b) => a.warehouseId.localeCompare(b.warehouseId) || (a.lotId ?? "").localeCompare(b.lotId ?? ""));
  const returnsSorted = [...returns].sort((a, b) => a.warehouseId.localeCompare(b.warehouseId) || a.reasonCode.localeCompare(b.reasonCode) || (a.lotId ?? "").localeCompare(b.lotId ?? ""));
  const warnings = inHouse ? await lotWarnings(issuesSorted, returnsSorted) : [];
  // Z1 (Y2): iş bağı — gövde > plandaki; bayrak açıkken işsiz sarım 400; çözgü kartı farkı uyarı (red değil).
  const weavingOrderId = input.weavingOrderId !== undefined ? input.weavingOrderId : beam.weavingOrderId;
  await assertBeamWeavingLinkGate(prisma, weavingOrderId);
  if (weavingOrderId && weavingOrderId !== beam.weavingOrderId) {
    const wo = await assertWeavingOrderLinkableTx(prisma, weavingOrderId);
    const w = warpSpecMismatchWarning(beam, wo);
    if (w) warnings.push(w);
  }
  // K6 — dip iadesi cağlığa yüklenenden FAZLA olamaz (fiziksel imkânsız; net tüketim eksiye düşerdi).
  const issueKg = issuesSorted.reduce((acc, l) => acc.plus(kg(l.qtyKg, "İplik çıkış kg")), D(0));
  const returnKg = returnsSorted.reduce((acc, l) => acc.plus(kg(l.qtyKg, "Dip iade kg")), D(0));
  if (returnKg.gt(issueKg)) {
    throw AppError.badRequest(`Dönen bobin dibi (${returnKg} kg) cağlığa yüklenen brüt çıkışı (${issueKg} kg) aşamaz.`, { code: "WARP_RETURN_EXCEEDS_ISSUE", issueKg: Number(issueKg), returnKg: Number(returnKg) });
  }
  if (count > 1 && inHouse && issueKg.gt(0)) {
    // Beyanlı yaklaşıklık uyarısı: takım toplam çıkışı N × nominalden %25'ten fazla sapıyorsa söyle (red değil).
    const nominalSet = theoreticalKg.mul(count);
    if (issueKg.minus(nominalSet).abs().gt(nominalSet.mul(0.25))) warnings.push(`Takım çıkışı ${issueKg} kg, ${count} × nominal ${nominalSet} kg'dan %25'ten fazla sapıyor — adet ya da kg'yi kontrol edin.`);
  }
  const prefix = input.physicalBeamNoPrefix?.trim() || null;
  const firstPhysical = siblingPhysicalNo(prefix, 1, beam.physicalBeamNo);
  // K5 — aynı metal gövdede canlı çözgü ön kontrolü (Türkçe 409; `physical_live_uq` ikinci hat, ham P2002 dönmesin).
  await assertPhysicalBeamFreeTx(prisma, beam.id, firstPhysical, beam.beamNo);
  const setKey = count > 1 ? crypto.randomUUID() : null;
  const issueShares = lineShares(issuesSorted, count);
  const returnShares = lineShares(returnsSorted, count);
  const ctx = { input, lengthM, denier, theoreticalKg, yarnItemId, userId, clientToken: null };

  // G3 EMANET KALITIMI: çıkış lotlarının sahibi tek ise levent (ve takım kardeşleri) onu alır — doğum yolu, PATCH değil;
  // leventin kendi sahibiyle çelişirse 409. Ownersız lotlar sahibi düşürmez; bayrak kapalıyken owner'lı lot zaten doğamaz.
  const lotOwner = await resolveOwnerFromLotsTx(prisma, issuesSorted.map((l) => l.lotId).filter((x): x is string => !!x));
  if (lotOwner && beam.ownerCustomerId && beam.ownerCustomerId !== lotOwner) {
    throw AppError.conflict(`${beam.beamNo} başka bir müşterinin emanet leventi — bu lotların sahibiyle uyuşmuyor`, { code: "OWNER_MISMATCH" });
  }
  const ownerCustomerId = beam.ownerCustomerId ?? lotOwner;
  const wound = await prisma.$transaction(async (tx) => {
    if (input.machineId) await assertDevereMachineTx(tx, input.machineId);
    if (input.dispatchItemId) await assertYarnDispatchItemTx(tx, input.dispatchItemId, { subcontractorId: beam.subcontractorId, yarnItemId });
    if (setKey || firstPhysical !== beam.physicalBeamNo || ownerCustomerId !== beam.ownerCustomerId || weavingOrderId !== beam.weavingOrderId) {
      await tx.warpBeam.updateMany({ where: { id, status: WarpBeamStatus.PLANNED }, data: { setKey, physicalBeamNo: firstPhysical, ownerCustomerId, weavingOrderId } });
    }
    // Token yalnız ilk leventin WOUND'unda (raşel kardeşleri token'sız); yazım yerinde açık alan — tarama görsün.
    const first = await writeWoundTx(tx, { id, endsCount: beam.warpSpec.endsCount }, { ...ctx, clientToken: input.clientToken ?? null }, { issues: issueShares[0], returns: returnShares[0] });
    for (let k = 2; k <= count; k++) {
      const physicalBeamNo = siblingPhysicalNo(prefix, k, null);
      await assertPhysicalBeamFreeTx(tx, null, physicalBeamNo, `${beam.beamNo} takımı ${k}. levent`);
      // k. kardeş AYNI tx'te PLANNED doğar (8029 sıralı LV no; klon: kart/köken/taraf/plan m/not) ve hemen sarılır.
      const sib = await tx.warpBeam.create({
        data: { beamNo: await nextBeamNoTx(tx, new Date()), warpSpecId: beam.warpSpecId, status: WarpBeamStatus.PLANNED, plannedLengthM: beam.plannedLengthM, physicalBeamNo, notes: beam.notes, originKind: beam.originKind, subcontractorId: beam.subcontractorId, supplierId: beam.supplierId, ownerCustomerId, weavingOrderId, setKey, createdById: userId ?? null },
        select: { id: true, beamNo: true },
      });
      await writeWoundTx(tx, { id: sib.id, endsCount: beam.warpSpec.endsCount }, { ...ctx, clientToken: null }, { issues: issueShares[k - 1], returns: returnShares[k - 1] });
    }
    return first;
  });
  await logWarpBeamEventAudit({ userId, eventId: wound.id, kind: "WOUND", data: { beamId: id, lengthM: Number(lengthM), theoreticalKg: Number(theoreticalKg), kgSource: input.kgSource, issues: issues.length, returns: returns.length, count, setKey, ...(lotOwner ? { ownerCustomerId: lotOwner, ownerInherited: true } : {}) } });
  const sibs = await siblingsOf(setKey, id);
  // Kardeş doğuşları audit'e (best-effort, tx dışında): her biri ayrı WARP_BEAM kaydıdır.
  for (const s of sibs) await AuditService.log({ userId, action: "CREATE", tableName: "WARP_BEAM", recordId: s.id, newData: { beamNo: s.beamNo, setKey, siblingOf: beam.beamNo, lengthM: Number(lengthM) } }).catch(() => undefined);
  const adlar = [beam.beamNo, ...sibs.map((s) => s.beamNo)].join(", ");
  return windResult(id, setKey, count > 1 ? `${adlar} sarıldı (${count} adet) — ${Number(lengthM)} m/levent, nominal ${Number(theoreticalKg)} kg/levent` : `${beam.beamNo} sarıldı — ${Number(lengthM)} m, nominal ${Number(theoreticalKg)} kg`, warnings);
}

// ── SARIMI İPTAL ET (READY → CANCELLED, WOUND_CANCEL) ───────────────────────────
export interface CancelWoundPreviewDto {
  beamNo: string;
  status: WarpBeamStatus;
  wound: WarpBeamEventDto | null;
  /** Ters kayıtla depoya DÖNECEK çıkışlar (kalem × depo, net) ve DÜŞECEK dip iadeleri (× sebep). */
  issueReversals: Array<{ warehouse: { id: string; name: string }; lot: { id: string; lotNo: string } | null; qtyKg: number }>;
  returnReversals: Array<{ warehouse: { id: string; name: string }; lot: { id: string; lotNo: string } | null; reasonCode: string; qtyKg: number }>;
  /** Sarım iptalinde gerekçe HER ZAMAN zorunlu (`cancelSchema` min 3) — bayraktan bağımsız; istemci tek alandan okur. */
  reasonRequired: true;
}

type YarnGroup = Map<string, { warehouseId: string; warehouseName: string; lot: { id: string; lotNo: string } | null; reasonCode: string | null; qty: Prisma.Decimal }>;

// Gruplama anahtarı depo × LOT (× sebep): ters kayıt lot bazında düşer, yoksa lot bakiyesi şişerdi (§4.9-4 "kalem × depo × lot").
async function groupYarnLinesTx(client: Prisma.TransactionClient | typeof prisma, beamId: string): Promise<{ issues: YarnGroup; returns: YarnGroup }> {
  const rows = await client.yarnMovement.findMany({ where: { warpBeamId: beamId }, select: { kind: true, qtyKg: true, reasonCode: true, warehouse: { select: { id: true, name: true } }, lot: { select: { id: true, lotNo: true } } } });
  const issues: YarnGroup = new Map();
  const returns: YarnGroup = new Map();
  const add = (g: YarnGroup, key: string, r: (typeof rows)[number], sign: 1 | -1) => {
    const cur = g.get(key) ?? { warehouseId: r.warehouse.id, warehouseName: r.warehouse.name, lot: r.lot, reasonCode: r.reasonCode, qty: D(0) };
    cur.qty = cur.qty.plus(D(r.qtyKg).mul(sign));
    g.set(key, cur);
  };
  const lotKey = (r: (typeof rows)[number]) => r.lot?.id ?? "";
  for (const r of rows) {
    // NET: ileri satır + tersi ayrı ayrı toplanır (iki toplam birbirini götürmez — §4.9-4).
    if (r.kind === YarnMovementKind.WARP_ISSUE) add(issues, `${r.warehouse.id}|${lotKey(r)}`, r, 1);
    else if (r.kind === YarnMovementKind.WARP_ISSUE_REVERSAL) add(issues, `${r.warehouse.id}|${lotKey(r)}`, r, -1);
    else if (r.kind === YarnMovementKind.WARP_RETURN) add(returns, `${r.warehouse.id}|${r.reasonCode}|${lotKey(r)}`, r, 1);
    else if (r.kind === YarnMovementKind.WARP_RETURN_REVERSAL) add(returns, `${r.warehouse.id}|${r.reasonCode}|${lotKey(r)}`, r, -1);
  }
  return { issues, returns };
}

export async function cancelWoundPreview(id: string): Promise<ApiResponse<CancelWoundPreviewDto>> {
  const beam = await prisma.warpBeam.findUnique({ where: { id }, select: WARP_BEAM_SELECT });
  if (!beam) throw AppError.notFound("Levent bulunamadı");
  const { issues, returns } = await groupYarnLinesTx(prisma, id);
  return {
    success: true,
    data: {
      beamNo: beam.beamNo,
      status: beam.status,
      wound: beam.events[0] ? toWarpBeamEventDto(beam.events[0]) : null,
      issueReversals: [...issues.values()].filter((g) => g.qty.gt(0)).map((g) => ({ warehouse: { id: g.warehouseId, name: g.warehouseName }, lot: g.lot, qtyKg: Number(g.qty) })),
      returnReversals: [...returns.values()].filter((g) => g.qty.gt(0)).map((g) => ({ warehouse: { id: g.warehouseId, name: g.warehouseName }, lot: g.lot, reasonCode: g.reasonCode ?? "", qtyKg: Number(g.qty) })),
      reasonRequired: true,
    },
  };
}

/**
 * Doğuşun STORNOSU: WOUND_CANCEL (`reversesEventId` = WOUND, tek ters) + iplik NET geri.
 * Durum CANCELLED'a (terminal) gider — PLANNED'a dönmez: `one_wound_uq` yüzünden bir daha sarılamazdı.
 */
export async function cancelWound(id: string, reason: string, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  const beam = await prisma.warpBeam.findUnique({ where: { id }, select: WARP_BEAM_SELECT });
  if (!beam) throw AppError.notFound("Levent bulunamadı");
  const wound = beam.events[0];
  if (!wound) throw AppError.conflict(`${beam.beamNo} hiç sarılmamış — plandaki levent iptal edilmez, silinir`, { code: "WARP_BEAM_NOT_WOUND" });
  const yarnItemId = beam.warpSpec.yarnItem.id;
  const cancel = await prisma.$transaction(async (tx) => {
    const ev = await applyWarpBeamEventTx(tx, {
      beamId: id,
      kind: "WOUND_CANCEL",
      from: WarpBeamStatus.READY,
      to: WarpBeamStatus.CANCELLED,
      data: { reversesEventId: wound.id, lengthM: wound.lengthM, machineId: wound.machineId, reason: reason.trim(), createdById: userId ?? null },
    });
    const { issues, returns } = await groupYarnLinesTx(tx, id);
    for (const g of issues.values()) {
      if (g.qty.gt(0)) await applyYarnMovementTx(tx, { itemId: yarnItemId, warehouseId: g.warehouseId, kind: YarnMovementKind.WARP_ISSUE_REVERSAL, qtyKg: g.qty, warpBeamId: id, lotId: g.lot?.id ?? null, reason: reason.trim(), userId: userId ?? null });
    }
    for (const g of returns.values()) {
      if (g.qty.gt(0)) await applyYarnMovementTx(tx, { itemId: yarnItemId, warehouseId: g.warehouseId, kind: YarnMovementKind.WARP_RETURN_REVERSAL, qtyKg: g.qty, warpBeamId: id, reasonCode: g.reasonCode, lotId: g.lot?.id ?? null, reason: reason.trim(), userId: userId ?? null });
    }
    return ev;
  });
  await logWarpBeamEventAudit({ userId, eventId: cancel.id, kind: "WOUND_CANCEL", data: { beamId: id, reversesEventId: wound.id, reason: reason.trim() } });
  const fresh = await prisma.warpBeam.findUniqueOrThrow({ where: { id }, select: WARP_BEAM_SELECT });
  return { success: true, data: toWarpBeamDto(fresh, 0), message: `${fresh.beamNo} sarımı iptal edildi — iplik net geri döndü` };
}

