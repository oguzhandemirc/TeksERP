// SystemLog okuma uçlarının ortak seçim/ayrıştırma parçaları — system-log.service.ts
// max-lines tavanı için ayrıldı (B2); davranış aynıdır, tek kaynak burasıdır.
import { SystemLogCategory } from "@prisma/client";
import { ACTOR_SELECT } from "./system-account.helper";
import type { Gun } from "./system-log-islem.helper";

export const LIST_SELECT = {
  id: true,
  category: true,
  action: true,
  tableName: true,
  recordId: true,
  ipAddress: true,
  createdAt: true,
  // İşlem gruplaması genel listede DE gerekli: detay ekranı satırdan okuyup
  // "aynı işlemdekiler" sorgusunu kurar. Küçük skaler — perf kuralı 13'ün
  // (devasa JSON'ları listede çekme) kapsamına girmez.
  requestId: true,
  // AKTÖR SEÇİMİ TEK KAYNAKTAN (`ACTOR_SELECT`) — `isSystemAccount` alanını da
  // taşır; arayüz "en yetkili hesap" rozetini ondan çizer.
  user: { select: ACTOR_SELECT },
} as const;

/**
 * KAYIT-BAZLI geçmişte ek alanlar (Faz C, 2026-08-19).
 *
 * ⚠️ Genel listeye EKLENMEZ: perf kuralı 13 ("snapshot JSON'ları liste
 * sorgusunda çekme"). Ama kayıt-bazlı geçmiş SINIRLI bir listedir (tek kayıt,
 * ≤100 satır) ve `changes` zaten o ekranın TEK amacı — orada çekmemek, ekranı
 * satır başına ikinci bir isteğe (N+1) zorlardı.
 *
 * `changes` küçüktür (birkaç alanlık dizi); `snapshot` gibi devasa JSON'lar
 * diff'e zaten girmiyor ("<değişti>" yazılıyor).
 */
export const RECORD_HISTORY_SELECT = {
  ...LIST_SELECT,
  changes: true,
  deviceId: true,
} as const;

/**
 * requestId filtresi — YALNIZ geçerli UUID kabul eder.
 *
 * ⚠️ Kolon `@db.Uuid`: ham metin gönderilirse Prisma P2023 fırlatır ve uç 500
 * verir. Geçersiz değeri sessizce YOK SAYMAK da yanlış olurdu — kullanıcı hatalı
 * bir id ile filtresiz "tüm kayıtlar" görürdü. Bu yüzden eşleşmeyen bir sabite
 * çevrilir ve sonuç boş gelir. (`readIdCondition` dersinin bu uca uyarlanmış
 * hâli: uuid→400 · düz string→sessiz 0 satır · ön-süzgeçli→filtre sessizce düşer.)
 */
export const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_MATCH_UUID = "00000000-0000-0000-0000-000000000000";

export function readRequestId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  return REQUEST_ID_RE.test(v) ? v : NO_MATCH_UUID;
}

export function parseCategories(raw: string | undefined): SystemLogCategory[] | undefined {
  if (!raw) return undefined;
  const allowed = new Set<string>(Object.values(SystemLogCategory));
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && allowed.has(s));
  return parts.length ? (parts as SystemLogCategory[]) : undefined;
}

// =============================================================================
// Dropdown cache — distinct sorguları milyon satırda pahalı; 5 dk TTL ile
// neredeyse-statik listeleri (tableName'ler, log'u olan user'lar) bellekte
// tutuyoruz. Yeni bir audit log yazıldığında cache invalidate edilmiyor —
// sonraki TTL'de doğal yenilenir. Listeler nadiren değişir, gecikme önemsiz.
// =============================================================================
const CACHE_TTL_MS = 5 * 60_000;

class DropdownCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();

  async get<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > now) return hit.value as T;
    const value = await loader();
    this.store.set(key, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  }
}

export const dropdownCache = new DropdownCache();

/** Liste ucu parametreleri — servisin dosya boyu sınırı için burada (servis yeniden dışa verir). */
export interface SystemLogListParams {
  cursor?: string;
  limit?: number;
  userId?: string;
  tableName?: string;
  /**
   * TEK KAYDIN geçmişi (Faz B1, 2026-08-19) — "bu iş emrini kim ne zaman
   * değiştirmiş" sorusu bugüne kadar API'den SORULAMIYORDU; oysa DB'de
   * `@@index([tableName, recordId])` zaten vardı. `tableName` ile BİRLİKTE
   * verilmelidir, yoksa index'in ilk kolonu boş kalır ve sorgu seq scan'e döner.
   */
  recordId?: string;
  // "DOMAIN" — CUD audit (Activity Page). "AUTH" / "SYSTEM" — Sistem Kayıtları sayfası.
  // Birden fazla kategori için virgülle ayrılmış string kabul edilir.
  category?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  /**
   * TEK İSTEĞİN tüm satırları (2026-08-19) — "bu üç değişiklik aynı kaydetme
   * tuşundan mı çıktı?" sorusunun cevabı. Değer UUID'dir ve `readRequestId`
   * ile elenir: kolon `@db.Uuid` olduğu için ham metin P2023 → 500 üretirdi.
   */
  requestId?: string;
  /** B4 "Reddedilenler" süzgeci: "1" = yalnız trace status ≥ 400 (yalnız işlem görünümü). */
  reddedilen?: "0" | "1";
  /** Fabrika günü kısayolu (B2): verilirse `dateFrom/dateTo`yu ezer. */
  gun?: Gun;
  /** Satır görünümü metin araması (`SYSTEM_LOG_SEARCH`); route `q`/işlem görünümüyle birlikteliği 400'ler. */
  search?: string;
}
