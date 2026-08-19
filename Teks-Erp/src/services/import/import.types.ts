// =============================================================================
// TOPLU İÇE AKTARIM — SÖZLEŞME (tipler)
// =============================================================================
// Tasarım: docs/design/IMPORT-EXPORT-TASARIM.md
//
// Akış: panel dosyayı ayrıştırır (xlsx/csv) → ham hücreler JSON olarak gelir →
// `preview` satır satır DOĞRULAR (hiçbir şey yazmaz) → `apply` AYNI doğrulamayı
// baştan koşar ve yazar. Panelin gönderdiği önizleme sonucuna GÜVENİLMEZ
// (sevkiyat iptal-önizleme/uygula emsali: önizleme ile uygulama arasında dünya
// değişmiş olabilir).
//
// ⚠️ Backend'de CSV/XLSX ayrıştırıcı YOKTUR ve eklenmeyecektir (Allowed
// Packages). Dosya biçimi panelin sorunudur; buraya yalnız `Record<string,string>`
// hücreler gelir.

/** Sütun veri tipi — dönüştürme + şablondaki açıklama bundan türer. */
export type ImportColumnType = "text" | "number" | "int" | "bool" | "date" | "enum" | "lookup";

export interface ImportEnumValue {
  value: string;
  label: string;
}

export interface ImportLookupSpec {
  /** Hedef varlık (çözümleyici bunu bilir): "item" | "color" | "station" | ... */
  entity: string;
  /** Birincil eşleşme alanı. Ad ile eşleşme her zaman İKİNCİL ve uyarılıdır. */
  by: "code" | "name";
  /** true → hücre `;` ile ayrılmış çoklu değer taşır (kod listesi). */
  multiple?: boolean;
}

export interface ImportColumn {
  /** Payload alan adı (adaptörün anladığı). */
  key: string;
  /** Excel başlığı — TÜRKÇE, ekrandaki kolon adıyla aynı. */
  label: string;
  type: ImportColumnType;
  /** CREATE için zorunlu mu (UPDATE'te zorunluluk aranmaz — boş = dokunma). */
  required?: boolean;
  enumValues?: ImportEnumValue[];
  lookup?: ImportLookupSpec;
  maxLen?: number;
  /** Şablonun "Açıklama" sayfasına yazılan kural cümlesi. */
  help?: string;
  /** Şablonun örnek satırındaki değer. */
  example?: string;
  /** true → yalnız CREATE'te yazılır; UPDATE'te doluysa satır HATA verir
   *  (sessizce yok saymak "kodu düzelttim" sanan kullanıcıyı yanıltır). */
  createOnly?: boolean;
  /** true → dosyada bu sütun HİÇ olmasa da sorun değil (bilgi amaçlı export sütunu). */
  readOnly?: boolean;
  /**
   * ÇOCUK SÜTUN (yalnız `grouped` adaptörlerde): değeri kaydın kendisine değil,
   * ALT SATIRINA aittir (ör. rota ADIMI). Aynı anahtarı taşıyan her satır bir
   * çocuk üretir; başlık sütunları yalnız grubun İLK satırından okunur.
   */
  child?: boolean;
}

/** Bir satırın nihai kararı. */
export type ImportRowAction = "CREATE" | "UPDATE" | "SKIP" | "ERROR";

export interface ImportRowIssue {
  /** Hangi sütun (yoksa satır geneli). */
  column?: string;
  message: string;
}

export interface ImportRowInput {
  /** Dosyadaki satır numarası (başlık satırı 1 → ilk veri satırı 2). Kullanıcı
   *  hatayı dosyada BULABİLMELİ; kendi ürettiğimiz sıra numarası işe yaramaz. */
  rowNo: number;
  cells: Record<string, string>;
}

export interface ImportRowResult {
  rowNo: number;
  /** `grouped` adaptörlerde gruba giren TÜM satır numaraları (ör. [4,5,6]). */
  rowNos?: number[];
  action: ImportRowAction;
  /** Eşleşme anahtarı (genelde kod) — kullanıcı satırı tanısın. */
  key?: string | null;
  /** İnsan-okunur etiket (ad) — anahtar boşken satırı tanıtan tek şey. */
  label?: string | null;
  /** UPDATE hedefi. */
  targetId?: string | null;
  /** UPDATE'te değişecek alanlar: {alan: {from, to}}. Boşsa SKIP'e döner. */
  changes?: Record<string, { from: unknown; to: unknown }>;
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
}

export interface ImportOptions {
  /**
   * `upsert` (varsayılan): anahtar eşleşirse güncelle, yoksa oluştur.
   * `createOnly`: eşleşen satır HATA (yanlışlıkla güncellemeyi önler).
   * `updateOnly`: eşleşmeyen satır HATA.
   */
  mode?: "upsert" | "createOnly" | "updateOnly";
  /**
   * `abort` (varsayılan, D2): tek hata varsa HİÇBİR ŞEY yazılmaz.
   * `skip`: hatalı satırlar atlanır, geçerliler yazılır.
   */
  onError?: "abort" | "skip";
  /** Aynı denemenin tekrarı (timeout-retry) ikinci kez yazmasın. */
  clientToken?: string;
  /** Geçmişte görünsün diye (kullanıcı hangi dosyayı yüklediğini hatırlasın). */
  fileName?: string;
}

export interface ImportPreviewResult {
  entity: string;
  rows: ImportRowResult[];
  summary: {
    total: number;
    create: number;
    update: number;
    skip: number;
    error: number;
    /** Uyarı taşıyan satır sayısı (hata değil ama okunması gereken). */
    warning: number;
  };
  /** Dosyada olup spec'te olmayan sütunlar — yok sayıldı (sessiz kalmasın). */
  unknownColumns: string[];
}

export interface ImportApplyResult extends ImportPreviewResult {
  runId: string;
  status: "APPLIED" | "PARTIAL" | "FAILED";
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  durationMs: number;
  /**
   * PARTIAL'da doldurulur: yazma sırasında beklenmedik hata alınan satır.
   * Sessiz kısmi sonuç yasak — kullanıcı NEREDE durduğunu görmeli.
   */
  stoppedAtRowNo?: number;
}

/** Adaptörün doğrulama/yazma sırasında ihtiyaç duyduğu bağlam. */
export interface ImportContext {
  userId?: string;
  /** Aynı istekteki tüm satırlar için paylaşılan lookup önbelleği. */
  cache: Map<string, Map<string, LookupHit>>;
}

export interface LookupHit {
  id: string;
  code?: string | null;
  name?: string | null;
  isActive: boolean;
}

/** Bir satırın dönüştürülmüş (tip'lenmiş) hâli + kararı. */
export interface PreparedRow {
  input: ImportRowInput;
  /** Yalnız DOLU hücrelerden türeyen değerler. Boş hücre burada YOKTUR
   *  ("dokunma" sözleşmesi); `NULL` yazan hücre burada `null` olarak durur. */
  values: Record<string, unknown>;
  result: ImportRowResult;
  /** UPDATE hedefi (varsa) — adaptörün mevcut kaydı. */
  existing?: Record<string, unknown> | null;
  /**
   * `grouped` adaptörlerde: gruptaki HER satırın çocuk sütun değerleri, dosya
   * sırasıyla. Rota adımları / reçete kalemleri gibi "bir kayıt, N satır"
   * yapıları buradan okunur.
   */
  children?: Array<{ rowNo: number; values: Record<string, unknown> }>;
}

/**
 * AD MÜKERRER guard'ının ÖNİZLEMEDEKİ ikizi — varyantı adaptör beyan eder.
 * Beyan edilmezse kontrol KOŞMAZ (fail-open): yanlış pozitif, meşru bir içe
 * aktarımı bloklar ve kaçırmaktan kötüdür. Gerekçe: `import-name-guard.ts`.
 */
export interface NameGuardSpec {
  /** Prisma model anahtarı ("item", "color"…). */
  model: string;
  /** Ad kolonu (genelde "name"). */
  field: string;
  /** 409 mesajındaki Türkçe varlık adı ("renk", "müşteri"). */
  label: string;
  /** Katlama: "tr" (varsayılan) | "color" (ayraç + token sırası bağımsız). */
  fold?: "tr" | "color";
  /** false → DB gölge kolonu yerine tümünü çekip JS'te katla (küçük katalog). */
  useFoldColumn?: boolean;
  /** Mesajı zenginleştiren kod kolonu ("code"). */
  codeField?: string;
  /** Ad yalnız bu kapsam içinde tekilse (makine → istasyon, şube → müşteri). */
  scope?: {
    /** Kapsam id'sini taşıyan PAYLOAD anahtarı (ör. "stationCode__id"). */
    valueKey: string;
    /** Kapsamın DB kolonu (ör. "stationId"). */
    column: string;
  };
}

export interface ImportAdapter {
  /** URL'de görünen kimlik: /api/import/<entity>/preview */
  entity: string;
  /** Menüde/başlıkta görünen Türkçe ad. */
  label: string;
  /** Audit `tableName` (SystemLog). */
  tableName: string;
  /** Bu varlığa yazmak için gereken izin (data:import'a EK olarak aranır). */
  writePermission: string;
  /** Bu varlığı okumak/dışa aktarmak için gereken izin. */
  readPermission: string;
  /** Eşleşme anahtarı sütun(ları). Bugün hepsinde tek sütun ("code"). */
  keyColumns: string[];
  columns: ImportColumn[];
  /** Şablonun başına yazılan kısa kullanım notu. */
  notes?: string[];
  /**
   * Ad-mükerrer kontrolünün ÖNİZLEMEDE de koşması için varyant beyanı.
   * Yoksa kontrol koşmaz ve çakışma ancak YAZMA anında görülür.
   */
  nameGuard?: NameGuardSpec;
  /**
   * true → AYNI ANAHTARI taşıyan satırlar TEK kayıt oluşturur (mükerrer anahtar
   * hatası verilmez). Başlık sütunları grubun ilk satırından, `child: true`
   * sütunları her satırdan okunur. Rota (adımlar) böyle çalışır.
   * ⚠️ Çocuk listesi REPLACE semantiğidir: dosyadaki adımlar neyse o kalır.
   */
  grouped?: boolean;

  /** Anahtar değerine göre mevcut kayıtları toplu getirir (N+1 yok). */
  findExisting(keys: string[]): Promise<Map<string, Record<string, unknown>>>;

  /** Satır bazlı iş kuralları — tip dönüşümünden SONRA koşar. Hata/uyarı ekler. */
  validateRow?(row: PreparedRow, ctx: ImportContext): Promise<void> | void;

  /** Tek satır yazar. Mevcut SERVİSİ çağırır (guard'lar korunsun) — ham Prisma YASAK. */
  createOne(row: PreparedRow, ctx: ImportContext): Promise<{ id: string }>;
  updateOne(row: PreparedRow, ctx: ImportContext): Promise<{ id: string }>;

  /** Round-trip dışa aktarım: kayıtları şablon sütunlarına göre satırlaştırır. */
  exportRows(): Promise<Array<Record<string, string>>>;
}
