// =============================================================================
// REFERANS ÇÖZÜMÜ — dosyadaki KOD/AD → kayıt id'si
// =============================================================================
// Kural sırası (tasarım §3b):
//   1) KOD birincildir (harf-duyarsız tam eşleşme).
//   2) Kod bulunamazsa AD ile denenir — ama yalnız TEKİL katlanmış eşleşmede ve
//      her zaman UYARI ile ("ad ile eşleşti"). Çoklu eşleşme HATA'dır: hangisini
//      seçtiğimizi kullanıcı göremez, sessizce yanlış kayda bağlamak en kötüsü.
//   3) Bulunan kayıt PASİF ise HATA (checklist: var-mı + isActive).
//
// Sorgular satır başına değil, İSTEK başına toplu koşar (tüm kodlar toplanır →
// tek `findMany`) — 5.000 satırlık bir dosyada N+1 sorgu, isteği dakikalara taşır.

import prisma from "../../lib/prisma";
import { foldNameForCompare } from "../helpers/name-normalize.helper";
import type { ImportContext, ImportFixHint, LookupHit } from "./import.types";
import { importKey } from "./import-key";

/** Desteklenen lookup varlıkları → Prisma delegate + alanlar. */
interface LookupSource {
  /** Prisma model anahtarı. */
  model: "item" | "color" | "station" | "machine" | "fabricProperty" | "customer" | "subcontractor" | "subcontractorCategory" | "qualityGrade" | "route" | "defectType" | "returnReason" | "branch" | "user";
  /** Kod kolonu (yoksa null → yalnız ad ile eşleşir). */
  codeField: string | null;
  nameField: string;
  /** Katlanmış gölge kolon (varsa ad eşleşmesi index'ten okur). */
  foldField: string | null;
  label: string;
}

export const LOOKUP_SOURCES: Record<string, LookupSource> = {
  item: { model: "item", codeField: "code", nameField: "name", foldField: "nameFold", label: "kumaş" },
  color: { model: "color", codeField: "code", nameField: "name", foldField: "nameFold", label: "renk" },
  station: { model: "station", codeField: "code", nameField: "name", foldField: "nameFold", label: "istasyon" },
  machine: { model: "machine", codeField: "code", nameField: "name", foldField: "nameFold", label: "makine" },
  fabricProperty: { model: "fabricProperty", codeField: "code", nameField: "name", foldField: "nameFold", label: "özellik" },
  customer: { model: "customer", codeField: "code", nameField: "name", foldField: "nameFold", label: "müşteri" },
  subcontractor: { model: "subcontractor", codeField: "code", nameField: "name", foldField: "nameFold", label: "fason firma" },
  subcontractorCategory: { model: "subcontractorCategory", codeField: "code", nameField: "name", foldField: "nameFold", label: "fason kategorisi" },
  qualityGrade: { model: "qualityGrade", codeField: "code", nameField: "name", foldField: "nameFold", label: "kalite" },
  route: { model: "route", codeField: "code", nameField: "name", foldField: "nameFold", label: "rota" },
  defectType: { model: "defectType", codeField: "code", nameField: "name", foldField: "nameFold", label: "hata tipi" },
  returnReason: { model: "returnReason", codeField: "code", nameField: "name", foldField: "nameFold", label: "iade sebebi" },
};

/**
 * Çözümleme hatası — düz string DEĞİL, çünkü "bulunamadı" ile "belirsiz" ve
 * "pasif" arasındaki fark panelde EYLEM farkı yaratıyor (bkz. ImportFixHint).
 * Tipi değiştirmek bilinçli: `error: string` kalsaydı 18 çağrı noktasının 17'si
 * sessizce eski yolda kalırdı; böyle derleyici hepsini işaretliyor.
 */
export interface ResolveIssue {
  message: string;
  fix?: ImportFixHint;
}

export interface ResolveOutcome {
  hit?: LookupHit;
  error?: ResolveIssue;
  warning?: string;
}

/**
 * Tek bir referansı çözer. `ctx.cache` istek boyunca paylaşılır — aynı kod
 * yüzlerce satırda geçse de bir kez sorgulanır.
 */
export async function resolveReference(
  entity: string,
  rawValue: string,
  ctx: ImportContext,
  by: "code" | "name" = "code",
): Promise<ResolveOutcome> {
  const src = LOOKUP_SOURCES[entity];
  if (!src) return { error: { message: `Bilinmeyen referans türü: ${entity}` } };
  const value = rawValue.trim();
  if (!value) return {};

  const cacheKey = `${entity}:${by}`;
  let bucket = ctx.cache.get(cacheKey);
  if (!bucket) {
    bucket = new Map<string, LookupHit>();
    ctx.cache.set(cacheKey, bucket);
  }
  const cached = bucket.get(importKey(value));
  if (cached) return activeOrError(cached, src.label, value);

  // 1) KOD ile tam eşleşme (harf-duyarsız).
  if (by === "code" && src.codeField) {
    const byCode = (await delegate(src.model).findFirst({
      where: { [src.codeField]: { equals: value, mode: "insensitive" } },
      select: selectOf(src),
    })) as Record<string, unknown> | null;
    if (byCode) {
      const hit = toHit(byCode, src);
      bucket.set(importKey(value), hit);
      return activeOrError(hit, src.label, value);
    }
  }

  // 2) AD ile — yalnız TEKİL eşleşme, her zaman uyarılı.
  const folded = foldNameForCompare(value);
  const nameWhere = src.foldField
    ? { [src.foldField]: folded }
    : { [src.nameField]: { equals: value, mode: "insensitive" as const } };
  const byName = (await delegate(src.model).findMany({
    where: nameWhere,
    select: selectOf(src),
    take: 2,
  })) as Record<string, unknown>[];

  if (byName.length === 0) {
    // TEK ipucu üreten dal burasıdır.
    return {
      error: {
        message: `'${value}' ile eşleşen ${src.label} bulunamadı (kod ya da tam ad yazın).`,
        fix: { kind: "CREATE_LOOKUP", entity, value },
      },
    };
  }
  if (byName.length > 1) {
    // İPUCU YOK: yaratmak, zaten iki olan kataloğa üçüncüyü eklerdi.
    return {
      error: {
        message: `'${value}' adı birden fazla ${src.label} ile eşleşiyor — ayırt etmek için KOD yazın.`,
      },
    };
  }
  const hit = toHit(byName[0] as Record<string, unknown>, src);
  bucket.set(importKey(value), hit);
  const outcome = activeOrError(hit, src.label, value);
  if (outcome.error) return outcome;
  return {
    ...outcome,
    warning:
      by === "code"
        ? `'${value}' kod olarak bulunamadı, AD ile eşleşti (${hit.code ?? "kodsuz"}). Kod yazmak daha güvenlidir.`
        : undefined,
  };
}

function activeOrError(hit: LookupHit, label: string, value: string): ResolveOutcome {
  if (!hit.isActive) {
    // İPUCU YOK: doğru eylem YARATMAK değil AKTİFLEŞTİRMEK. Yaratma teklifi,
    // `assertNameAvailable`'ın tam da engellediği mükerreri üretirdi.
    return {
      error: {
        message: `'${value}' ${label} kaydı PASİF — önce aktifleştirin ya da başka bir kayıt seçin.`,
      },
    };
  }
  return { hit };
}

function toHit(row: Record<string, unknown>, src: LookupSource): LookupHit {
  return {
    id: row.id as string,
    code: src.codeField ? ((row[src.codeField] as string | null) ?? null) : null,
    name: (row[src.nameField] as string | null) ?? null,
    isActive: row.isActive !== false,
  };
}

function selectOf(src: LookupSource): Record<string, boolean> {
  const sel: Record<string, boolean> = { id: true, isActive: true, [src.nameField]: true };
  if (src.codeField) sel[src.codeField] = true;
  return sel;
}

type AnyDelegate = {
  findFirst: (args: Record<string, unknown>) => Promise<unknown>;
  findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
};

function delegate(model: LookupSource["model"]): AnyDelegate {
  return (prisma as unknown as Record<string, AnyDelegate>)[model] as AnyDelegate;
}

/** Çoklu referans (kod listesi) — hepsi çözülmeli, biri bile düşerse satır hata alır. */
export async function resolveReferenceList(
  entity: string,
  values: string[],
  ctx: ImportContext,
): Promise<{ ids: string[]; errors: ResolveIssue[]; warnings: string[] }> {
  const ids: string[] = [];
  const errors: ResolveIssue[] = [];
  const warnings: string[] = [];
  for (const v of values) {
    const out = await resolveReference(entity, v, ctx);
    if (out.error) errors.push(out.error);
    if (out.warning) warnings.push(out.warning);
    if (out.hit) ids.push(out.hit.id);
  }
  return { ids: [...new Set(ids)], errors, warnings };
}
