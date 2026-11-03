// =============================================================================
// İSTASYON VARSAYILAN HEDEFLERİ — TEK KAYNAK çözücü (K22, kullanıcı 2026-11-03)
// =============================================================================
// Soru: "Rota adımında bu istasyon seçilince hangi özellik/değer ön seçili gelsin?" Panel İE formu, tablet İE
// formu ve belgeden İE (backend) AYNI cevabı buradan okur; istemci kendi kuralını yazmaz.
//   · FLAG: AUTO → hep seçili; OPTIONAL/REQUIRED → yalnız yetenekte "varsayılan açık" ise.
//   · CHOICE: REQUIRED → değer çözülürse; OPTIONAL → "varsayılan açık" + değer çözülürse; çeşit (variantOf) ana
//     bayrağı seçiliyse çeşit de değeriyle gelir (kurşun → gramaj; bugünkü davranış).
//   · Değer önceliği: müşteri varsayılanı (S3, yalnız ön muhasebe açıkken) > yetenek varsayılan değeri > değerin
//     `isDefault`ı > yok (o özellik listeye girmez). İşaret yoksa bugünkü davranış: ön seçim yok.
// Yalnız ÖN SEÇİMDİR — kayıtta istemcinin gönderdiği değer kazanır (hedef öneridir, kilit değil).
// =============================================================================
import type { FabricPropertyValueType, StationPropertyMode } from "@prisma/client";
import prisma from "../../lib/prisma";
import { readFinanceEnabled } from "../system-setting.service";
import { findKursunCustomerDefault } from "../kursun-customer-default.service";

export type DefaultTargetSource = "CUSTOMER" | "STATION" | "VALUE_DEFAULT";

export interface DefaultTarget {
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  valueType: FabricPropertyValueType;
  /** İstasyondaki mod; çeşit istasyonda tanımlı değilse ana bayrağın modu. */
  mode: StationPropertyMode;
  variantOfPropertyId: string | null;
  /** FLAG'de null. */
  valueId: string | null;
  valueCode: string | null;
  valueName: string | null;
  source: DefaultTargetSource | null;
}

export interface StationDefaultTargets {
  stationId: string;
  targets: DefaultTarget[];
}

interface ValueRow {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
}

interface PropertyRow {
  id: string;
  code: string;
  name: string;
  valueType: FabricPropertyValueType;
  variantOfPropertyId: string | null;
  values: ValueRow[];
}

export interface CapabilityRow {
  mode: StationPropertyMode;
  defaultOn: boolean;
  /** Aktif varsayılan değer (pasif değer çözücüye hiç gelmez). */
  defaultValue: { id: string; propertyId: string } | null;
  property: PropertyRow;
}

const PROPERTY_SELECT = {
  id: true,
  code: true,
  name: true,
  valueType: true,
  variantOfPropertyId: true,
  values: {
    where: { isActive: true },
    select: { id: true, code: true, name: true, isDefault: true },
    orderBy: [{ sortOrder: "asc" as const }, { code: "asc" as const }],
  },
};

/**
 * Saf çekirdek (bekçi doğrudan sınar). `rows` istasyonun AKTİF özellik satırları; `variantChildren` seçili bayrakların
 * istasyonda tanımlı olmayan aktif çeşitleri; `customer` müşteri varsayılanı (değer + ait olduğu özellik).
 */
export function computeDefaultTargets(
  rows: readonly CapabilityRow[],
  variantChildren: readonly PropertyRow[],
  customer: { valueId: string; propertyId: string } | null,
): DefaultTarget[] {
  const byProp = new Map(rows.map((r) => [r.property.id, r]));
  // Yetenek varsayılanı özellik başına: kendi satırının değeri, ana bayrağın satırındaki çeşit değerinden önce gelir.
  const stationDefault = new Map<string, string>();
  for (const own of [true, false]) {
    for (const r of rows) {
      const v = r.defaultValue;
      if (!v || (v.propertyId === r.property.id) !== own || stationDefault.has(v.propertyId)) continue;
      stationDefault.set(v.propertyId, v.id);
    }
  }

  const out: DefaultTarget[] = [];
  const flagOn = new Map<string, StationPropertyMode>();
  for (const r of rows) {
    if (r.property.valueType !== "FLAG") continue;
    if (r.mode !== "AUTO" && !r.defaultOn) continue;
    flagOn.set(r.property.id, r.mode);
    out.push(target(r.property, r.mode, null, null));
  }

  const choices: Array<{ property: PropertyRow; own: CapabilityRow | undefined }> = [
    ...rows.filter((r) => r.property.valueType === "CHOICE").map((r) => ({ property: r.property, own: r as CapabilityRow | undefined })),
    ...variantChildren.filter((p) => !byProp.has(p.id)).map((p) => ({ property: p, own: undefined })),
  ];
  for (const { property, own } of choices) {
    const parentMode = property.variantOfPropertyId ? flagOn.get(property.variantOfPropertyId) : undefined;
    const wanted = (own && (own.mode === "REQUIRED" || own.defaultOn)) || parentMode !== undefined;
    if (!wanted) continue;
    const pick = pickValue(property, customer, stationDefault.get(property.id));
    if (!pick) continue;
    out.push(target(property, own?.mode ?? parentMode!, pick.value, pick.source));
  }
  return out;
}

function pickValue(
  property: PropertyRow,
  customer: { valueId: string; propertyId: string } | null,
  stationValueId: string | undefined,
): { value: ValueRow; source: DefaultTargetSource } | null {
  const find = (id: string | undefined) => (id ? property.values.find((v) => v.id === id) : undefined);
  const own = customer && customer.propertyId === property.id ? find(customer.valueId) : undefined;
  if (own) return { value: own, source: "CUSTOMER" };
  const station = find(stationValueId);
  if (station) return { value: station, source: "STATION" };
  const flagged = property.values.find((v) => v.isDefault);
  return flagged ? { value: flagged, source: "VALUE_DEFAULT" } : null;
}

function target(p: PropertyRow, mode: StationPropertyMode, v: ValueRow | null, source: DefaultTargetSource | null): DefaultTarget {
  return {
    propertyId: p.id,
    propertyCode: p.code,
    propertyName: p.name,
    valueType: p.valueType,
    mode,
    variantOfPropertyId: p.variantOfPropertyId,
    valueId: v?.id ?? null,
    valueCode: v?.code ?? null,
    valueName: v?.name ?? null,
    source,
  };
}

/** İstasyon(lar) için ön seçim listesi; bilinmeyen/yeteneksiz istasyon boş liste döner (istek sırası korunur). */
export async function resolveStationDefaultTargets(
  stationIds: readonly string[],
  customerId?: string | null,
): Promise<StationDefaultTargets[]> {
  const ids = [...new Set(stationIds)];
  if (ids.length === 0) return [];
  const caps = await prisma.stationProperty.findMany({
    where: { stationId: { in: ids }, property: { isActive: true } },
    select: {
      stationId: true,
      mode: true,
      defaultOn: true,
      defaultValue: { select: { id: true, propertyId: true, isActive: true } },
      property: { select: PROPERTY_SELECT },
    },
  });
  const flagIds = [...new Set(caps.filter((c) => c.property.valueType === "FLAG").map((c) => c.property.id))];
  const children = flagIds.length
    ? await prisma.fabricProperty.findMany({ where: { variantOfPropertyId: { in: flagIds }, isActive: true }, select: PROPERTY_SELECT })
    : [];
  // S3 ile aynı kapı: ön muhasebe kapalıyken müşteri gramajı uç 403'tür → çözücü de yok sayar (istasyon varsayılanı).
  const customer = customerId && (await readFinanceEnabled()) ? await findKursunCustomerDefault(customerId) : null;

  return ids.map((stationId) => {
    const rows: CapabilityRow[] = caps
      .filter((c) => c.stationId === stationId)
      .map((c) => ({
        mode: c.mode,
        defaultOn: c.defaultOn,
        defaultValue: c.defaultValue?.isActive ? { id: c.defaultValue.id, propertyId: c.defaultValue.propertyId } : null,
        property: c.property,
      }));
    const flags = new Set(rows.map((r) => r.property.id));
    const own = children.filter((p) => p.variantOfPropertyId && flags.has(p.variantOfPropertyId));
    return { stationId, targets: computeDefaultTargets(rows, own, customer) };
  });
}

/**
 * Rotanın bütün adımlarının birleşik ön seçimi (belgeden İE): özellik başına İLK adımın cevabı.
 * KAT kolon-projeksiyonudur (`foldType`), hedef değer listesine girmez — çağıran ayrıştırır.
 */
export function mergeRouteDefaults(perStation: readonly StationDefaultTargets[]): DefaultTarget[] {
  const seen = new Map<string, DefaultTarget>();
  for (const s of perStation) for (const t of s.targets) if (!seen.has(t.propertyId)) seen.set(t.propertyId, t);
  return [...seen.values()];
}
