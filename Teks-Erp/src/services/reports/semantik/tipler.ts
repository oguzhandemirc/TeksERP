// =============================================================================
// SEMANTİK KATMAN — SÖZLEŞME TİPLERİ (Raporlar v2, R1-SEMCEK; plan §3.1)
// =============================================================================
// Kullanıcı yalnız KİMLİK seçer (küp · ölçü · boyut · işleç); değerler hep parametredir ve
// SQL'i yalnız derleyici üretir. Ölçünün adı/açıklaması/birimi `tanimlar.ts` sözlüğündedir —
// burada yalnız ölçünün NASIL hesaplandığı ve KİMİN görebildiği yazılır (tek kaynak).
// Tel/JSON anahtarları Türkçe (`kup`, `olculer`, `boyutlar`), iç adlar İngilizce ([IL-16]).
// =============================================================================
import type { Prisma } from "@prisma/client";
import type { DateRange } from "../_shared";

/** Modül beyanı: rapor kataloğuyla aynı söz dağarcığı (`cekirdek:*` her zaman açık, ya da `ModulKey`). */
export type ModuleRef = string;

/** Kümelenebilir ölçü: SUM/COUNT ifadesi küp takması `p` üstünde; oran pay/paydadan YENİDEN hesaplanır. */
export interface SemanticMeasure {
  /** `tanimlar.ts` sözlüğündeki kimlik (`sevk.brutMetre`) — sözlükte yoksa küp kaydı reddedilir. */
  id: string;
  permission: string;
  module: ModuleRef;
  kind: "sum" | "ratio" | "helper";
  /** kind=sum: `SUM(p.qty)` gibi küme ifadesi (yalnız kod yazar, kullanıcı girdisi girmez). */
  sql?: Prisma.Sql;
  /** kind=ratio: pay ve payda aynı küpün `sum` ölçüleridir; ortalama ortalanmaz. */
  numerator?: string;
  denominator?: string;
  /** kind=ratio: sözlük birimi "yuzde" ise pay/payda ×100 döner (helper ölçülerle aynı ölçek). */
  percent?: true;
  /** kind=helper: mevcut servise bağ; yalnız beyan ettiği boyutlarla kesilir (gerisi 400). */
  helper?: SemanticHelper;
  /** Sayı eşitliği bekçisinin hedefi (`test_semantik_sayi_esitligi`, R1-SEMKUP) ya da gerekçeli muafiyet. */
  parity: { report: string; field: string; legacy?: string } | { exempt: string };
}

export interface HelperInput {
  range: DateRange;
  dimensions: readonly SemanticDimension[];
  filters: readonly CompiledFilter[];
  cap: number;
}

/** Helper ölçünün satırı: boyut anahtarları + (para ölçüsünde) para birimi + değer. */
export interface HelperRow {
  keys: Record<string, { value: string | null; label: string | null; other?: true }>;
  currency?: string;
  value: number | null;
}

export interface HelperResult {
  rows: HelperRow[];
  totals: Array<{ currency?: string; value: number | null }>;
  notes: string[];
}

export interface SemanticHelper {
  dimensions: readonly string[];
  /** Para ölçüsü: değerler para birimi başına ayrı döner, çevrim uydurulmaz. */
  perCurrency: boolean;
  compute(input: HelperInput): Promise<HelperResult>;
}

/** Boyut: anahtar ifadesi `p` takması (ve `joins` takmaları) üstünde; değer tipi süzgeç doğrulamasını belirler. */
export interface SemanticDimension {
  id: string;
  name: string;
  kind: "time" | "category";
  keySql: Prisma.Sql;
  labelSql?: Prisma.Sql;
  /** Etiket için gereken LEFT JOIN'ler (takma adları boyuta özgü). */
  joins?: Prisma.Sql;
  /** Süzgeç değerinin biçimi; `enum` ise izinli değerler `enumValues`te. */
  valueType: "uuid" | "enum" | "date";
  enumValues?: readonly string[];
  /** Kırılım tavanı (varsayılan 50) — fazlası "Diğer" kovasına. Zaman boyutu kesilmez. */
  cardinalityCap: number;
  permission?: string;
  module?: ModuleRef;
  /** K-KISI: kişi adı taşıyan boyut buluta gitmez (`RaporSunumu.kisiAdi`). */
  personName?: true;
  /** SQL anahtarı yok: yalnız helper ölçü kesebilir (derleyici SQL ölçüde 400 verir). */
  helperOnly?: true;
  /** `enumValues` sırası anlamlı (saat): "arasında" işleci bu sırayla açılır, sondan başa sarar (22–2). */
  ordered?: true;
}

export interface SemanticCube {
  id: string;
  name: string;
  permission: string;
  module: ModuleRef;
  /** FROM gövdesi: `p` takmasıyla seçilecek satırlar — K18/statü/brüt kuralları BURADA, kullanıcıda değil. */
  source(range: DateRange): Prisma.Sql;
  /** Zaman boyutlarının ve dönem anahtarının okuduğu kolon (`p.at`). */
  timeColumn: string;
  measures: readonly SemanticMeasure[];
  dimensions: readonly SemanticDimension[];
  /** Sunumda kullanıcıya söylenecek bilinen sınırlar. */
  notes?: readonly string[];
  /**
   * Fabrika ayarına bağlı parçaları (vardiya pencereleri, 1. kalite rolü) DB'den çözen kopya.
   * Derleyici senkron kalır; çalıştırıcı derlemeden ÖNCE çağırır (`prepareCubes`).
   */
  prepare?: () => Promise<SemanticCube>;
}

export const FILTER_OPERATORS = ["=", "!=", "in", "notIn", "contains", "between"] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** "arasında" derlemede sıralı değer listesine açılır — derlenmiş süzgeçte yoktur. */
export interface CompiledFilter {
  dimension: SemanticDimension;
  operator: Exclude<FilterOperator, "between">;
  values: readonly string[];
}

/** Süzgeç ağacı: kök + bir seviye iç grup (plan §3.2); her grup SQL'de parantezlenir. */
export interface CompiledFilterGroup {
  combinator: "and" | "or";
  items: ReadonlyArray<CompiledFilter | CompiledFilterGroup>;
}

/** Derleyicinin çıktısı: tek SQL + çözülmüş sözlük kayıtları. */
export interface CompiledQuery {
  cube: SemanticCube;
  measures: readonly SemanticMeasure[];
  dimensions: readonly SemanticDimension[];
  filter: CompiledFilterGroup;
  period: PeriodSpec | null;
  cap: number;
  range: DateRange;
  /** helper ölçüde null — çalıştırıcı `measures[0].helper.compute` çağırır. */
  sql: Prisma.Sql | null;
}

export interface PeriodSpec {
  unit: "gun" | "hafta" | "ay";
  count: number;
}
