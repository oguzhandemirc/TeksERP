// Patron bulutu projeksiyon kataloğunun TİPLERİ ve kurucu yardımcıları. Kataloğun kendisi
// `projections.ts` (BOYUT + ANLIK + dışa açılan küme) ve `catalog-facts.ts` (OLGU) dosyalarındadır;
// tüketiciler yalnız `projections.ts`i içe aktarır.

/** Kolon veri sınıfı — FINANS/KISISEL kök satırla gitmez, `<ad>.finans` / `<ad>.kisisel` alt satırına bölünür. */
export type DataClass = "ISLEM" | "FINANS" | "KISISEL";
export type ProjectionRole = "BOYUT" | "OLGU";
/** YOK: ölçülmüş hard delete yolu yok (tetikleyici yine kurulu) · DAMGA: var · KAPSAM_DISI: silinen satır buluta hiç girmemişti. */
export type DeletionStrategy = "YOK" | "DAMGA" | "KAPSAM_DISI";
export type SnapshotCadence = "HER_TUR" | "SAATLIK" | "GUNLUK";
/** Projeksiyonu kapatan fabrika modül anahtarı (enforcement okuyucusu — lisans tavanı dahil). */
export type ModuleKey = "production.enabled" | "finance.enabled";

export interface ColumnSpec {
  /** Paketteki alan adı (sözleşme; fabrika kolonu yeniden adlandırılsa da değişmez). */
  readonly wire: string;
  /** Prisma alan adı (= DB kolonu; şema ölçümü `patron-sema-olcumu` ①). */
  readonly source: string;
  readonly dataClass: DataClass;
}

export interface DerivedSpec {
  readonly wire: string;
  /** Fabrikadaki TEK KAYNAK yardımcı — `derived.ts` bunu çağırır, formül kopyalanmaz. */
  readonly helper: string;
  /** Hesabın okuduğu tablolar — her biri ya kökte ya değişiklik kaynağında olmalı (§4.3d bekçisi). */
  readonly reads: readonly string[];
  /** Hiçbir satır değişmeden fabrika gününün dönmesiyle değişir (⏱, §4.3c). */
  readonly timeBound: boolean;
  readonly dataClass: DataClass;
}

/** Eşitlik bozucu kolon ve SQL tipi (satır değeri karşılaştırması `$n::<cast>` ister). */
export interface TieColumn {
  readonly column: string;
  readonly cast: string;
}
export const ID_TIE: readonly TieColumn[] = [{ column: "id", cast: "uuid" }];

/**
 * Değişiklik kaynağı: bu tablodaki `(filigran, bozucu)` ilerlemesi hangi kök kimliklerini
 * kirletir. `self` = kök tablonun kendisi · `column` = değişen satırın kolonu kök kimliğidir ·
 * `lookup` = değişen satırların `keyColumn` değerleri `$1::uuid[]` olarak verilir, SQL
 * `root_id` kolonu döndürür.
 */
export type RootMapping =
  | { readonly kind: "self" }
  | { readonly kind: "column"; readonly column: string }
  | { readonly kind: "lookup"; readonly keyColumn: string; readonly sql: string };

export interface ChangeSource {
  readonly table: string;
  readonly watermark: "updatedAt" | "createdAt";
  readonly tieBreaker: readonly TieColumn[];
  readonly root: RootMapping;
  readonly note?: string;
}

/** Kök satırın buluta girme koşulu — Prisma parçası ile SQL ikizi BİRLİKTE değişir (boğaz-ikiz). */
export interface ScopeSpec {
  readonly note: string;
  readonly prismaWhere: Readonly<Record<string, unknown>>;
  /** Kök tablo `t` takma adıyla. */
  readonly sql: string;
}

/** OLGU'nun saklama tarihi (§9.5): bulut `saklama_tarihi`ni bu tel alanlarından (ilk dolu) okur. */
export interface RetentionSpec {
  readonly wireFields: readonly string[];
  /** Tarihi kendi satırında olmayan çocuk: saklama tarihi ebeveyn projeksiyonun satırından okunur. */
  readonly parent?: { readonly projection: string; readonly wireKey: string };
  /** Fabrika tarafı ifade (kök `t`): TAM gönderim ve uzlaştırma bulutun ufkuyla sınırlanır. */
  readonly sql: string;
}

/**
 * Zamana bağlı türetilmiş alanın (⏱) GEÇİŞ kaynağı: hiçbir satır değişmeden değeri dönen
 * kökler — `$1` önceki konum, `$2` ufuk (ikisi timestamptz); SQL `root_id` döndürür.
 * Bulut tarih karşılaştırması yapmaz (§1.1): geçiş anı gelince fabrika kökü yeniden kurar.
 */
export interface TimeCrossing {
  readonly name: string;
  readonly sql: string;
}

export interface RecordProjection {
  readonly name: string;
  readonly kind: "KAYIT";
  readonly role: ProjectionRole;
  readonly root: { readonly table: string; readonly model: string };
  readonly scope?: ScopeSpec;
  readonly columns: readonly ColumnSpec[];
  readonly derived: readonly DerivedSpec[];
  readonly sources: readonly ChangeSource[];
  /** Filigransız bağımlılık: değişikliği DB tetikleyicisi kökü KIRLI işaretleyerek bildirir (`sync_marks`). */
  readonly markedBy?: ReadonlyArray<{ readonly table: string; readonly trigger: string }>;
  readonly crossings?: readonly TimeCrossing[];
  readonly deletion: DeletionStrategy;
  /** Bulut okuma izni (§10); FINANS/KISISEL alt satırlar `SUB_ROW_PERMISSION` ile. */
  readonly permission: string;
  readonly module?: ModuleKey;
  readonly retention?: RetentionSpec;
  /** Kolon kümesi sürümü (§6.6): alan çıkarmak/anlam değiştirmek artırır ve TAM gönderim doğurur. */
  readonly catalogVersion: number;
}

export interface SnapshotSection {
  /** Tel adı `<projeksiyon>.<bolum>`. */
  readonly name: string;
  readonly permission: string;
  readonly module?: ModuleKey;
}

export interface SnapshotProjection {
  readonly name: string;
  readonly kind: "ANLIK";
  readonly source: string;
  readonly cadence: SnapshotCadence;
  readonly permission: string;
  readonly module?: ModuleKey;
  readonly reads: readonly string[];
  /** Bölümlü anlık (`ozet`): her bölüm ayrı alt kayıt ve ayrı izin (§3.3). */
  readonly sections?: readonly SnapshotSection[];
}

export type Projection = RecordProjection | SnapshotProjection;

export const col = (wire: string, source: string, dataClass: DataClass = "ISLEM"): ColumnSpec => ({ wire, source, dataClass });
export const self = (table: string, watermark: "updatedAt" | "createdAt" = "updatedAt"): ChangeSource => ({
  table,
  watermark,
  tieBreaker: ID_TIE,
  root: { kind: "self" },
});
export const via = (table: string, column: string, note?: string): ChangeSource => ({
  table,
  watermark: "updatedAt",
  tieBreaker: ID_TIE,
  root: { kind: "column", column },
  ...(note ? { note } : {}),
});
export const lookup = (table: string, keyColumn: string, sql: string, note?: string): ChangeSource => ({
  table,
  watermark: "updatedAt",
  tieBreaker: ID_TIE,
  root: { kind: "lookup", keyColumn, sql },
  ...(note ? { note } : {}),
});
export const derived = (
  wire: string,
  helper: string,
  reads: readonly string[],
  opts: { timeBound?: boolean; dataClass?: DataClass } = {},
): DerivedSpec => ({ wire, helper, reads, timeBound: opts.timeBound ?? false, dataClass: opts.dataClass ?? "ISLEM" });
