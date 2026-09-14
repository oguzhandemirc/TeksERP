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
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import { resolveDenier, warpTheoreticalKg } from "../constants/warp-beam";
import { WARP_BEAM_SELECT } from "./helpers/warp-beam.helper";
import { applyWarpBeamEventTx, logWarpBeamEventAudit } from "./helpers/warp-beam-event.helper";
import { toWarpBeamDto, toWarpBeamEventDto, type WarpBeamDto, type WarpBeamEventDto } from "./warp-beam.service";

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
}

async function assertDevereMachineTx(tx: Prisma.TransactionClient, machineId: string): Promise<void> {
  const m = await tx.machine.findUnique({ where: { id: machineId }, select: { isActive: true, station: { select: { producesWarpBeam: true, name: true } } } });
  if (!m || !m.isActive) throw AppError.badRequest("Devere makinesi bulunamadı ya da pasif");
  if (!m.station.producesWarpBeam) throw AppError.badRequest(`"${m.station.name}" istasyonu levent üretmez — makine bir devere istasyonunda olmalı (istasyon kartında "levent üretir").`, { code: "WARP_BEAM_MACHINE_NOT_DEVERE" });
}

async function assertReturnReasonTx(tx: Prisma.TransactionClient, code: string): Promise<string> {
  const trimmed = code.trim();
  const row = await tx.reasonPreset.findFirst({ where: { kind: ReasonPresetKind.WARP_RETURN, code: trimmed, isActive: true }, select: { code: true } });
  if (!row) throw AppError.badRequest(`Geçersiz dip iade sebebi: ${trimmed}`, { code: "REASON_CODE_INVALID" });
  return row.code;
}

/** Aynı gövde numarasında (tr_fold) başka bir CANLI (READY | SHIPPED_OUT — fasondaki çözgü gövdeyi işgal eder) çözgü varsa 409 — kısıt `warp_beams_physical_live_uq` ikinci hattır. */
async function assertPhysicalBeamFree(beamId: string, physicalBeamNo: string | null, beamNo: string): Promise<void> {
  if (!physicalBeamNo) return;
  const rows = await prisma.$queryRaw<Array<{ beamNo: string }>>`
    SELECT "beamNo" FROM warp_beams
    WHERE public.tr_fold("physicalBeamNo") = public.tr_fold(${physicalBeamNo}) AND status IN ('READY', 'SHIPPED_OUT') AND id <> ${beamId}::uuid
    LIMIT 1`;
  if (rows[0]) {
    throw AppError.conflict(`"${physicalBeamNo}" gövdesinde canlı bir çözgü var: ${rows[0].beamNo} — ${beamNo} sarılamaz; gövdeyi boşaltın ya da başka gövde yazın.`, { code: "WARP_BEAM_PHYSICAL_BUSY", busyBeamNo: rows[0].beamNo });
  }
}

function kg(v: number | string, ad: string): Prisma.Decimal {
  const d = D(v).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  if (!d.isFinite() || d.lte(0)) throw AppError.badRequest(`${ad} sıfırdan büyük olmalı`);
  return d;
}


export async function windWarpBeam(id: string, input: WindWarpBeamInput, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  const beam = await prisma.warpBeam.findUnique({ where: { id }, select: WARP_BEAM_SELECT });
  if (!beam) throw AppError.notFound("Levent bulunamadı");
  if (input.clientToken) {
    const replay = await prisma.warpBeamEvent.findUnique({ where: { clientToken: input.clientToken }, select: { beamId: true, kind: true } });
    if (replay) {
      assertReplayPayloadMatches([{ ad: "beamId", mevcut: replay.beamId, gelen: id }, { ad: "kind", mevcut: replay.kind, gelen: "WOUND" }], "Bu istemci anahtarı BAŞKA bir sarımla kullanılmış — formu yenileyip yeniden deneyin.");
      return { success: true, data: toWarpBeamDto(beam), message: `${beam.beamNo} zaten sarılmış (yeniden gönderim)` };
    }
  }
  const lengthM = kg(input.lengthM, "Sarılan metre");
  const denier = resolveDenier(beam.warpSpec.yarnItem);
  if (denier === null) throw AppError.badRequest(`"${beam.warpSpec.yarnItem.name}" kaleminin denye değeri boş — nominal kg hesaplanamaz; kalem kartından denyeyi girin.`, { code: "WARP_DENIER_MISSING" });
  const inHouse = beam.originKind === WarpBeamOrigin.IN_HOUSE;
  const issues = input.yarnIssues ?? [];
  const returns = input.yarnReturns ?? [];
  if (inHouse) {
    if (!input.machineId) throw AppError.badRequest("İçeride sarılan levent için devere makinesi zorunludur");
    if (issues.length === 0) throw AppError.badRequest("İçeride sarılan levent için en az bir iplik çıkış satırı gerekir (cağlığa yüklenen brüt kg)");
  } else if (input.machineId || issues.length > 0 || returns.length > 0) {
    throw AppError.badRequest("Fasona sardırılan ya da hazır alınan levente makine ve iplik satırı yazılmaz — iplik tüketimi bizim defterde değil (§3.9)");
  }
  const theoreticalKg = warpTheoreticalKg(beam.warpSpec.endsCount, denier, lengthM);
  const yarnItemId = beam.warpSpec.yarnItem.id;
  // K4 — KİLİT SIRASI: iplik satırları (kalem sabit) depo → sebep sırasına dizilir; iki paralel sarım depoları
  // ters sırayla kilitlerse FOR UPDATE 40P01'e düşer (`yarn-balance-guard` başlığı: kanonik sıra her yolun işi).
  const issuesSorted = [...issues].sort((a, b) => a.warehouseId.localeCompare(b.warehouseId) || (a.lotId ?? "").localeCompare(b.lotId ?? ""));
  const returnsSorted = [...returns].sort((a, b) => a.warehouseId.localeCompare(b.warehouseId) || a.reasonCode.localeCompare(b.reasonCode) || (a.lotId ?? "").localeCompare(b.lotId ?? ""));
  // LOT (Faz 2, §3.5): lot ZORUNLU DEĞİL — lotsuz ya da karışık lot REDDEDİLMEZ, uyarı üretir
  // (levent içi lot karışımı boyuna ÇÖZGÜ YOLU riski). `devere.lotRequired` [PROFİL] açıksa
  // içeride sarımda lotsuz çıkış satırı 400; varsayılan KAPALI = bugünkü davranış.
  const warnings: string[] = [];
  if (inHouse) {
    const lotsuz = issuesSorted.filter((l) => !l.lotId).length;
    if (lotsuz > 0 && (await readDevereLotRequired())) {
      throw AppError.badRequest(`İplik çıkış satırında lot zorunlu (ayar: "Devere — lot zorunlu"): ${lotsuz} satır lotsuz.`, { code: "YARN_LOT_REQUIRED" });
    }
    const lotlar = new Set(issuesSorted.map((l) => l.lotId).filter((x): x is string => !!x));
    if (lotsuz > 0 && lotlar.size > 0) warnings.push(`${lotsuz} iplik çıkış satırı lotsuz — levent lot izi eksik kalır.`);
    else if (lotsuz > 0) warnings.push("İplik çıkışı lotsuz — bu levent lot izlemesine girmez (lotsuz sarılan levent lotsuz kalır).");
    if (lotlar.size > 1) warnings.push(`Levente ${lotlar.size} farklı iplik lotu yüklendi — levent içi lot farkı boyuna çözgü yolu üretebilir.`);
    const iadeDisi = returnsSorted.filter((l) => l.lotId && !lotlar.has(l.lotId)).length;
    if (iadeDisi > 0) warnings.push(`${iadeDisi} dip iadesi satırı bu leventin çıkış lotlarından olmayan bir lotu taşıyor.`);
  }
  // K6 — dip iadesi cağlığa yüklenenden FAZLA olamaz (fiziksel imkânsız; net tüketim eksiye düşerdi).
  const issueKg = issuesSorted.reduce((acc, l) => acc.plus(kg(l.qtyKg, "İplik çıkış kg")), D(0));
  const returnKg = returnsSorted.reduce((acc, l) => acc.plus(kg(l.qtyKg, "Dip iade kg")), D(0));
  if (returnKg.gt(issueKg)) {
    throw AppError.badRequest(`Dönen bobin dibi (${returnKg} kg) cağlığa yüklenen brüt çıkışı (${issueKg} kg) aşamaz.`, { code: "WARP_RETURN_EXCEEDS_ISSUE", issueKg: Number(issueKg), returnKg: Number(returnKg) });
  }
  // K5 — aynı metal gövdede canlı çözgü ön kontrolü (Türkçe 409; `physical_live_uq` ikinci hat, ham P2002 dönmesin).
  await assertPhysicalBeamFree(beam.id, beam.physicalBeamNo, beam.beamNo);

  const wound = await prisma.$transaction(async (tx) => {
    if (input.machineId) await assertDevereMachineTx(tx, input.machineId);
    const ev = await applyWarpBeamEventTx(tx, {
      beamId: id,
      kind: "WOUND",
      from: WarpBeamStatus.PLANNED,
      to: WarpBeamStatus.READY,
      data: {
        clientToken: input.clientToken ?? null,
        lengthM,
        machineId: input.machineId ?? null,
        endsCount: beam.warpSpec.endsCount,
        denier,
        theoreticalKg,
        kgSource: input.kgSource,
        sectionCount: input.sectionCount ?? null,
        endsPerSection: input.endsPerSection ?? null,
        breakCount: input.breakCount ?? null,
        startedAt: input.startedAt ?? null,
        createdById: userId ?? null,
      },
    });
    for (const line of issuesSorted) {
      await applyYarnMovementTx(tx, { itemId: yarnItemId, warehouseId: line.warehouseId, kind: YarnMovementKind.WARP_ISSUE, qtyKg: kg(line.qtyKg, "İplik çıkış kg"), warpBeamId: id, lotId: line.lotId ?? null, userId: userId ?? null });
    }
    for (const line of returnsSorted) {
      const reasonCode = await assertReturnReasonTx(tx, line.reasonCode);
      await applyYarnMovementTx(tx, { itemId: yarnItemId, warehouseId: line.warehouseId, kind: YarnMovementKind.WARP_RETURN, qtyKg: kg(line.qtyKg, "Dip iade kg"), warpBeamId: id, reasonCode, lotId: line.lotId ?? null, userId: userId ?? null });
    }
    return ev;
  });
  await logWarpBeamEventAudit({ userId, eventId: wound.id, kind: "WOUND", data: { beamId: id, lengthM: Number(lengthM), theoreticalKg: Number(theoreticalKg), kgSource: input.kgSource, issues: issues.length, returns: returns.length } });
  const fresh = await prisma.warpBeam.findUniqueOrThrow({ where: { id }, select: WARP_BEAM_SELECT });
  return { success: true, data: toWarpBeamDto(fresh), message: `${fresh.beamNo} sarıldı — ${Number(lengthM)} m, nominal ${Number(theoreticalKg)} kg`, ...(warnings.length ? { warnings } : {}) };
}

// ── SARIMI İPTAL ET (READY → CANCELLED, WOUND_CANCEL) ───────────────────────────
export interface CancelWoundPreviewDto {
  beamNo: string;
  status: WarpBeamStatus;
  wound: WarpBeamEventDto | null;
  /** Ters kayıtla depoya DÖNECEK çıkışlar (kalem × depo, net) ve DÜŞECEK dip iadeleri (× sebep). */
  issueReversals: Array<{ warehouse: { id: string; name: string }; lot: { id: string; lotNo: string } | null; qtyKg: number }>;
  returnReversals: Array<{ warehouse: { id: string; name: string }; lot: { id: string; lotNo: string } | null; reasonCode: string; qtyKg: number }>;
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

