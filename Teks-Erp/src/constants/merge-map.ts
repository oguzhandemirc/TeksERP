// =============================================================================
// ANA VERİ BİRLEŞTİRME HARİTASI (Faz B2)
// =============================================================================
// Bir mükerrer kaydı survivor'a birleştirirken ONA İŞARET EDEN her satırın ne
// olacağı burada yazılı. Önizleme, uygulama VE bekçi aynı haritadan beslenir —
// üçünün ayrışması mümkün olmasın diye (izin kataloğu dersi: kopyalanan liste
// zamanla ayrışır).
//
// ⚠️ TAM KAPSAMA MEKANİK DOĞRULANIR: `scripts/test_master_data_merge_fk_coverage.ts`
// `schema.prisma` metninden bu dört modele işaret eden HER FK'yı türetir ve
// haritanın hepsini kapsadığını İKİ YÖNLÜ kontrol eder (bilinmeyen FK düşürür,
// ölü giriş de düşürür). Kapattığı delik: "gelecek yıl biri 13. FK'yı ekler,
// merge onu sessizce ölü kayda bakar bırakır."
//
// ⚠️ Türetme kaynağı `Prisma.dmmf` OLAMAZ (ölçüldü 2026-08-19): Prisma 7'nin
// runtime DMMF'i ilişki alanında yalnız `{name, kind, type, relationName}`
// taşır — `relationFromFields` YOKTUR, yani "Roll ile Item ilişkili" bilinir
// ama HANGİ KOLON üzerinden bilinmez ve kayıt ilişkinin iki yanında da görünür
// (sahiplik ayırt edilemez). Bu yüzden bekçi şema METNİNİ ayrıştırır.

export const MERGE_ENTITIES = ["customer", "item", "color", "subcontractor"] as const;
export type MergeEntity = (typeof MERGE_ENTITIES)[number];

/** Çakışma çözüm politikaları — gerekçeleri aşağıdaki haritada satır satır. */
export type ConflictPolicy =
  /** Survivor'ın satırı kalır, kaynağınki ATILIR (değeri önizlemede + audit'te). */
  | "SKIP"
  /** Çakışmayan satır taşınır, çakışan satır SİLİNİR (saf M:N kolaylık bağı). */
  | "UNION"
  /** UNION ama composite PK: `updateMany` PK'nın yarısını değiştiremez → DELETE+INSERT. */
  | "UNION_COMPOSITE_PK"
  /** Alan alan birleşir (OR / COALESCE) — bkz. `customer_color_aliases`. */
  | "MERGE_FIELDS"
  /** "Boş = hepsi" asimetrisi: survivor boşsa kaynağınki ATILIR (bkz. aşağı). */
  | "EMPTY_MEANS_ALL"
  /** Çözülemez — 409 ile operatöre geri döner (bkz. şube ihracat kodu). */
  | "BLOCK";

export type MoveRule =
  | { kind: "MOVE"; model: string; table: string; column: string; label: string }
  | {
      kind: "CONFLICT";
      model: string;
      table: string;
      column: string;
      label: string;
      /** Çakışmayı doğuran UNIQUE kısıtın kolonları. */
      uniqueOn: string[];
      policy: ConflictPolicy;
      why: string;
    }
  | { kind: "EXEMPT"; model: string; table: string; column: string; reason: string };

// —————————————————————————————————————————————————————————————————————————————
// ⚠️ "BOŞ = HEPSİ" ASİMETRİSİ — bu dosyanın en sinsi tek maddesi.
// `item_allowed_colors` / `item_allowed_properties` satır kümesi bir KÜME değil
// bir KISITTIR: satır yoksa "hepsi serbest" demektir. Survivor BOŞ + kaynak 3
// satır → naif union survivor'ı HEPSİ'ten 3'e DARALTIR ve o kumaş bir daha 4.
// renkle sipariş edilemez. Doğrusu: survivor boşsa kaynağınki ATILIR.
// ⚠️ Bu YALNIZ kumaş birleştirmesinde geçerli. RENK birleştirmesinde aynı tablo
// düpedüz dedupe'dur (bir rengin yerine başka renk yazılıyor, kısıt daralmıyor).
// —————————————————————————————————————————————————————————————————————————————


// ⚠️ KURALLAR DÖRT DOSYAYA BÖLÜNDÜ (2026-09-13) — SÖZLEŞME DEĞİŞMEDİ:
// `MERGE_MAP` hâlâ TEK nesne olarak buradan çıkar ve `master-data-merge.service`in
// jenerik sürücüsü (`MERGE_MAP[entity]` döngüsü) hiçbir değişiklik görmez.
// Bölme sebebi: dosya `max-lines` sınırına dayandı ve içinde DÖRT AYRI İŞ vardı.
// Tavanı yükseltmek çözüm değildi — her yeni model haritayı büyütür (dokuma P2/P3),
// yani tavan her seferinde yükselir ve sınır anlamsızlaşır.
import { CUSTOMER_MERGE_RULES } from "./merge-map.customer";
import { ITEM_MERGE_RULES } from "./merge-map.item";
import { COLOR_MERGE_RULES } from "./merge-map.color";
import { SUBCONTRACTOR_MERGE_RULES } from "./merge-map.subcontractor";

export const MERGE_MAP: Record<MergeEntity, MoveRule[]> = {
  customer: CUSTOMER_MERGE_RULES,
  item: ITEM_MERGE_RULES,
  color: COLOR_MERGE_RULES,
  subcontractor: SUBCONTRACTOR_MERGE_RULES,
};

/** Bir varlığın haritasındaki tabloların düz listesi (önizleme/bekçi için). */
export function rulesFor(entity: MergeEntity): MoveRule[] {
  return MERGE_MAP[entity];
}
