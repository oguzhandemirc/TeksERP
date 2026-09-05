// =============================================================================
// TeksERP - SystemLog Read Service
// =============================================================================
// SystemLog en hızlı büyüyen tablodur. Bu servisin tüm sorgu yolları:
//   - mevcut @@index([createdAt]) üzerinden çalışır (ORDER BY createdAt DESC)
//   - hiç COUNT(*) almaz (cursor pagination → hasMore boolean)
//   - liste view'da Json payload (oldData/newData) seçmez
//   - limit hard cap 100
// Detay (oldData/newData) sadece findById ile çekilir.
// =============================================================================

import prisma from "../lib/prisma";
import { resolveChangeValues, attachLabels } from "./helpers/audit-value-resolver";
import { Prisma, SystemLogCategory } from "@prisma/client";
import { decodeCursor, cursorWhere, buildNextCursor } from "../utils/cursor";
import { ACTOR_SELECT } from "./helpers/system-account.helper";

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
}

const LIST_SELECT = {
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
const RECORD_HISTORY_SELECT = {
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
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_MATCH_UUID = "00000000-0000-0000-0000-000000000000";

function readRequestId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  return REQUEST_ID_RE.test(v) ? v : NO_MATCH_UUID;
}

function parseCategories(raw: string | undefined): SystemLogCategory[] | undefined {
  if (!raw) return undefined;
  const allowed = new Set<string>(Object.values(SystemLogCategory));
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && allowed.has(s));
  return parts.length ? (parts as SystemLogCategory[]) : undefined;
}

export class SystemLogService {
  static async list(params: SystemLogListParams) {
    const rawLimit = params.limit ?? 50;
    const limit = Math.min(Math.max(1, rawLimit), 100);

    const where: Prisma.SystemLogWhereInput = {};
    if (params.userId) where.userId = params.userId;
    if (params.tableName) where.tableName = params.tableName;
    if (params.recordId) where.recordId = params.recordId;
    if (params.action) where.action = params.action;
    const reqId = readRequestId(params.requestId);
    if (reqId) where.requestId = reqId;
    const cats = parseCategories(params.category);
    if (cats) where.category = cats.length === 1 ? cats[0] : { in: cats };

    if (params.dateFrom || params.dateTo) {
      where.createdAt = {};
      if (params.dateFrom) {
        const d = new Date(params.dateFrom);
        if (!Number.isNaN(d.getTime())) where.createdAt.gte = d;
      }
      if (params.dateTo) {
        const d = new Date(params.dateTo);
        if (!Number.isNaN(d.getTime())) where.createdAt.lte = d;
      }
    }

    const cursor = decodeCursor(params.cursor);
    const finalWhere = cursor ? { AND: [where, cursorWhere(cursor)] } : where;

    const items = await prisma.systemLog.findMany({
      where: finalWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      // Kayıt-bazlı geçmişte alan-bazlı değişiklik + cihaz da döner (yukarıdaki
      // nota bak); genel listede dönmez.
      select: params.recordId ? RECORD_HISTORY_SELECT : LIST_SELECT,
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? buildNextCursor(last) : null;

    // Kayıt geçmişinde UUID değerleri ada çevrilir — sayfanın TÜMÜ tek turda
    // toplanır (tablo başına tek sorgu), satır başına lookup DEĞİL.
    // ⚠️ `page`i dar bir tipe CAST ETME — spread o tipi taşır ve dönen satırdan
    // `tableName`/`id` gibi alanlar sessizce düşer (ilk yazımda oldu, tip
    // kontrolü yakaladı). Satır tipi olduğu gibi korunur, alan alan okunur.
    const data = params.recordId
      ? await (async () => {
          const labels = await resolveChangeValues(
            page.map((r) => (r as { changes?: unknown }).changes as never),
          );
          return page.map((r) => ({
            ...r,
            changes: attachLabels((r as { changes?: unknown }).changes, labels),
          }));
        })()
      : page;

    return {
      success: true,
      data,
      pagination: { nextCursor, hasMore, limit },
    };
  }

  static async findById(id: string) {
    const record = await prisma.systemLog.findUnique({
      where: { id },
      include: { user: { select: ACTOR_SELECT } },
    });
    if (!record) return { success: false, data: null, message: "Kayıt bulunamadı" };
    const labels = await resolveChangeValues([record.changes as never]);
    return {
      success: true,
      data: { ...record, changes: attachLabels(record.changes, labels) },
    };
  }

  // ---------------------------------------------------------------------------
  // Arşiv okuma — `system_log_archives` tablosunu sorgular.
  // Arşiv UI denetim/lookback amaçlı; yüksek hacim beklenmez ama yine de
  // cursor pagination + JSON-suz LIST_SELECT + filter desteğiyle güvende.
  // SystemLogArchive'da user FK olmadığı için user join'i ayrı: userId ile
  // tekrar lookup yapıyoruz, küçük N (sayfa boyutu) olduğu için sorun değil.
  // ---------------------------------------------------------------------------

  static async listArchive(params: SystemLogListParams) {
    const rawLimit = params.limit ?? 50;
    const limit = Math.min(Math.max(1, rawLimit), 100);

    const where: Prisma.SystemLogArchiveWhereInput = {};
    if (params.userId) where.userId = params.userId;
    if (params.tableName) where.tableName = params.tableName;
    if (params.recordId) where.recordId = params.recordId;
    if (params.action) where.action = params.action;
    const reqId = readRequestId(params.requestId);
    if (reqId) where.requestId = reqId;
    const cats = parseCategories(params.category);
    if (cats) where.category = cats.length === 1 ? cats[0] : { in: cats };

    if (params.dateFrom || params.dateTo) {
      where.createdAt = {};
      if (params.dateFrom) {
        const d = new Date(params.dateFrom);
        if (!Number.isNaN(d.getTime())) where.createdAt.gte = d;
      }
      if (params.dateTo) {
        const d = new Date(params.dateTo);
        if (!Number.isNaN(d.getTime())) where.createdAt.lte = d;
      }
    }

    const cursor = decodeCursor(params.cursor);
    const finalWhere = cursor ? { AND: [where, cursorWhere(cursor)] } : where;

    const items = await prisma.systemLogArchive.findMany({
      where: finalWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        category: true,
        action: true,
        tableName: true,
        recordId: true,
        ipAddress: true,
        userId: true,
        createdAt: true,
        // Arşiv paritesi BİLİNÇLİ: `deviceId`/`changes` bir kez unutulmuştu ve
        // özellik 6 ay sonra sessizce ölecekti. Gruplama arşivde de çalışır.
        requestId: true,
      },
    });

    const hasMore = items.length > limit;
    const data = hasMore ? items.slice(0, limit) : items;

    const userIds = [
      ...new Set(data.map((d) => d.userId).filter((id): id is string => !!id)),
    ];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: ACTOR_SELECT,
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    // ⚠️ Arşiv satırı DA KALIR (karar #8 — tam iz). 2026-09-04'ten beri kimlik
    // de maskelenmez: aktör gerçek adıyla görünür.
    const enriched = data.map((d) => ({
        id: d.id,
        category: d.category,
        action: d.action,
        tableName: d.tableName,
        recordId: d.recordId,
        ipAddress: d.ipAddress,
        requestId: d.requestId,
        createdAt: d.createdAt,
        user: d.userId ? (userMap.get(d.userId) ?? null) : null,
    }));

    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? buildNextCursor(last) : null;

    return {
      success: true,
      data: enriched,
      pagination: { nextCursor, hasMore, limit },
    };
  }

  static async findArchiveById(id: string) {
    const record = await prisma.systemLogArchive.findUnique({ where: { id } });
    if (!record) return { success: false, data: null, message: "Kayıt bulunamadı" };
    const user = record.userId
      ? await prisma.user.findUnique({
          where: { id: record.userId },
          select: ACTOR_SELECT,
        })
      : null;
    const labels = await resolveChangeValues([record.changes as never]);
    return {
      success: true,
      data: { ...record, user, changes: attachLabels(record.changes, labels) },
    };
  }

  /**
   * Activity Page filter dropdown'ı — yalnız DOMAIN kategorisinde log'u olan
   * kullanıcılar. AUTH/SYSTEM event kullanıcıları Sistem Kayıtları sayfasında
   * kullanılır ve orada hardcoded değil, dinamik liste gerektirmez.
   */
  static async listActiveUsers() {
    return dropdownCache.get("users", async () => {
      // HAM SQL, ÇÜNKÜ PRISMA `distinct`'İ SQL'E İNDİRMİYOR (2026-09-05 perf turu).
      // Yakalanan SQL'de ne DISTINCT ne LIMIT vardı: 14.067 satır Node'a çekilip
      // bellekte tekilleştiriliyordu, ardından 61 id ile İKİNCİ bir sorgu atıyordu.
      // Ölçüm — ÖNCE: 2 sorgu, 8,75 ms / 2.470 buffer (Seq Scan + 14.067 satırlık
      // quicksort) + 1,66 ms, telde 14.128 satır. SONRA: 1 sorgu, 7,10 ms /
      // 2.472 buffer (HashAggregate SQL'de), telde 61 satır.
      // ⚠️ Bu DROPDOWN'dır (olay listesi DEĞİL) → satıcı hesabı burada SÜZÜLÜR.
      // ⚠️ Sıralama BİLİNÇLİ OLARAK YOK: Prisma yolu da sıra garantisi vermiyordu
      // (ORDER BY system_logs.id = rastgele UUID); ORDER BY eklemek görünen sonucu
      // değiştirirdi, bu tur davranışa dokunmuyor.
      return prisma.$queryRaw<Array<{ id: string; username: string; fullName: string }>>`
        SELECT u."id", u."username", u."fullName"
        FROM (
          SELECT DISTINCT sl."userId" AS uid
          FROM "system_logs" sl
          WHERE sl."category" = 'DOMAIN'::"SystemLogCategory" AND sl."userId" IS NOT NULL
          LIMIT 200
        ) d
        JOIN "users" u ON u."id" = d.uid
      `;
    });
  }

  /** Activity Page filter dropdown'ı — sadece DOMAIN tableName'leri. */
  static async listActiveTables() {
    return dropdownCache.get("tables", async () => {
      // Aynı gerekçe (yukarı bak): `distinct` SQL'e inmiyordu → 49.879 satır
      // Node'a çekiliyordu. Ölçüm — ÖNCE 13,20 ms / 2.467 buffer, telde 49.879
      // satır; SONRA 8,30 ms / 2.467 buffer (HashAggregate), telde 78 satır.
      const rows = await prisma.$queryRaw<Array<{ tableName: string }>>`
        SELECT DISTINCT sl."tableName"
        FROM "system_logs" sl
        WHERE sl."category" = 'DOMAIN'::"SystemLogCategory"
        LIMIT 200
      `;
      return rows.map((r) => r.tableName);
    });
  }
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

const dropdownCache = new DropdownCache();
