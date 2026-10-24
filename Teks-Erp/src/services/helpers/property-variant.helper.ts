// =============================================================================
// ÇEŞİT BAĞI DOĞRULAMASI — tek yer (KQ-D4, 2026-10-24)
// =============================================================================
// `FabricProperty.variantOfPropertyId`: "bu SEÇİM özelliği şu BAYRAĞIN
// çeşididir" (Kurşun gramajı → Kurşunlu). Bağın iki yazarı var — özellik formu
// (fabric-property.service, `stationIds` ile istasyon bağı da kurar) ve İstasyon
// Yetenekleri (station-capability.service). İkisi de buradan geçer; aksi halde
// biri "ana bayraksız istasyonda çeşit" ara durumunu doğurabilirdi.
// =============================================================================
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

/**
 * Bağın KENDİSİ geçerli mi? (`variantOfPropertyId` null değilken çağrılır)
 *   • kendine bağ yok · özellik SEÇİM olmalı · hedef BAYRAK olmalı
 *   • hedef kendisi çeşit olamaz · hedefin başka bir çeşidi olamaz (partial unique)
 */
export async function assertVariantLinkValid(args: {
  /** Güncellenen özelliğin id'si; create'te null. */
  propertyId: string | null;
  valueType: string;
  variantOfPropertyId: string;
}): Promise<{ parentName: string }> {
  if (args.propertyId !== null && args.variantOfPropertyId === args.propertyId) {
    throw AppError.badRequest("Bir özellik kendisinin çeşidi olamaz.", { code: "PROPERTY_VARIANT_SELF" });
  }
  if (args.valueType !== "CHOICE") {
    throw AppError.badRequest(
      "Yalnız Seçim tipli (değer listeli) özellik bir bayrağın çeşidi olabilir — örn. 'Kurşun gramajı' → 'Kurşunlu'.",
      { code: "PROPERTY_VARIANT_NOT_CHOICE" },
    );
  }
  const parent = await prisma.fabricProperty.findUnique({
    where: { id: args.variantOfPropertyId },
    select: {
      name: true,
      valueType: true,
      variantOfPropertyId: true,
      variant: { select: { id: true, name: true } },
    },
  });
  if (!parent) throw AppError.badRequest("Çeşidi olunacak özellik bulunamadı.", { code: "PROPERTY_VARIANT_PARENT_MISSING" });
  if (parent.valueType !== "FLAG") {
    throw AppError.badRequest(`'${parent.name}' Bayrak tipli değil — çeşit yalnız bir bayrağa bağlanır.`, {
      code: "PROPERTY_VARIANT_PARENT_NOT_FLAG",
    });
  }
  if (parent.variantOfPropertyId !== null) {
    throw AppError.badRequest(`'${parent.name}' zaten bir çeşit — çeşidin çeşidi olamaz.`, {
      code: "PROPERTY_VARIANT_CHAIN",
    });
  }
  if (parent.variant && parent.variant.id !== args.propertyId) {
    throw AppError.badRequest(
      `'${parent.name}' özelliğinin zaten bir çeşidi var: '${parent.variant.name}'. Bir bayrağın tek çeşidi olur.`,
      { code: "PROPERTY_VARIANT_TAKEN" },
    );
  }
  return { parentName: parent.name };
}

/**
 * İstasyon kümesi kontrolü: çeşit bir istasyona bağlıysa ANA BAYRAK da o
 * istasyonda bağlı olmalı (aksi halde gramaj basılır ama "kurşun yapıldı"
 * türeyemez). `bindings` = yazımdan SONRAKİ hâl (istasyon → özellik id'leri).
 */
export async function assertVariantParentsBound(
  bindings: { stationId: string; propertyIds: string[] }[],
): Promise<void> {
  const allIds = [...new Set(bindings.flatMap((b) => b.propertyIds))];
  if (allIds.length === 0) return;
  const variants = await prisma.fabricProperty.findMany({
    where: { id: { in: allIds }, variantOfPropertyId: { not: null } },
    select: { id: true, name: true, variantOf: { select: { id: true, name: true } } },
  });
  if (variants.length === 0) return;
  const stationIds = bindings.map((b) => b.stationId);
  const stations = await prisma.station.findMany({ where: { id: { in: stationIds } }, select: { id: true, name: true } });
  for (const b of bindings) {
    for (const v of variants) {
      if (!v.variantOf || !b.propertyIds.includes(v.id) || b.propertyIds.includes(v.variantOf.id)) continue;
      const st = stations.find((s) => s.id === b.stationId)?.name ?? "bu istasyon";
      throw AppError.badRequest(
        `Önce ${v.variantOf.name} özelliğini '${st}' istasyonuna ekleyin — '${v.name}' onun çeşidi.`,
        { code: "PROPERTY_VARIANT_PARENT_NOT_BOUND", stationId: b.stationId, propertyId: v.id },
      );
    }
  }
}

/** Bir özelliğin bugünkü istasyon bağları. */
export async function boundStationIds(propertyId: string): Promise<string[]> {
  const rows = await prisma.stationProperty.findMany({ where: { propertyId }, select: { stationId: true } });
  return rows.map((r) => r.stationId);
}

async function stationNames(ids: string[]): Promise<string[]> {
  const rows = await prisma.station.findMany({ where: { id: { in: ids } }, select: { name: true } });
  return rows.map((r) => r.name);
}

/** Çeşidin bağlanacağı her istasyonda ANA BAYRAK bağlı mı? (özellik formu yolu) */
export async function assertParentCoversStations(args: {
  parentId: string;
  parentName: string;
  variantName: string;
  stationIds: string[];
}): Promise<void> {
  const parentStations = new Set(await boundStationIds(args.parentId));
  const missing = args.stationIds.filter((s) => !parentStations.has(s));
  if (missing.length === 0) return;
  const names = await stationNames(missing);
  throw AppError.badRequest(
    `Önce ${args.parentName} özelliğini şu istasyon(lar)a ekleyin: ${names.join(", ")} — '${args.variantName}' onun çeşidi.`,
    { code: "PROPERTY_VARIANT_PARENT_NOT_BOUND" },
  );
}

/** Bayrağın istasyonu, çeşidi orada bağlıyken kaldırılamaz (ters yön). */
export async function assertFlagKeepsVariantStations(args: {
  flagName: string;
  variant: { id: string; name: string } | null;
  nextStationIds: string[];
}): Promise<void> {
  if (!args.variant) return;
  const next = new Set(args.nextStationIds);
  const orphaned = (await boundStationIds(args.variant.id)).filter((s) => !next.has(s));
  if (orphaned.length === 0) return;
  const names = await stationNames(orphaned);
  throw AppError.badRequest(
    `'${args.variant.name}' (${args.flagName} çeşidi) şu istasyon(lar)da bağlı: ${names.join(", ")} — ` +
      `önce çeşidi oradan çıkarın.`,
    { code: "PROPERTY_VARIANT_PARENT_NOT_BOUND" },
  );
}

/**
 * Gövdedeki çeşit bağı (KQ-D4). `undefined` = alan gönderilmedi (eski panel:
 * update DOKUNMAZ); `null` = bağı kaldır; string = bağla. Başka tip 400.
 */
export function readVariantOf(data: Record<string, unknown>): string | null | undefined {
  if (!("variantOfPropertyId" in data)) return undefined;
  const raw = data.variantOfPropertyId;
  if (raw === null || raw === "") {
    data.variantOfPropertyId = null;
    return null;
  }
  if (typeof raw !== "string") throw AppError.badRequest("variantOfPropertyId bir özellik id'si olmalı");
  return raw;
}

/** Create yolu: bağ verildiyse geçerli mi + seçilen her istasyonda ana bayrak var mı. */
export async function assertVariantCreate(
  data: Record<string, unknown>,
  valueType: string,
  stationIds: string[],
): Promise<void> {
  const variantOf = readVariantOf(data);
  if (!variantOf) return;
  const { parentName } = await assertVariantLinkValid({ propertyId: null, valueType, variantOfPropertyId: variantOf });
  await assertParentCoversStations({
    parentId: variantOf,
    parentName,
    variantName: typeof data.name === "string" ? data.name : "bu özellik",
    stationIds,
  });
}

/**
 * Çeşit bağı güncellemesi (KQ-D4) — etkin hâl (gövde ∪ mevcut) doğrulanır:
 * bağ geçerliliği, çeşidin istasyonlarında ana bayrak, bayrağın istasyonu
 * çeşitten önce kaldırılamaz, çeşidi olan bayrak Seçim'e çevrilemez.
 */
export async function assertVariantUpdate(
  id: string,
  current: {
    name: string;
    variantOfPropertyId: string | null;
    variant: { id: string; name: string } | null;
  },
  next: { valueType: string; variantOf: string | null | undefined; stationIds: string[] | undefined; typeChanging: boolean },
): Promise<void> {
  if (next.typeChanging && current.variant) {
    throw AppError.badRequest(
      `'${current.name}' özelliğinin bir çeşidi var ('${current.variant.name}') — tipi değiştirilemez. ` +
        "Önce çeşidin bağını kaldırın.",
      { code: "PROPERTY_VARIANT_PARENT_TYPE_LOCK" },
    );
  }
  const effectiveVariantOf = next.variantOf === undefined ? current.variantOfPropertyId : next.variantOf;
  const touched = next.variantOf !== undefined || next.typeChanging || next.stationIds !== undefined;
  if (effectiveVariantOf && touched) {
    const { parentName } = await assertVariantLinkValid({
      propertyId: id,
      valueType: next.valueType,
      variantOfPropertyId: effectiveVariantOf,
    });
    await assertParentCoversStations({
      parentId: effectiveVariantOf,
      parentName,
      variantName: current.name,
      stationIds: next.stationIds ?? (await boundStationIds(id)),
    });
  }
  if (next.stationIds !== undefined) {
    await assertFlagKeepsVariantStations({
      flagName: current.name,
      variant: current.variant,
      nextStationIds: next.stationIds,
    });
  }
}
