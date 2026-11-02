// Kaynak: ocr-test prototipi src/ocr-engine/types.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
// Dış bağımlılık yok; yalnız göreli import. Değişiklikler: çift tırnak, proje lint/boyut kuralları, Türkçe yorumlar korundu.
/**
 * OCR motoru sözleşmesi (contract).
 *
 * Bu dosya üç katman arasındaki ortak tipleri tanımlar:
 *  1. Native modül (modules/ocr-native) → ham OCR çıktısı (OcrResult; ML Kit Text Recognition v2 şekli)
 *  2. Saf TS çıkarım motoru (src/ocr-engine) → şablon (DocumentTemplate) + ham OCR → alan sonuçları (ExtractionResult)
 *  3. Uygulama (src/screens) → sonucu forma doldurur, düşük güvenli alanları kullanıcıya onaylatır.
 *
 * Kural: Bu dosya React Native'e bağımlı DEĞİLDİR; motor Node/Jest üzerinde koşar.
 */

// ---------------------------------------------------------------------------
// 1) Ham OCR çıktısı (native modülden gelir)
// ---------------------------------------------------------------------------

/** Görüntü piksel koordinatı (sol-üst köşe orijin). */
export interface OcrPoint {
  x: number;
  y: number;
}

/** Eksenlere hizalı sınırlayıcı kutu; piksel cinsinden, görüntü koordinatında. */
export interface OcrRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Kelime düzeyi (ML Kit "Element"). */
export interface OcrElement {
  text: string;
  rect: OcrRect;
  /** Dört köşe (döndürülmüş metin için); yoksa rect'ten türetilir. */
  corners?: OcrPoint[];
  /** 0..1; ML Kit v2 Latin modeli sağlar, yoksa null. */
  confidence: number | null;
  /** Derece; ML Kit sağlar, yoksa null. */
  angle?: number | null;
}

/** Satır düzeyi (ML Kit "Line"). */
export interface OcrLine {
  text: string;
  rect: OcrRect;
  corners?: OcrPoint[];
  confidence: number | null;
  angle: number | null;
  elements: OcrElement[];
}

/** Paragraf/blok düzeyi (ML Kit "TextBlock"). */
export interface OcrBlock {
  text: string;
  rect: OcrRect;
  corners?: OcrPoint[];
  lines: OcrLine[];
}

/** Bir görüntünün tam OCR çıktısı. */
export interface OcrResult {
  /** Tüm metin, bloklar arası '\n' ile. */
  text: string;
  blocks: OcrBlock[];
  /** OCR'a verilen görüntünün boyutu (rect'ler bu uzaya göredir). */
  imageWidth: number;
  imageHeight: number;
  durationMs?: number;
  /** 'mlkit-latin' gibi; ileride 'paddleocr' vb. eklenebilir. */
  engine?: string;
  /** Okuma servisi sayfayı dikleştirmek için girdiye saat yönünde uyguladığı dönüş (0/90/180/270); rect'ler DİK çerçevededir. */
  rotation?: number;
}

// ---------------------------------------------------------------------------
// 2) Şablon (belge tipi tanımı) — JSON olarak saklanır: src/ocr-engine/templates/*.json
// ---------------------------------------------------------------------------

/** Alan veri tipi; normalizasyon + doğrulama bu tipe göre yapılır. */
export type FieldType =
  | "text" // serbest metin (müşteri adı vb.)
  | "alnum" // harf+rakam kod (sipariş no, parti no) — O/0, I/1 karışıklığı pattern'e göre düzeltilir
  | "integer" // tam sayı (top sayısı)
  | "decimal" // ondalık (TR: 1.234,56 ve 1234.56 ikisi de kabul)
  | "date" // tarih; dateFormats ile ayrıştırılır, çıktı ISO 'YYYY-MM-DD'
  | "enum" // sabit küme (KABUL/RET/ŞARTLI); bulanık eşleme ile
  | "code"; // yalnız pattern ile tanımlı kod (ör. kumaş kodu ^[A-Z]{2}-\d{4}$)

/** Etiketten (anchor) değere doğru arama yönü. */
export type Direction = "right" | "below" | "sameLine" | "rightOrBelow";

/** Belge görüntüsüne göre normalize (0..1) dikdörtgen. Yalnız düzleştirilmiş (doc scanner) görüntüde güvenilirdir. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Etiket tabanlı strateji: 'labels' içinden biri (bulanık, TR-normalize) bulunur,
 * değer 'direction' yönünde, etiket kutusuna göre maxDistance (satır yüksekliği katı) içinde aranır.
 * Etiketin kendisi ve ':' / '-' ayraçları değerden ayıklanır.
 */
export interface AnchorStrategy {
  kind: "anchor";
  labels: string[];
  direction?: Direction; // varsayılan 'rightOrBelow'
  /** Etiket satır yüksekliğinin katı olarak azami uzaklık; varsayılan 2.5 */
  maxDistance?: number;
  /** Verilirse etiket yalnız bu bölgede aranır (sahte eşleşmeleri azaltır). */
  window?: NormRect;
  /** Değer okunurken başka bir etikete rastlanınca dur (varsayılan true). */
  stopAtLabels?: boolean;
  /** 'below' yönünde kaç satır alınacak (varsayılan 1). */
  takeLines?: number;
  /** Etiket eşleşmesi için asgari benzerlik 0..1 (varsayılan 0.8). */
  minLabelSimilarity?: number;
}

/** Düzenli ifade stratejisi: tüm metinde (ya da roi içinde) pattern aranır. */
export interface RegexStrategy {
  kind: "regex";
  pattern: string;
  flags?: string; // varsayılan 'i'
  group?: number; // varsayılan 1 varsa, yoksa 0
  roi?: NormRect;
}

/** Bölge stratejisi: roi içindeki tüm satırlar (okuma sırasında) birleştirilir. */
export interface RoiStrategy {
  kind: "roi";
  roi: NormRect;
  joinWith?: string; // varsayılan ' '
}

export type Strategy = AnchorStrategy | RegexStrategy | RoiStrategy;

export type PostProcess =
  | "upper" // TR büyük harf (i→İ, ı→I)
  | "stripSpaces"
  | "digitsOnly"
  | "trimPunct" // baş/son noktalama temizliği
  | "collapseSpaces";

export interface FieldSpec {
  /** Uygulamadaki input anahtarı (ör. 'siparisNo'). */
  key: string;
  /** Kullanıcıya gösterilen ad. */
  label: string;
  type: FieldType;
  required?: boolean;
  /** Sırayla denenir; ilk 'kabul edilebilir' sonuç alınır, aksi halde en iyi aday. */
  strategies: Strategy[];
  /** Doğrulama regex'i (normalizasyon SONRASI tam eşleşme). */
  pattern?: string;
  /** type='enum' için izinli değerler. */
  enumValues?: string[];
  /** Sayısal alanlar için sınırlar. */
  min?: number;
  max?: number;
  /** type='date' için; varsayılan ['DD.MM.YYYY','DD/MM/YYYY','DD-MM-YYYY','DD.MM.YY'] */
  dateFormats?: string[];
  /** Altındaysa needsReview=true. Varsayılan 0.85 */
  minConfidence?: number;
  postProcess?: PostProcess[];
  /** Azami karakter (uzun metin alanlarında taşmayı keser). */
  maxLength?: number;
}

export interface TemplateIdentifiers {
  /** Belge tipini tanıyan anahtar kelimeler (başlık vb.); bulanık, TR-normalize. */
  keywords: string[];
  /** Eşleşen keyword oranı eşiği 0..1; varsayılan 0.5 */
  minScore?: number;
  /** Ek: regex ile tanıma (ör. belge no formatı). Bulunursa skora +bonus. */
  regex?: string[];
}

export interface DocumentTemplate {
  id: string; // 'uretim-emri'
  name: string; // 'Üretim Emri'
  version: number;
  identifiers: TemplateIdentifiers;
  fields: FieldSpec[];
  /** D3a: tablo blokları (basılı çeki listesi satırları). */
  tables?: TableSpec[];
  /** D3a: el yazısı ızgarası (basılı sıra numarasından hücre). */
  grid?: GridSpec;
  /** Tablo bloğunun ÜSTÜNDEKİ bantta (önceki bloğun sonundan bu bloğun başlık satırına) blok başına yeniden okunan alan anahtarları (çeki listesinde her siparişin kendi İşlem/Parti/İş emri no'su). */
  blockFields?: string[];
  /** Tablosuz belge (tek top bilgisi başlıkta): başlık alanlarından tek satır türetme eşlemesi; her anahtar sırayla denenen alan listesi. */
  headerLine?: HeaderLineSpec;
}

/** Tablosuz belgenin başlığından tek satır: yalnız `count` alanı 1 okunduğunda (aksi uyarı) ve metre pozitifse. */
export interface HeaderLineSpec {
  count: string;
  m: string[];
  kg?: string[];
  en?: string[];
}

// ---------------------------------------------------------------------------
// 3) Çıkarım sonucu (motor çıktısı)
// ---------------------------------------------------------------------------

export interface FieldSource {
  strategy: Strategy["kind"] | "none";
  /** Eşleşen etiket metni (anchor için). */
  anchor?: string;
  /** Değerin görüntüdeki kutusu (UI'da vurgulamak için). */
  rect?: OcrRect;
  /** Deneme sırasındaki strateji indeksi. */
  strategyIndex?: number;
}

export interface FieldResult {
  key: string;
  /** Normalize edilmiş, doğrulanmış değer; bulunamadıysa null. */
  value: string | null;
  /** OCR'dan okunan ham metin. */
  raw: string | null;
  /** 0..1 birleşik güven (OCR güveni × etiket eşleşmesi × doğrulama). */
  confidence: number;
  /** Kullanıcı onayı gerekli mi (confidence < minConfidence ya da doğrulama hatası). */
  needsReview: boolean;
  source: FieldSource;
  /** 'pattern-mismatch', 'date-invalid', 'out-of-range', 'not-found', 'enum-no-match', 'low-ocr-confidence' ... */
  issues: string[];
  /** Alternatif adaylar (oylama/UI önerisi için). */
  candidates?: Array<{ value: string; confidence: number }>;
}

export interface ClassificationResult {
  templateId: string | null;
  score: number;
  scores: Record<string, number>;
}

export interface ExtractionResult {
  templateId: string;
  templateVersion: number;
  fields: Record<string, FieldResult>;
  /** Zorunlu alanların ortalama güveni. */
  overallConfidence: number;
  durationMs: number;
  warnings: string[];
}

export interface ExtractOptions {
  /** Varsayılan needsReview eşiği (alan minConfidence yoksa). Varsayılan 0.85 */
  defaultMinConfidence?: number;
  /** true ise her alanda tüm stratejiler denenir ve adaylar toplanır (debug). */
  collectCandidates?: boolean;
}

// ---------------------------------------------------------------------------
// 4) Motor iç yardımcı tipleri (sözleşmeye sonradan eklendi; mevcut tipler değişmedi)
// ---------------------------------------------------------------------------

/** Okuma sırasına dizilmiş bir satır grubu (aynı dikey bantta yer alan OcrLine'lar, soldan sağa). */
export interface Row {
  y: number;
  height: number;
  lines: OcrLine[];
  /** Satır metinleri '  ' (iki boşluk) ile birleştirilmiş. */
  text: string;
}

/** canonicalizeValue sonucu. */
export interface CanonicalResult {
  /** Kanonik değer; çözülemediyse null. */
  value: string | null;
  /** Konumsal/karışıklık düzeltmesi uygulandı mı (ör. O→0). */
  corrected: boolean;
  /** Normalizasyon sırasında saptanan hata kodları ('date-invalid', 'enum-no-match', ...). */
  issues: string[];
}

// ---------------------------------------------------------------------------
// 5) D3a eklemeleri — TABLO stratejisi, bölgeleme, ızgara hücresi, toplam sağlaması
//    (TASARIM-KARARI-2026-10-28 §3 adım 3, §5). Mevcut tipler değişmedi.
// ---------------------------------------------------------------------------

/** Tablo kolonu: başlık etiketleri (bulanık) + hücre tipi. */
export interface TableColumnSpec {
  key: string;
  label: string;
  type: Extract<FieldType, "integer" | "decimal" | "alnum" | "text">;
  /** Başlık satırında aranan etiketler (TR-normalize, bulanık). */
  headers: string[];
  /** Satırın geçerli sayılması için hücre dolu olmalı. */
  required?: boolean;
  pattern?: string;
}

/** Toplam satırı: etiketi ve hangi kolonların toplam taşıdığı. */
export interface TableTotalsSpec {
  /** "T.Adet", "TOPLAM" gibi etiketler. */
  labels: string[];
  /** Adet (satır sayısı) hücresi hangi kolon anahtarına yazılır; yoksa artakalan tam sayı hücre. */
  countKey?: string;
}

/**
 * TABLO stratejisi: başlık satırı (headers) bulunur, altındaki satırlar eğime duyarlı gruplanır,
 * hücreler başlık kolonlarına yatay çakışmayla atanır. Her başlık satırı yeni bir BLOK açar
 * (0245: iki "Sıra No / Top No / Kilo / Metre" bloğu).
 */
export interface TableSpec {
  key: string;
  columns: TableColumnSpec[];
  totals?: TableTotalsSpec;
  /** Başlık satırının kabulü için eşleşmesi gereken asgari kolon sayısı (varsayılan 2). */
  minHeaderMatches?: number;
  /** Satır kabulü için gereken asgari dolu hücre (varsayılan: required kolon sayısı, en az 2). */
  minCells?: number;
}

export interface TableCell {
  key: string;
  raw: string;
  value: string | null;
  rect: OcrRect;
  confidence: number;
  needsReview: boolean;
}

export interface TableRow {
  /** Blok içi 1-tabanlı satır sırası (basılı sıra no değil). */
  index: number;
  cells: Record<string, TableCell>;
  rect: OcrRect;
  needsReview: boolean;
}

/** Beyan edilen toplamlar; bulunamayan alan null. Kanonik sayı dizesi ("586" / "141.7"). */
export interface DeclaredTotals {
  count: string | null;
  kg: string | null;
  m: string | null;
  /** Toplam satırının kutusu (UI vurgusu). */
  rect?: OcrRect;
}

export interface TableBlock {
  blockNo: number;
  headerRect: OcrRect;
  rows: TableRow[];
  declared: DeclaredTotals | null;
}

export interface TableResult {
  key: string;
  blocks: TableBlock[];
  warnings: string[];
}

/** Sayfa bölgesi: tek fotoğrafta iki belge (0246). Rect'ler ORİJİNAL görüntü uzayında kalır. */
export interface PageRegion {
  regionNo: number;
  /** Bölgenin orijinal görüntüdeki kutusu. */
  rect: OcrRect;
  /** Bölgenin satırlarıyla sınırlı OcrResult; rect'ler bölge uzayına (y − rect.y) kaydırılmıştır. */
  ocr: OcrResult;
  lineCount: number;
}

/** El yazısı ızgarası: basılı sıra numarasından türetilen hücre. */
export interface GridCell {
  /** Basılı sıra numarası (1..N). */
  seqNo: number;
  /** Kolon anahtarı (ör. "metre"). */
  key: string;
  rect: OcrRect;
  /** Hücre içine düşen OCR satırları (yalnız öneri; her hücre needsReview). */
  candidates: Array<{ text: string; confidence: number | null; rect: OcrRect }>;
  needsReview: true;
}

/** El yazısı ızgarası tanımı: sıra-no başlıkları + onları izleyen değer kolonları. */
export interface GridSpec {
  /** Sıra numarası kolonunun başlık etiketleri ("Top", "TOP. NO.", "Sıra No"). */
  seqHeaders: string[];
  /** Sıra kolonunu izleyen değer kolonları, soldan sağa (bir sıra kolonu grubunda tekrar eder). */
  valueColumns: Array<{ key: string; headers: string[] }>;
  /** "TOPLAM" gibi el yazısı toplam etiketi; bulunursa ve okunamazsa TOTAL_UNVERIFIED. */
  totalsLabels?: string[];
}

export interface GridResult {
  cells: GridCell[];
  /** Sıra numarası kolonları (soldan sağa) ve her birindeki numara aralığı. */
  seqColumns: Array<{ rect: OcrRect; first: number; last: number }>;
  warnings: string[];
}

/** computeNoteTotals girdisi: blok başına beyan + satırlar (ölçüler kanonik sayı dizesi ya da null). */
export interface NoteTotalsBlockInput {
  blockNo: number;
  declared: DeclaredTotals | null;
  lines: Array<{ meters: string | null; weightKg: string | null }>;
  /** Başlıkta yazan "4 TOP" gibi beyan (yalnız UYARI sınıfı). */
  declaredTopCount?: string | null;
}

export type TotalsStatus = "MATCH" | "MISMATCH" | "UNVERIFIED";

export interface NoteTotalsBlock {
  blockNo: number;
  computed: { count: number; kg: string; m: string };
  declared: DeclaredTotals | null;
  status: TotalsStatus;
  /** Fark (beyan − hesap), kanonik dize; eşleşiyorsa "0". */
  diff: { count: number | null; kg: string | null; m: string | null };
}

export interface NoteTotalsResult {
  blocks: NoteTotalsBlock[];
  grand: { count: number; kg: string; m: string };
  /** TOTAL_MISMATCH · TOTAL_UNVERIFIED · DECLARED_TOP_COUNT_DIFF (ApiResponse.warnings'e gider). */
  warnings: string[];
}
