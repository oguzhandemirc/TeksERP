// =============================================================================
// SEMANTİK KATMAN — ORTAK BOYUT KURUCULARI (R1-SEMKUP; plan §3.1 "Zaman")
// =============================================================================
// Gün/hafta/ay/saat yalnız `constants/time.ts`ten, vardiya yalnız `vardiya-takvimi.helper.ts`ten,
// hata grubu yalnız `constants/hata-gruplari.ts`ten gelir — küp dosyası bu ifadeleri kendisi yazmaz.
// SQL parçaları yalnız koddaki sabit kolon/tablo adlarından kurulur; kullanıcı girdisi buraya girmez.
// =============================================================================
import { Prisma } from "@prisma/client";
import { factoryDaySql, factoryHourSql, factoryMonthSql, factoryWeekSql } from "../../../constants/time";
import { DEFECT_GROUPS, DEFECT_GROUP_LABELS, UNGROUPED_LABEL } from "../../../constants/hata-gruplari";
import { SHIFT_CALENDAR_LIMIT_NOTE, shiftOfSql, type ShiftRule } from "../../helpers/vardiya-takvimi.helper";
import type { SemanticDimension } from "./tipler";

export const DEFAULT_CAP = 50;
export const SHIFT_NOTE = SHIFT_CALENDAR_LIMIT_NOTE;

/** Gün · hafta · ay — zaman boyutları kesilmez (tavan 0). */
export function timeDimensions(column: string): SemanticDimension[] {
  return [
    { id: "gun", name: "Gün", kind: "time", keySql: factoryDaySql(column), valueType: "date", cardinalityCap: 0 },
    { id: "hafta", name: "Hafta", kind: "time", keySql: factoryWeekSql(column), valueType: "date", cardinalityCap: 0 },
    { id: "ay", name: "Ay", kind: "time", keySql: factoryMonthSql(column), valueType: "date", cardinalityCap: 0 },
  ];
}

const HOURS = Array.from({ length: 24 }, (_, h) => String(h));

/** Fabrika saatinde 0–23 — "hangi saatte" sorusu (korelasyon için kategori; süzülebilir). */
export function hourDimension(column: string): SemanticDimension {
  return {
    id: "saat", name: "Saat", kind: "category", valueType: "enum", enumValues: HOURS, cardinalityCap: 24, ordered: true,
    keySql: factoryHourSql(column),
  };
}

interface EntitySpec {
  id: string;
  name: string;
  /** Küp takmasındaki kimlik kolonu, ör. `p."itemId"`. */
  keyColumn: string;
  table: string;
  alias: string;
  labelColumn?: string;
  personName?: true;
}

/** Ana veri kimliği boyutu: anahtar uuid, etiket ana veri tablosundan LEFT JOIN ile. */
export function entityDimension(spec: EntitySpec): SemanticDimension {
  return {
    id: spec.id, name: spec.name, kind: "category", valueType: "uuid", cardinalityCap: DEFAULT_CAP,
    keySql: Prisma.raw(spec.keyColumn),
    labelSql: Prisma.raw(`${spec.alias}.${spec.labelColumn ?? "name"}`),
    joins: Prisma.raw(`LEFT JOIN ${spec.table} ${spec.alias} ON ${spec.alias}.id = ${spec.keyColumn}`),
    ...(spec.personName ? { personName: true as const } : {}),
  };
}

export const itemDimension = (keyColumn: string): SemanticDimension =>
  entityDimension({ id: "kumas", name: "Kumaş", keyColumn, table: "items", alias: "dm_it" });
export const colorDimension = (keyColumn: string): SemanticDimension =>
  entityDimension({ id: "renk", name: "Renk", keyColumn, table: "colors", alias: "dm_co" });
export const customerDimension = (keyColumn: string): SemanticDimension =>
  entityDimension({ id: "musteri", name: "Müşteri", keyColumn, table: "customers", alias: "dm_cu" });
export const stationDimension = (keyColumn: string): SemanticDimension =>
  entityDimension({ id: "istasyon", name: "İstasyon", keyColumn, table: "stations", alias: "dm_st" });
export const machineDimension = (keyColumn: string): SemanticDimension =>
  entityDimension({ id: "tezgah", name: "Tezgah", keyColumn, table: "machines", alias: "dm_ma" });
export const subcontractorDimension = (keyColumn: string): SemanticDimension =>
  entityDimension({ id: "fasoncu", name: "Fasoncu", keyColumn, table: "subcontractors", alias: "dm_sb" });

/** Vardiya: kod anahtar, ad etiket. Kurallar boşsa (hazırlanmamış küp) her satır NULL vardiyadır. */
export function shiftDimension(column: string, rules: readonly ShiftRule[]): SemanticDimension {
  const key = shiftOfSql(column, rules);
  return {
    id: "vardiya", name: "Vardiya", kind: "category", valueType: "enum", enumValues: rules.map((r) => r.code), cardinalityCap: DEFAULT_CAP,
    keySql: key,
    labelSql: Prisma.sql`dm_sd.name`,
    joins: Prisma.sql`LEFT JOIN shift_definitions dm_sd ON dm_sd.code = ${key}`,
  };
}

/** Hata grubu (`DefectType.defectGroup`): kapalı küme; grupsuz kayıt NULL anahtar + "Gruplanmamış". */
export function defectGroupDimension(column: string): SemanticDimension {
  const col = Prisma.raw(column);
  const whens = DEFECT_GROUPS.map((g) => Prisma.sql`WHEN ${g}::text THEN ${DEFECT_GROUP_LABELS[g]}::text`);
  return {
    id: "hataGrubu", name: "Hata grubu", kind: "category", valueType: "enum", enumValues: DEFECT_GROUPS, cardinalityCap: DEFAULT_CAP,
    keySql: Prisma.sql`(CASE WHEN ${col} IN (${Prisma.join(DEFECT_GROUPS.map((g) => Prisma.sql`${g}::text`))}) THEN ${col} END)`,
    labelSql: Prisma.sql`(CASE ${col} ${Prisma.join(whens, " ")} ELSE ${UNGROUPED_LABEL}::text END)`,
  };
}

/** Sabit kümeli sınıf boyutu (yön, kaynak, statü): anahtar metin, etiket koddaki sözlükten. */
interface EnumSpec { id: string; name: string; column: string; labels: Readonly<Record<string, string>>; nullLabel: string }

export function enumDimension({ id, name, column, labels, nullLabel }: EnumSpec): SemanticDimension {
  const col = Prisma.raw(column);
  const values = Object.keys(labels);
  const whens = values.map((v) => Prisma.sql`WHEN ${v}::text THEN ${labels[v]!}::text`);
  return {
    id, name, kind: "category", valueType: "enum", enumValues: values, cardinalityCap: DEFAULT_CAP,
    keySql: Prisma.sql`(${col})::text`,
    labelSql: Prisma.sql`(CASE (${col})::text ${Prisma.join(whens, " ")} ELSE ${nullLabel}::text END)`,
  };
}

/** Yalnız helper ölçülerin kullandığı boyut: SQL anahtarı yoktur, SQL ölçüyle seçilirse derleyici reddeder. */
export function helperOnlyDimension(id: string, name: string, valueType: SemanticDimension["valueType"], enumValues?: readonly string[]): SemanticDimension {
  return {
    id, name, kind: "category", valueType, cardinalityCap: DEFAULT_CAP, keySql: Prisma.sql`NULL::text`, helperOnly: true,
    ...(enumValues ? { enumValues } : {}),
  };
}

/** Yalnız helper ölçü taşıyan küpün gövdesi: derleyici helper'da SQL üretmez, bu gövde hiç koşmaz. */
export const helperOnlySource = (): Prisma.Sql => Prisma.sql`(SELECT NULL::timestamptz AS at) p`;
