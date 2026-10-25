// =============================================================================
// RAPOR ÖN AYARLARI — kayıtlı parametre takımları, kullanıcı × rapor başına tek varsayılan (R1-KAYIT)
// =============================================================================
// "Kaya Tekstil — son 3 ay": parametre takımı tanıma bağlıdır; kişisel ya da paylaşımlı. Tek varsayılan
// kuralı DB'dedir (partial unique `report_presets_one_default_uq`, K-SEMA): eskisini düşürme + yenisini
// işaretleme tek tx; eşzamanlı ikinci işaret P2002 → 409. Özel raporda parametreler tanımın beyanıyla
// doğrulanır; sistem raporunda serbest anahtar/değer (sayı, metin, liste) — temel uç kendi şemasıyla okur.
// =============================================================================
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { checkReportDefinition } from "./reports/semantik/rapor-tanimi.schema";
import { resolveParams } from "./reports/semantik/definition-run";
import { loadVisible, type Actor } from "./rapor-tanimi.service";

const PRESET_SELECT = { id: true, name: true, params: true, isShared: true, isDefault: true, ownerId: true, owner: { select: { fullName: true } }, updatedAt: true } satisfies Prisma.ReportPresetSelect;
type PresetRow = Prisma.ReportPresetGetPayload<{ select: typeof PRESET_SELECT }>;

const systemParamValue = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.array(z.string().max(200)).max(200)]);
const systemParams = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/), systemParamValue).refine((o) => Object.keys(o).length <= 20, "En çok 20 parametre.");

const toDto = (p: PresetRow, userId: string) => ({
  id: p.id, ad: p.name, parametreler: p.params, paylasimli: p.isShared, varsayilan: p.isDefault,
  sahip: p.owner.fullName, benim: p.ownerId === userId, guncellendi: p.updatedAt.toISOString(),
});

export async function listPresets(definitionId: string, a: Actor) {
  await loadVisible(definitionId, a);
  const rows = await prisma.reportPreset.findMany({
    where: { definitionId, OR: [{ ownerId: a.userId }, { isShared: true }] },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: PRESET_SELECT,
  });
  return rows.map((r) => toDto(r, a.userId));
}

async function assertParams(definitionId: string, params: Record<string, unknown>): Promise<Prisma.InputJsonValue> {
  const def = await prisma.reportDefinition.findUniqueOrThrow({ where: { id: definitionId }, select: { kind: true, activeVersion: { select: { body: true } } } });
  if (def.kind === "SISTEM") {
    const v = systemParams.safeParse(params);
    if (!v.success) throw AppError.badRequest("Ön ayar parametreleri geçersiz.", { code: "RAPOR_PARAMETRE_GECERSIZ" });
    return v.data;
  }
  const check = checkReportDefinition(def.activeVersion?.body);
  if (!check.gecerli) throw AppError.badRequest("Rapor tanımı bozuk; ön ayar kaydedilemez.", { code: "RAPOR_TANIMI_BOZUK", hatalar: check.hatalar });
  resolveParams(check.govde, params); // bilinmeyen anahtar / tür hatası burada 400
  return params as Prisma.InputJsonValue;
}

function defaultConflict(): AppError {
  return AppError.conflict("Bu rapor için varsayılan ön ayar aynı anda değişti; listeyi yenileyip yeniden deneyin.", { code: "RAPOR_ON_AYAR_VARSAYILAN_CAKISMASI" });
}

export interface PresetInput {
  ad: string;
  parametreler: Record<string, unknown>;
  paylasimli: boolean;
  varsayilan: boolean;
}

/** Varsayılanı devralma: aynı tx'te kullanıcının öteki varsayılanı düşer; yarışı partial unique keser. */
async function writePreset(definitionId: string, a: Actor, data: { id?: string; name?: string; params?: Prisma.InputJsonValue; isShared?: boolean; isDefault?: boolean }) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.reportPreset.updateMany({ where: { definitionId, ownerId: a.userId, isDefault: true, ...(data.id ? { id: { not: data.id } } : {}) }, data: { isDefault: false } });
      }
      const { id, ...fields } = data;
      if (id) {
        const n = await tx.reportPreset.updateMany({ where: { id, definitionId, ownerId: a.userId }, data: fields });
        if (n.count === 0) throw AppError.notFound("Ön ayar bulunamadı.", { code: "RAPOR_ON_AYAR_YOK" });
        return tx.reportPreset.findUniqueOrThrow({ where: { id }, select: PRESET_SELECT });
      }
      return tx.reportPreset.create({
        data: { definitionId, ownerId: a.userId, name: fields.name!, params: fields.params!, isShared: fields.isShared ?? false, isDefault: fields.isDefault ?? false },
        select: PRESET_SELECT,
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw defaultConflict();
    throw e;
  }
}

export async function createPreset(definitionId: string, input: PresetInput, a: Actor) {
  await loadVisible(definitionId, a);
  const params = await assertParams(definitionId, input.parametreler);
  const row = await writePreset(definitionId, a, { name: input.ad.trim(), params, isShared: input.paylasimli, isDefault: input.varsayilan });
  await AuditService.log({ userId: a.userId, action: "CREATE", tableName: "REPORT_PRESET", recordId: row.id, newData: { tanimId: definitionId, ad: row.name, paylasimli: row.isShared, varsayilan: row.isDefault } });
  return toDto(row, a.userId);
}

/** Yalnız sahibi değiştirir; varsayılanı kaldırmak `varsayilan:false`tır. */
export async function updatePreset(definitionId: string, presetId: string, input: Partial<PresetInput>, a: Actor) {
  await loadVisible(definitionId, a);
  const before = await prisma.reportPreset.findFirst({ where: { id: presetId, definitionId, ownerId: a.userId }, select: PRESET_SELECT });
  if (!before) throw AppError.notFound("Ön ayar bulunamadı.", { code: "RAPOR_ON_AYAR_YOK" });
  const params = input.parametreler ? await assertParams(definitionId, input.parametreler) : undefined;
  const row = await writePreset(definitionId, a, {
    id: presetId,
    ...(input.ad !== undefined ? { name: input.ad.trim() } : {}),
    ...(params !== undefined ? { params } : {}),
    ...(input.paylasimli !== undefined ? { isShared: input.paylasimli } : {}),
    ...(input.varsayilan !== undefined ? { isDefault: input.varsayilan } : {}),
  });
  await AuditService.log({
    userId: a.userId, action: "UPDATE", tableName: "REPORT_PRESET", recordId: presetId,
    oldData: { ad: before.name, paylasimli: before.isShared, varsayilan: before.isDefault }, newData: { ad: row.name, paylasimli: row.isShared, varsayilan: row.isDefault },
  });
  return toDto(row, a.userId);
}
