// =============================================================================
// EMANET ÇIKIŞ — ADAY LİSTESİ (`GET /api/consignment-dispatches/candidates`, T1 + panel seçicileri)
// =============================================================================
// Sahibin çıkabilecek leventleri (READY) ve depo bakiyeli lotları (lot × depo). Sahip süzgeci SUNUCUDA, satır
// tavanı sorgunun kendisinde (`take` / `LIMIT`), seçilebilirlik oluştur çözücüsüyle TEK yüklem (`eligibility.ts`).
// Depo rolü levent/iplik listesi izni taşımaz — bu uç yalnız `consignment:write ∨ mobile:depo` ister.
// =============================================================================
import { Prisma, WarpBeamStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { escapeLikeTerm } from "../../utils/like-escape";
import { readDevereEnabled, readIplikEnabled } from "../system-setting.service";
import { remainingByBeam } from "../helpers/warp-beam.helper";
import { signedQtySql } from "../helpers/yarn-lot.helper";
import { beamBlockedReason, yarnBlockedReason } from "./eligibility";
import type { ConsignmentCandidates } from "./candidate-types";

export const CANDIDATE_DEFAULT_LIMIT = 50;
export const CANDIDATE_MAX_LIMIT = 100;

export interface CandidateQuery { ownerCustomerId: string; search?: string; limit: number }

async function beamCandidates(q: CandidateQuery): Promise<{ rows: ConsignmentCandidates["beams"]; truncated: boolean }> {
  const term = q.search ? escapeLikeTerm(q.search) : null;
  const rows = await prisma.warpBeam.findMany({
    where: {
      ownerCustomerId: q.ownerCustomerId,
      status: WarpBeamStatus.READY,
      ...(term ? { OR: [{ beamNo: { contains: term, mode: "insensitive" } }, { warpSpec: { is: { name: { contains: term, mode: "insensitive" } } } }] } : {}),
    },
    orderBy: [{ beamNo: "asc" }, { id: "asc" }],
    take: q.limit + 1,
    select: { id: true, beamNo: true, status: true, ownerCustomerId: true, warpSpec: { select: { name: true } } },
  });
  const page = rows.slice(0, q.limit);
  const remaining = await remainingByBeam(prisma, page.map((b) => b.id));
  return {
    truncated: rows.length > q.limit,
    rows: page.map((b) => {
      const remainingM = new Prisma.Decimal(remaining.get(b.id) ?? 0);
      return {
        warpBeamId: b.id, beamNo: b.beamNo, warpSpecName: b.warpSpec?.name ?? null, remainingM: remainingM.toFixed(3),
        blockedReason: beamBlockedReason({ ownerCustomerId: b.ownerCustomerId, status: b.status, remainingM }, q.ownerCustomerId),
      };
    }),
  };
}

interface YarnRow {
  lotId: string; lotNo: string; isActive: boolean; ownerCustomerId: string | null; itemId: string; itemCode: string; itemName: string;
  warehouseId: string; warehouseName: string; balance: string | number | Prisma.Decimal;
}

async function yarnCandidates(q: CandidateQuery): Promise<{ rows: ConsignmentCandidates["yarns"]; truncated: boolean }> {
  const like = q.search ? `%${escapeLikeTerm(q.search)}%` : null;
  // Bakiye lot × depo düzeyinde (oluştur kapısıyla aynı işaret tablosu); sıfır bakiyeli çift listeye girmez.
  const rows = await prisma.$queryRaw<YarnRow[]>`
    SELECT l."id" AS "lotId", l."lotNo", l."isActive", l."ownerCustomerId", l."itemId", i."code" AS "itemCode", i."name" AS "itemName",
           m."warehouseId", w."name" AS "warehouseName", SUM(${signedQtySql()}) AS balance
    FROM "yarn_movements" m
    JOIN "yarn_lots" l ON l."id" = m."lotId"
    JOIN "items" i ON i."id" = l."itemId"
    JOIN "warehouses" w ON w."id" = m."warehouseId"
    WHERE l."ownerCustomerId" = ${q.ownerCustomerId}::uuid
      ${like ? Prisma.sql`AND (l."lotNo" ILIKE ${like} OR i."code" ILIKE ${like} OR i."name" ILIKE ${like})` : Prisma.empty}
    GROUP BY l."id", l."lotNo", l."isActive", l."ownerCustomerId", l."itemId", i."code", i."name", m."warehouseId", w."name"
    HAVING SUM(${signedQtySql()}) > 0
    ORDER BY l."lotNo", w."name", l."id", m."warehouseId"
    LIMIT ${q.limit + 1}
  `;
  const page = rows.slice(0, q.limit);
  return {
    truncated: rows.length > q.limit,
    rows: page.map((r) => {
      const balanceKg = new Prisma.Decimal(String(r.balance));
      return {
        lotId: r.lotId, lotNo: r.lotNo, yarnItemId: r.itemId, itemCode: r.itemCode, itemName: r.itemName,
        warehouseId: r.warehouseId, warehouseName: r.warehouseName, balanceKg: balanceKg.toFixed(3),
        blockedReason: yarnBlockedReason({ ownerCustomerId: r.ownerCustomerId, isActive: r.isActive, balanceKg }, q.ownerCustomerId),
      };
    }),
  };
}

/** Kapalı modülün listesi boş döner (403 değil): aynı ekran diğer türü hâlâ çıkarabilir; `modules` hangisinin kapalı olduğunu söyler. */
export async function listConsignmentCandidates(q: CandidateQuery): Promise<ConsignmentCandidates> {
  const owner = await prisma.customer.findUnique({ where: { id: q.ownerCustomerId }, select: { id: true, name: true } });
  if (!owner) throw AppError.notFound("Sahip müşteri bulunamadı.", { code: "OWNER_CUSTOMER_INVALID" });
  const devere = await readDevereEnabled(prisma);
  const iplik = await readIplikEnabled(prisma);
  const beams = devere ? await beamCandidates(q) : { rows: [], truncated: false };
  const yarns = iplik ? await yarnCandidates(q) : { rows: [], truncated: false };
  return {
    ownerCustomer: owner,
    modules: { devere, iplik },
    beams: beams.rows,
    yarns: yarns.rows,
    truncated: { beams: beams.truncated, yarns: yarns.truncated },
  };
}
