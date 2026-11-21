// =============================================================================
// DEVERE F1 — DENYE SAPMA raporu + iplik kartı denye güncellemesi ([Uygula])
// =============================================================================
// Rapor YALNIZ OKUR: kabul edilmiş (K3) + tartılı devere sarımları, süzgeç sunucuda, gün = kabulün FABRİKA günü.
// [Uygula] kartı kullanıcı onayıyla değiştirir: atomik `updateMany WHERE {id, YARN, linearDensityDen = beklenen}`;
// kart arada değişmişse 409 `DENIER_CHANGED`. Geçmiş WOUND/kırılım kopyaları DEĞİŞMEZ (doğuş gerçeği).
// =============================================================================
import { ItemType, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { factoryYmd, resolveRangeEnd, resolveRangeStart } from "../constants/time";
import { readDevereDenierSuggestMinBeams, readDevereDenierSuggestThresholdPct } from "./system-setting.service";
import { ACCEPTED_WARPING_BEAM_WHERE } from "./helpers/warping-fee.helper";
import { computeDenierDeviation, type DenierDeviationResult, type DenierSampleBeam, type DenierYarnCard } from "./helpers/denier-deviation.helper";

const DAY_MS = 86_400_000;
/** Varsayılan pencere (gün) — denye kalibrasyonu için yeterli örnek, raporun açılışı hızlı. */
export const DENIER_DEVIATION_DEFAULT_DAYS = 90;
export const DENIER_DEVIATION_MAX_DAYS = 366;
/** `Item.linearDensityDen` Decimal(10,4) tavanı. */
export const DENIER_MAX = 999_999;

export interface DenierDeviationQuery { from?: string; to?: string; yarnItemId?: string; subcontractorId?: string }

export interface DenierDeviationReport extends DenierDeviationResult {
  range: { from: string; to: string };
  settings: { minBeams: number; thresholdPct: number };
}

/** Takvimde var olan fabrika günü mü ("2026-02-30" ayrıştırıcıda kayar → reddedilir). */
function assertDay(v: string): void {
  const start = resolveRangeStart(v);
  if (Number.isNaN(start.getTime()) || factoryYmd(new Date(start.getTime() + DAY_MS / 2)) !== v) {
    throw AppError.badRequest(`Geçersiz gün: ${v} (YYYY-MM-DD)`, { code: "INVALID_RANGE" });
  }
}

function resolveRange(q: DenierDeviationQuery): { from: string; to: string; gte: Date; lte: Date } {
  const to = q.to ?? factoryYmd();
  assertDay(to);
  // Yalnız `to` verildiyse pencere ona dayanır (gün ortası çıpa: dilim kayması günü atlatmaz).
  const anchor = q.to ? resolveRangeStart(q.to).getTime() + DAY_MS / 2 : Date.now();
  const from = q.from ?? factoryYmd(new Date(anchor - (DENIER_DEVIATION_DEFAULT_DAYS - 1) * DAY_MS));
  assertDay(from);
  const gte = resolveRangeStart(from);
  const lte = resolveRangeEnd(to);
  if (gte > lte) throw AppError.badRequest("Başlangıç günü bitiş gününden sonra olamaz", { code: "INVALID_RANGE" });
  if (lte.getTime() - gte.getTime() > DENIER_DEVIATION_MAX_DAYS * DAY_MS) throw AppError.badRequest(`Aralık en çok ${DENIER_DEVIATION_MAX_DAYS} gün olabilir`, { code: "INVALID_RANGE" });
  return { from, to, gte, lte };
}

/** Rapor: iplik başına nominal ↔ tartı farkı + öneri durumu; çok iplikli sarımlar tek "karma" satırı. */
export async function getDenierDeviationReport(q: DenierDeviationQuery): Promise<DenierDeviationReport> {
  const range = resolveRange(q);
  // F6: dara kabulde tartılmadıysa gövde kartındaki dara yedektir (örnek `tareSource: BODY` etiketiyle sayılır).
  const woundWhere = {
    kind: "WOUND",
    reversal: { is: null },
    grossKg: { not: null },
    lengthM: { not: null },
    createdAt: { gte: range.gte, lte: range.lte },
  } satisfies Prisma.WarpBeamEventWhereInput;
  const beams = await prisma.warpBeam.findMany({
    where: {
      AND: [
        ACCEPTED_WARPING_BEAM_WHERE,
        { OR: [{ events: { some: { ...woundWhere, tareKg: { not: null } } } }, { events: { some: woundWhere }, beamBody: { tareKg: { not: null } } }] },
        ...(q.subcontractorId ? [{ warpingOrder: { subcontractorId: q.subcontractorId } }] : []),
        ...(q.yarnItemId ? [{ events: { some: { ...woundWhere, yarns: { some: { yarnItemId: q.yarnItemId } } } } }] : []),
      ],
    },
    select: {
      beamBody: { select: { tareKg: true } },
      events: {
        where: woundWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 1,
        select: { lengthM: true, grossKg: true, tareKg: true, yarns: { select: { yarnItemId: true, endsCount: true, denier: true, theoreticalKg: true } } },
      },
    },
  });
  const samples: DenierSampleBeam[] = [];
  for (const b of beams) {
    const e = b.events[0];
    if (!e || e.lengthM === null || e.grossKg === null) continue;
    const bodyTare = b.beamBody?.tareKg ?? null;
    if (e.tareKg !== null) samples.push({ lengthM: e.lengthM, grossKg: e.grossKg, tareKg: e.tareKg, tareSource: "WEIGHED", yarns: e.yarns });
    else if (bodyTare !== null) samples.push({ lengthM: e.lengthM, grossKg: e.grossKg, tareKg: bodyTare, tareSource: "BODY", yarns: e.yarns });
  }
  const yarnIds = [...new Set(samples.flatMap((s) => s.yarns.map((y) => y.yarnItemId)))];
  const cards = yarnIds.length === 0 ? [] : await prisma.item.findMany({
    where: { id: { in: yarnIds } },
    select: { id: true, code: true, name: true, linearDensityDen: true },
  });
  const settings = { minBeams: await readDevereDenierSuggestMinBeams(), thresholdPct: await readDevereDenierSuggestThresholdPct() };
  const result = computeDenierDeviation(samples, new Map<string, DenierYarnCard>(cards.map((c) => [c.id, c])), settings);
  return { range: { from: range.from, to: range.to }, settings, ...result };
}

export interface ApplyDenierInput {
  yarnItemId: string;
  /** Raporun gösterdiği GÜNCEL kart denyesi (`cardDenier`); null = kart boştu. */
  expectedDenier: string | null;
  newDenier: string;
}

export interface ApplyDenierResult { yarnItemId: string; oldDenier: string | null; newDenier: string; unchanged: boolean }

function parseDenier(v: string, label: string): Prisma.Decimal {
  let d: Prisma.Decimal;
  try {
    d = new Prisma.Decimal(v);
  } catch {
    throw AppError.badRequest(`${label} sayı olmalı`, { code: "DENIER_INVALID" });
  }
  if (!d.isFinite() || d.lte(0) || d.gt(DENIER_MAX)) throw AppError.badRequest(`${label} 0'dan büyük, en çok ${DENIER_MAX} olmalı`, { code: "DENIER_INVALID" });
  return d.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/** [Uygula]: iplik kartı denyesini atomik günceller; kart arada değişmişse 409, aynı değer zaten yazılıysa idempotent. */
export async function applyDenierSuggestion(input: ApplyDenierInput, userId: string): Promise<ApplyDenierResult> {
  const next = parseDenier(input.newDenier, "Yeni denye");
  const expected = input.expectedDenier === null ? null : parseDenier(input.expectedDenier, "Beklenen denye");
  const claimed = await prisma.item.updateMany({
    where: { id: input.yarnItemId, itemType: ItemType.YARN, linearDensityDen: expected },
    data: { linearDensityDen: next, updatedById: userId },
  });
  if (claimed.count === 0) {
    const now = await prisma.item.findUnique({ where: { id: input.yarnItemId }, select: { itemType: true, linearDensityDen: true } });
    if (!now) throw AppError.notFound("İplik kartı bulunamadı");
    if (now.itemType !== ItemType.YARN) throw AppError.badRequest("Denye yalnız iplik kartına yazılır", { code: "DENIER_NOT_YARN" });
    // Yeniden deneme (ilk istek yazdı, cevap kayboldu): kart zaten hedefte → yazma yok, audit yok.
    if (now.linearDensityDen !== null && now.linearDensityDen.eq(next)) {
      return { yarnItemId: input.yarnItemId, oldDenier: now.linearDensityDen.toString(), newDenier: next.toString(), unchanged: true };
    }
    throw AppError.conflict(
      `İplik kartının denyesi rapor açıldıktan sonra değişmiş (şu an ${now.linearDensityDen?.toString() ?? "boş"}). Raporu yenileyip tekrar deneyin.`,
      { code: "DENIER_CHANGED", currentDenier: now.linearDensityDen?.toString() ?? null },
    );
  }
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "ITEM",
    recordId: input.yarnItemId,
    oldData: { linearDensityDen: expected?.toString() ?? null },
    newData: { linearDensityDen: next.toString(), source: "denier-deviation" },
  });
  return { yarnItemId: input.yarnItemId, oldDenier: expected?.toString() ?? null, newDenier: next.toString(), unchanged: false };
}
