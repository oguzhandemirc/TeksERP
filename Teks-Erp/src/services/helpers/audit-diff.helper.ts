// =============================================================================
// ALAN-BAZLI DEĞİŞİKLİK (diff) — "tam olarak ne değişti?" (Faz B2, 2026-08-19)
// =============================================================================
// Tasarım: docs/design/AUDIT-DERINLESTIRME-TASARIM.md
//
// SORUN (ölçüldü): UPDATE audit kayıtlarının yalnız %39'unda eski değer vardı;
// parti/sevkiyat/renk-eşlemesinde %0. `newData` ad-hoc'tu — her çağrı noktası
// aklına geleni yazıyordu (iş emrinde 20 farklı alan adı görüldü), bu yüzden
// "hangi alanlar değişti" sorusu sorgulanamıyordu.
//
// ⚠️ SAP'TAN BİLİNÇLİ SAPMA: `CDPOS` değişen HER ALAN için ayrı satır yazar.
// Biz tek satırda `changes` dizisi tutuyoruz. Gerekçe: CDPOS'un ayrı tablo
// olması 1970'lerin ilişkisel kısıtıdır; PostgreSQL `jsonb` bunu gerektirmez.
// Ayrı tablo yazma hacmini 2-3× artırırdı (bugün 3.013 kayıt/gün → 6 ayda
// ~540 bin satır; alan başına satır bunu 1,5 milyona çıkarır) ve her okumaya
// join eklerdi. Alan-bazlı sorgu gerekirse `jsonb_path_ops` GIN index'i yeter.
// =============================================================================

/** Tek alanın değişimi. `old`/`new` JSON-serileştirilebilir olmalıdır. */
export interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
}

/**
 * Diff'e ASLA girmeyecek alanlar.
 *
 * İki ayrı gerekçe var ve karıştırılmamalı:
 *   · GİZLİ (`passwordHash`, `pin`, token): audit denetim kaydıdır, sır deposu
 *     değil. Değer yazılmaz — yalnız "değişti" bilgisi kalır.
 *   · GÜRÜLTÜ (`updatedAt`, künye kolonları): her update'te değişir, hiçbir şey
 *     anlatmaz ve gerçek değişikliği gözden kaçırtır.
 *
 * ⚠️⚠️ MASKELEME KAPSAMI YANILTICIDIR: bu küme YALNIZ `changes` kolonuna
 * uygulanır. `AuditService.log`un `oldData`/`newData`sı ve `logEvent`in
 * `payload`ı SystemLog'a HAM yazılır (`audit.service.ts`) — yani bir alanı bu
 * listeye eklemek "artık sır sızmaz" DEMEK DEĞİLDİR. Sır taşıyan her çağıranın
 * kendi yükü temiz olmak ZORUNDA (emsal: `setQuickPin` audit'e ham PIN değil
 * `rotated: boolean` yazar).
 *
 * ⚠️ EŞLEŞME TAM ADDIR (`Set.has`) — "…Hash"/"…Secret" son ekleri otomatik
 * yakalanmaz; yeni sır alanı ADIYLA eklenir.
 */
const SECRET_FIELDS = new Set([
  "passwordHash", "password", "pin", "pinHash", "quickPin",
  "cardToken", "token", "refreshToken", "secret",
  // TOTP sırrı HMAC anahtarıdır — düz saklanır, diff'e girmemeli.
  "totpSecret",
  // P3 (ayar şifresi) önden eklendi: alan doğduğu gün maskeli doğsun.
  "settingsPasswordHash",
  // Süperadmin PIN'inin herhangi bir yüke sızması durumunda ikinci hat.
  "superadminPin",
]);
const NOISE_FIELDS = new Set([
  "updatedAt", "createdAt", "updatedById", "createdById", "id",
]);

/**
 * DEĞERİ yazılmayan ama "değişti" denen alanlar — devasa JSON'lar.
 *
 * `snapshot` gibi bir alanın eski+yeni hâlini audit'e gömmek satırı yüzlerce KB
 * yapar ve tabloyu şişirir. Denetim için "snapshot değişti" bilgisi yeterli;
 * içeriğin kendisi zaten kaynağında duruyor (donmuş belge kaydı).
 */
const OPAQUE_FIELDS = new Set(["snapshot", "config", "parameters", "metadata", "elements"]);

const MASK = "***";
const OPAQUE = "<değişti>";

/** İki değer audit açısından AYNI mı? Tarih/Decimal/JSON farkını doğru görür. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  // Prisma Decimal ve Date'i düz `===` ayırt edemez → metin karşılaştırması.
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as string).getTime() === new Date(b as string).getTime();
  }
  if (typeof a === "object" || typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  // Decimal ↔ number ↔ string ("150" vs 150 vs Decimal(150)) aynı sayılmalı;
  // aksi halde hiç değişmemiş alan her update'te "değişti" görünür.
  return String(a) === String(b);
}

function serialize(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    // Prisma Decimal `toString` taşır; düz nesne JSON'a serileşir.
    const o = v as { toString?: () => string };
    if (typeof o.toString === "function" && o.constructor?.name === "Decimal") return o.toString();
    return v;
  }
  return v;
}

/**
 * `before` ile `after` arasındaki alan farklarını çıkarır.
 *
 * ⚠️ YALNIZ `after`da BULUNAN alanlar karşılaştırılır — çağıranın gönderdiği
 * alanlar. `before`daki fazladan alanları "silindi" saymak yanlış olurdu:
 * kısmi update'te (`PATCH`) gönderilmeyen alan DEĞİŞMEMİŞTİR.
 *
 * ⚠️ BOŞ DİZİ ANLAMLIDIR: çağıran "hiçbir şey değişmedi" sonucunu görüp audit
 * satırı YAZMAMALIDIR. Ölçüldü: `LABEL_TEMPLATE` 4.813 kayıtla en çok loglanan
 * 4. tabloydu ve çoğu boş güncellemeydi.
 */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): FieldChange[] {
  if (!before || !after) return [];
  const out: FieldChange[] = [];
  for (const [field, next] of Object.entries(after)) {
    if (NOISE_FIELDS.has(field)) continue;
    if (next === undefined) continue; // Prisma'da "dokunma" demek
    const prev = (before as Record<string, unknown>)[field];
    if (sameValue(prev, next)) continue;

    if (SECRET_FIELDS.has(field)) {
      out.push({ field, old: MASK, new: MASK });
      continue;
    }
    if (OPAQUE_FIELDS.has(field)) {
      out.push({ field, old: OPAQUE, new: OPAQUE });
      continue;
    }
    out.push({ field, old: serialize(prev), new: serialize(next) });
  }
  return out;
}

/** Gizli/opak alan listelerini dışarıya açar — bekçi bunları denetler. */
export const AUDIT_DIFF_SECRET_FIELDS = SECRET_FIELDS;
export const AUDIT_DIFF_OPAQUE_FIELDS = OPAQUE_FIELDS;

/**
 * `diffFields`in ORTAK-ANAHTAR varyantı — elle yazılmış audit yükleri için.
 *
 * Neden ayrı fonksiyon: `diffFields` `after`ın TÜM anahtarlarını gezer, çünkü
 * onun çağıranı (BaseService) `before`a tam kaydı verir. Elle yazılmış yüklerde
 * durum tersidir — `before` küçük bir seçkidir (`{targetColorId}`), `after` ise
 * olay anlatısı taşır (`event`, `reason`, `warnings`, `colorName`). O yükte
 * `diffFields` "event: yok → TARGET_COLOR_CHANGED" gibi sahte satırlar üretir
 * ve gerçek değişikliği gürültüye gömer.
 *
 * Kural: **yalnız `before`da DA bulunan alan** karşılaştırılır. Çağıranın eski
 * değerini yazdığı alan, kastettiği alandır; anlatı alanları ham `newData`
 * bloğunda okunmaya devam eder.
 */
export function diffCommonFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): FieldChange[] {
  if (!before || !after) return [];
  const common: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) {
    if (Object.prototype.hasOwnProperty.call(before, k)) common[k] = v;
  }
  return diffFields(before, common);
}
