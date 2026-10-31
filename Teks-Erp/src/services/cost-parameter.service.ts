// =============================================================================
// TESİS MALİYET PARAMETRELERİ (CostParameterSet) — MAL-1
// =============================================================================
// DURUM + DONMUŞ SÜRÜM: yürürlükteki (ACTIVE) set DEĞİŞMEZ — standart maliyet sürümleri
// ona işaret eder (MAL-2). Düzenleme = yürürlüktekinin TASLAK kopyası → "yürürlüğe al".
// Yürürlüğe alma TEK tx'te iki atomik claim'dir (ACTIVE → SUPERSEDED, DRAFT → ACTIVE);
// yarışın son hattı `cost_parameter_sets_live_uq` (tek DRAFT + tek ACTIVE) → P2002 → 409.
// Hard delete yalnız hiç yürürlüğe girmemiş taslakta (defter.md ④ sınıfı).
// =============================================================================
import { CostParamStatus, Prisma, type Currency } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import {
  EFFICIENCY_RULE,
  MARKUP_RULE,
  PCT_RULE,
  isUniqueViolation,
  parseDecimalField,
  parsePickRatePair,
  parseTextField,
  type DecimalRule,
} from "./helpers/cost-input.helper";

export const COST_PARAMETER_SET_SELECT = {
  id: true,
  versionNo: true,
  status: true,
  activatedAt: true,
  activatedById: true,
  supersededAt: true,
  note: true,
  loomHourRateTry: true,
  laborHourRateTry: true,
  loomsPerOperator: true,
  energyKwhPerLoomHour: true,
  energyPriceTryPerKwh: true,
  overheadPct: true,
  defaultTakeUpPct: true,
  defaultWarpWastePct: true,
  defaultWeftWastePct: true,
  defaultFabricWastePct: true,
  defaultLoomRpm: true,
  defaultEfficiencyPct: true,
  beamPrepCostTry: true,
  defaultBeamLengthM: true,
  weftSelvedgeAllowanceCm: true,
  defaultMarkupPct: true,
  monthlyFinanceRatePct: true,
  defaultLoomPickRate: true,
  defaultLoomPickCurrency: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  updatedById: true,
} satisfies Prisma.CostParameterSetSelect;

export type CostParameterSetRow = Prisma.CostParameterSetGetPayload<{ select: typeof COST_PARAMETER_SET_SELECT }>;

/** Düzenlenebilir sayısal alanlar — kural + zorunluluk (NULL'a izin veren üç alan hariç hepsi zorunlu). */
const NUMERIC_FIELDS = {
  loomHourRateTry: { rule: { label: "Tezgah saat maliyeti", min: 0, scale: 4 }, required: true },
  laborHourRateTry: { rule: { label: "Operatör saat ücreti", min: 0, scale: 4 }, required: true },
  loomsPerOperator: { rule: { label: "Operatör başına tezgah", min: 0, minExclusive: true, scale: 2 }, required: true },
  energyKwhPerLoomHour: { rule: { label: "Tezgah saatlik enerji (kWh)", min: 0, scale: 3 }, required: true },
  energyPriceTryPerKwh: { rule: { label: "Enerji birim fiyatı", min: 0, scale: 4 }, required: true },
  overheadPct: { rule: PCT_RULE("Genel gider yüzdesi"), required: true },
  defaultTakeUpPct: { rule: PCT_RULE("Varsayılan çözgü çekmesi"), required: false },
  defaultWarpWastePct: { rule: PCT_RULE("Varsayılan çözgü firesi"), required: true },
  defaultWeftWastePct: { rule: PCT_RULE("Varsayılan atkı firesi"), required: true },
  defaultFabricWastePct: { rule: PCT_RULE("Varsayılan kalite firesi"), required: true },
  defaultLoomRpm: { rule: { label: "Varsayılan tezgah devri", min: 0, minExclusive: true, scale: 0, integer: true }, required: false },
  defaultEfficiencyPct: { rule: EFFICIENCY_RULE("Varsayılan randıman"), required: true },
  beamPrepCostTry: { rule: { label: "Levent hazırlık maliyeti", min: 0, scale: 2 }, required: true },
  defaultBeamLengthM: { rule: { label: "Varsayılan levent boyu", min: 0, minExclusive: true, scale: 2 }, required: true },
  weftSelvedgeAllowanceCm: { rule: { label: "Atkı kenar payı (cm)", min: 0, scale: 2 }, required: true },
  defaultMarkupPct: { rule: MARKUP_RULE("Varsayılan kâr oranı"), required: true },
  monthlyFinanceRatePct: { rule: PCT_RULE("Aylık vade farkı oranı"), required: false },
} as const satisfies Record<string, { rule: DecimalRule; required: boolean }>;

type NumericField = keyof typeof NUMERIC_FIELDS;
const NUMERIC_KEYS = Object.keys(NUMERIC_FIELDS) as NumericField[];

/** Gövdeden yalnız bilinen alanlar okunur (sessiz allowlist DEĞİL: bilinmeyen alan 400). */
type ParsedInput = Partial<Record<NumericField, Prisma.Decimal | number | null>> & {
  note?: string | null; defaultLoomPickRate?: Prisma.Decimal | null; defaultLoomPickCurrency?: Currency | null;
};
/** SY-D2: atkı ücreti çifti NUMERIC_FIELDS dışında (döviz kolonu + çift kuralı); taslak kopyası ikisini birlikte taşır. */
const PICK_KEYS = ["defaultLoomPickRate", "defaultLoomPickCurrency"] as const;

function parseInput(body: Record<string, unknown>): ParsedInput {
  const unknown = Object.keys(body).filter((k) => k !== "note" && !(k in NUMERIC_FIELDS) && !(PICK_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan alan: ${unknown.join(", ")}`);
  const out: ParsedInput = {};
  for (const k of NUMERIC_KEYS) {
    const v = parseDecimalField(body[k], NUMERIC_FIELDS[k].rule);
    if (v === undefined) continue;
    if (v === null && NUMERIC_FIELDS[k].required) throw AppError.badRequest(`${NUMERIC_FIELDS[k].rule.label} boş bırakılamaz.`);
    out[k] = k === "defaultLoomRpm" && v !== null ? v.toNumber() : v;
  }
  const pick = parsePickRatePair(body.defaultLoomPickRate, body.defaultLoomPickCurrency);
  if (pick) {
    out.defaultLoomPickRate = pick.rate;
    out.defaultLoomPickCurrency = pick.currency;
  }
  const note = parseTextField(body.note, "Not", 300);
  if (note !== undefined) out.note = note;
  return out;
}

function conflictFromUnique(): AppError {
  return AppError.conflict("Parametre seti aynı anda başka bir işlemle değişti (tek taslak / tek yürürlükteki) — listeyi yenileyip tekrar deneyin.", {
    code: "COST_PARAMETER_SET_CONFLICT",
  });
}

export async function listParameterSets(): Promise<CostParameterSetRow[]> {
  return prisma.costParameterSet.findMany({ select: COST_PARAMETER_SET_SELECT, orderBy: [{ versionNo: "desc" }] });
}

export async function getParameterSetByStatus(status: "ACTIVE" | "DRAFT"): Promise<CostParameterSetRow | null> {
  return prisma.costParameterSet.findFirst({ where: { status }, select: COST_PARAMETER_SET_SELECT });
}

/**
 * TASLAK AÇ — yürürlükteki setin kopyası + gövdedeki değişiklikler. Yürürlükte set yoksa
 * (ilk kurulum) zorunlu alanların HEPSİ gövdeden gelir (eksikler tek 400'de listelenir).
 */
export async function createDraft(body: Record<string, unknown>, userId?: string): Promise<CostParameterSetRow> {
  const input = parseInput(body);
  const active = await getParameterSetByStatus("ACTIVE");
  const base: Record<string, unknown> = {};
  if (active) for (const k of [...NUMERIC_KEYS, ...PICK_KEYS]) base[k] = active[k];
  const merged: Record<string, unknown> = { ...base, ...input };
  const missing = NUMERIC_KEYS.filter((k) => NUMERIC_FIELDS[k].required && (merged[k] === undefined || merged[k] === null));
  if (missing.length > 0) {
    throw AppError.badRequest(
      `Yürürlükte parametre seti yok; ilk taslakta şu alanlar zorunlu: ${missing.map((k) => NUMERIC_FIELDS[k].rule.label).join(", ")}`,
      { code: "COST_PARAMETER_REQUIRED", missing },
    );
  }
  let row: CostParameterSetRow;
  try {
    const last = await prisma.costParameterSet.aggregate({ _max: { versionNo: true } });
    row = await prisma.costParameterSet.create({
      data: {
        ...(merged as Omit<Prisma.CostParameterSetUncheckedCreateInput, "versionNo">),
        versionNo: (last._max.versionNo ?? 0) + 1,
        status: CostParamStatus.DRAFT,
        createdById: userId ?? null,
        updatedById: userId ?? null,
      },
      select: COST_PARAMETER_SET_SELECT,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw AppError.conflict("Zaten açık bir taslak parametre seti var — onu düzenleyin ya da silin.", { code: "COST_PARAMETER_DRAFT_EXISTS" });
    }
    throw e;
  }
  void AuditService.log({
    userId,
    action: "CREATE",
    tableName: "COST_PARAMETER_SET",
    recordId: row.id,
    newData: { versionNo: row.versionNo, status: row.status, copiedFromVersionNo: active?.versionNo ?? null },
  });
  return row;
}

/** TASLAK GÜNCELLE — yalnız DRAFT (claim `WHERE {id, status: DRAFT}`); yürürlükteki 409. */
export async function updateDraft(id: string, body: Record<string, unknown>, userId?: string): Promise<CostParameterSetRow> {
  const input = parseInput(body);
  if (Object.keys(input).length === 0) throw AppError.badRequest("Güncellenecek alan yok.");
  const before = await prisma.costParameterSet.findUnique({ where: { id }, select: COST_PARAMETER_SET_SELECT });
  if (!before) throw AppError.notFound("Parametre seti bulunamadı.");
  const claim = await prisma.costParameterSet.updateMany({
    where: { id, status: CostParamStatus.DRAFT },
    data: { ...(input as Prisma.CostParameterSetUncheckedUpdateManyInput), updatedById: userId ?? null },
  });
  if (claim.count === 0) {
    throw AppError.conflict("Yalnız taslak parametre seti düzenlenebilir — yürürlükteki set değişmez; yeni taslak açın.", {
      code: "COST_PARAMETER_NOT_DRAFT",
    });
  }
  const after = await prisma.costParameterSet.findUniqueOrThrow({ where: { id }, select: COST_PARAMETER_SET_SELECT });
  const changed = Object.keys(input) as Array<keyof typeof input>;
  void AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "COST_PARAMETER_SET",
    recordId: id,
    oldData: Object.fromEntries(changed.map((k) => [k, before[k] === null ? null : String(before[k])])),
    newData: Object.fromEntries(changed.map((k) => [k, after[k] === null ? null : String(after[k])])),
  });
  return after;
}

/**
 * YÜRÜRLÜĞE AL — tek tx: eski ACTIVE → SUPERSEDED, bu DRAFT → ACTIVE (ikisi de atomik claim).
 * Eşzamanlı ikinci istek taslağı DRAFT bulamaz → 409; arada kaçan yarış live_uq'ya çarpar → 409.
 */
export async function activateDraft(id: string, userId?: string): Promise<CostParameterSetRow> {
  const at = new Date();
  let previous: { id: string; versionNo: number } | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      previous = await tx.costParameterSet.findFirst({ where: { status: CostParamStatus.ACTIVE }, select: { id: true, versionNo: true } });
      await tx.costParameterSet.updateMany({
        where: { status: CostParamStatus.ACTIVE },
        data: { status: CostParamStatus.SUPERSEDED, supersededAt: at, updatedById: userId ?? null },
      });
      const claim = await tx.costParameterSet.updateMany({
        where: { id, status: CostParamStatus.DRAFT },
        data: { status: CostParamStatus.ACTIVE, activatedAt: at, activatedById: userId ?? null, updatedById: userId ?? null },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Bu parametre seti taslak değil (zaten yürürlüğe alınmış ya da silinmiş) — listeyi yenileyin.", {
          code: "COST_PARAMETER_NOT_DRAFT",
        });
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflictFromUnique();
    throw e;
  }
  const row = await prisma.costParameterSet.findUniqueOrThrow({ where: { id }, select: COST_PARAMETER_SET_SELECT });
  const prev = previous as { id: string; versionNo: number } | null;
  if (prev) {
    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "COST_PARAMETER_SET",
      recordId: prev.id,
      oldData: { status: CostParamStatus.ACTIVE },
      newData: { status: CostParamStatus.SUPERSEDED, supersededByVersionNo: row.versionNo },
    });
  }
  void AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "COST_PARAMETER_SET",
    recordId: id,
    oldData: { status: CostParamStatus.DRAFT },
    newData: { status: CostParamStatus.ACTIVE, versionNo: row.versionNo },
  });
  return row;
}

/** TASLAĞI SİL — hiç yürürlüğe girmemiş taslak (④); yürürlükteki/eskimiş set silinmez (409). */
export async function deleteDraft(id: string, userId?: string): Promise<{ id: string }> {
  const row = await prisma.costParameterSet.findUnique({ where: { id }, select: { id: true, versionNo: true, status: true } });
  if (!row) throw AppError.notFound("Parametre seti bulunamadı.");
  const del = await prisma.costParameterSet.deleteMany({ where: { id, status: CostParamStatus.DRAFT } });
  if (del.count === 0) {
    throw AppError.conflict("Yalnız hiç yürürlüğe girmemiş taslak silinebilir — yürürlükteki ve eski setler tarihçedir.", {
      code: "COST_PARAMETER_NOT_DRAFT",
    });
  }
  void AuditService.log({
    userId,
    action: "DELETE",
    tableName: "COST_PARAMETER_SET",
    recordId: id,
    oldData: { versionNo: row.versionNo, status: row.status },
  });
  return { id };
}
