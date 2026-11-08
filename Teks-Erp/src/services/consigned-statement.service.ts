// =============================================================================
// EMANET EKSTRESİ — müşteri malı dönem mutabakatı (genel fason F2, 2026-11-08) — salt okuma
// =============================================================================
// "Dönemde ne aldınız, ne gönderdiniz (BRÜT), fasondan ne çıktı, ne fire verdiniz, ne kaldı?"
// DEFTERDEN as-of türetilir (durum tablosundan değil): geçmiş dönem yeni kayıtla değişmez, storno kendi
// anında ayrı satırdır. Yeni defter YOK — kaynaklar `consigned-statement/*-ledger.ts` başlıklarında.
// Dönem fabrika günüdür (`constants/time.ts`); bölümler: top (m) · iplik lotu (kg) · levent (m).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { factoryDayEndOfKey, factoryDayStartOfKey, factoryYmd } from "../constants/time";
import { ledgerHorizonStart } from "../constants/ledger-horizon";
import { readDevereEnabled, readIplikSurfaceEnabled } from "./system-setting.service";
import { NOT_INSIDE_STATUSES } from "./roll-owner.service";
import { assembleSection, type SectionMeta } from "./consigned-statement/assemble";
import { STATEMENT_MAX_LINES, tooLarge, type LedgerRead } from "./consigned-statement/ledger-read";
import { readRollLabels, readRollLedger } from "./consigned-statement/roll-ledger";
import { readWarpBeamLabels, readWarpBeamLedger, readYarnLotLabels, readYarnLotLedger } from "./consigned-statement/yarn-beam-ledger";
import type { ConsignedStatement, StatementSection, SubjectLabel } from "./consigned-statement/types";

export type * from "./consigned-statement/types";
export { STATEMENT_MAX_LINES };

/** Dönem tavanı (gün) — rapor uçlarının ortak sınırı (`temel/_day-range.ts`). */
export const STATEMENT_MAX_DAYS = 366;

export interface ConsignedStatementQuery {
  customerId: string;
  /** `YYYY-MM-DD` fabrika günü (dahil). */
  from: string;
  to: string;
  /** Bölüm izinleri — route anahtar-kapsamlı çözer (iplik: `warehouse:read`, levent: `warpbeam:read`). */
  access: { yarn: boolean; beam: boolean };
  /** Test kancası: mutabakat "bugün"ü. */
  now?: Date;
}

const DAY_MS = 86_400_000;

/** Gün anahtarı → sınır anı; takvimde olmayan gün (2026-02-30) de reddedilir (gün kayması sessiz olmasın). */
function dayBoundary(key: string, edge: "start" | "end"): Date {
  const at = edge === "start" ? factoryDayStartOfKey(key) : factoryDayEndOfKey(key);
  if (Number.isNaN(at.getTime()) || factoryYmd(at) !== key) {
    throw AppError.badRequest(`Geçersiz gün: ${key} (YYYY-MM-DD)`, { code: "CONSIGNED_STATEMENT_PARAM_INVALID" });
  }
  return at;
}

export function resolveStatementPeriod(from: string, to: string): { fromAt: Date; toAt: Date } {
  const fromAt = dayBoundary(from, "start");
  const toAt = dayBoundary(to, "end");
  if (toAt < fromAt) throw AppError.badRequest("Bitiş günü başlangıçtan önce olamaz", { code: "CONSIGNED_STATEMENT_PARAM_INVALID" });
  if (toAt.getTime() - fromAt.getTime() > STATEMENT_MAX_DAYS * DAY_MS) {
    throw AppError.badRequest(`Ekstre dönemi en fazla ${STATEMENT_MAX_DAYS} gün olabilir`, { code: "CONSIGNED_STATEMENT_PARAM_INVALID" });
  }
  return { fromAt, toAt };
}

const ROLL_META: SectionMeta = {
  kind: "ROLL", unit: "m", scope: "İçerideki emanet top (depo + üretim + fasonda)",
  columnLabels: { IN: "Giren", OUT: "Sevk (BRÜT)", DSK: "Fasondan doğrudan sevk", SCRAP: "Fire / düzeltme" },
};
const YARN_META: SectionMeta = {
  kind: "YARN_LOT", unit: "kg", scope: "Depodaki emanet iplik (lot bakiyesi)",
  columnLabels: { IN: "Giren", OUT: "Çözgüye / fasona çıkış", DSK: "—", SCRAP: "Sayım / düzeltme" },
};
const BEAM_META: SectionMeta = {
  kind: "WARP_BEAM", unit: "m", scope: "Fabrikadaki emanet levent (kalan metre)",
  columnLabels: { IN: "Sarılan", OUT: "Tüketim / fasona çıkış", DSK: "—", SCRAP: "Biten / hurda / düzeltme" },
};

/** Okuma + etiket tamamlama + montaj; açılışı olup dönemde olayı olmayan konunun etiketi ayrıca okunur. */
async function buildSection(
  meta: SectionMeta,
  read: LedgerRead,
  readLabels: (ids: readonly string[]) => Promise<Map<string, SubjectLabel>>,
): Promise<StatementSection> {
  const seen = new Set(read.events.map((e) => e.subjectId));
  const missing = read.opening.filter((o) => !o.qty.isZero() && !seen.has(o.subjectId)).map((o) => o.subjectId);
  return assembleSection(meta, { opening: read.opening, events: read.events, labels: await readLabels(missing) });
}

/** Top bölümü — bekçi as-of'u anlık sınırlarla ölçebilsin diye dışa açık. */
export async function buildRollSection(customerId: string, fromAt: Date, toAt: Date): Promise<StatementSection> {
  return buildSection(ROLL_META, await readRollLedger(customerId, fromAt, toAt, STATEMENT_MAX_LINES), readRollLabels);
}
export async function buildYarnLotSection(customerId: string, fromAt: Date, toAt: Date): Promise<StatementSection> {
  return buildSection(YARN_META, await readYarnLotLedger(customerId, fromAt, toAt, STATEMENT_MAX_LINES), readYarnLotLabels);
}
export async function buildWarpBeamSection(customerId: string, fromAt: Date, toAt: Date): Promise<StatementSection> {
  return buildSection(BEAM_META, await readWarpBeamLedger(customerId, fromAt, toAt, STATEMENT_MAX_LINES), readWarpBeamLabels);
}

export async function getConsignedStatement(q: ConsignedStatementQuery): Promise<ApiResponse<ConsignedStatement>> {
  const { fromAt, toAt } = resolveStatementPeriod(q.from, q.to);
  const customer = await prisma.customer.findUnique({ where: { id: q.customerId }, select: { id: true, name: true, code: true } });
  if (!customer) throw AppError.notFound("Müşteri bulunamadı", { code: "CUSTOMER_NOT_FOUND" });

  const omitted: ConsignedStatement["omitted"] = [];
  const rolls = await buildRollSection(customer.id, fromAt, toAt);

  // İplik bölümü iplik yüzeyinin kapısıyla (ticaret zinciri tek kaynakta); kapalı modülün verisi gövdeye girmez.
  let yarnLots: StatementSection | null = null;
  if (!(await readIplikSurfaceEnabled())) omitted.push({ kind: "YARN_LOT", reason: "MODULE_DISABLED" });
  else if (!q.access.yarn) omitted.push({ kind: "YARN_LOT", reason: "PERMISSION_DENIED" });
  else yarnLots = await buildYarnLotSection(customer.id, fromAt, toAt);

  // Devere bağımsızdır (`MODULE_DEPENDENCIES`: hazır/fason levent iplik tüketmez).
  let warpBeams: StatementSection | null = null;
  if (!(await readDevereEnabled())) omitted.push({ kind: "WARP_BEAM", reason: "MODULE_DISABLED" });
  else if (!q.access.beam) omitted.push({ kind: "WARP_BEAM", reason: "PERMISSION_DENIED" });
  else warpBeams = await buildWarpBeamSection(customer.id, fromAt, toAt);

  const lineCount = rolls.lines.length + (yarnLots?.lines.length ?? 0) + (warpBeams?.lines.length ?? 0);
  if (lineCount > STATEMENT_MAX_LINES) throw tooLarge(lineCount);

  const warnings: string[] = [];
  const now = q.now ?? new Date();
  let reconciliation: ConsignedStatement["reconciliation"] = null;
  if (toAt >= now) {
    // Canlı içerideki metre (İçerideki İşler kümesi) — fark, defterde görünmeyen bir metraj değişimini işaret eder.
    const live = await prisma.roll.aggregate({
      where: { ownerCustomerId: customer.id, status: { notIn: [...NOT_INSIDE_STATUSES] } },
      _sum: { currentQty: true },
    });
    const liveQty = new Prisma.Decimal(live._sum.currentQty ?? 0);
    const diff = new Prisma.Decimal(rolls.totals.closing).minus(liveQty);
    reconciliation = { rolls: { liveQty: Number(liveQty.toFixed(3)), diffQty: Number(diff.toFixed(3)) } };
    if (diff.abs().gt(0.01)) {
      warnings.push(`Ekstre kalanı canlı içerideki emanetten ${diff.toFixed(3)} m farklı — defterde görünmeyen bir metraj değişimi var.`);
    }
  }
  const preHorizon = await prisma.roll.count({ where: { ownerCustomerId: customer.id, createdAt: { lt: ledgerHorizonStart() } } });
  if (preHorizon > 0) warnings.push(`${preHorizon} emanet topu stok defteri ufkundan önce doğmuş — girişleri ekstrede görünmeyebilir.`);

  return {
    success: true,
    data: {
      customer,
      period: { from: q.from, to: q.to, fromAt: fromAt.toISOString(), toAt: toAt.toISOString() },
      rolls,
      yarnLots,
      warpBeams,
      omitted,
      reconciliation,
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
