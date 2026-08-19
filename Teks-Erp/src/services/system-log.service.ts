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
import { Prisma, SystemLogCategory } from "@prisma/client";
import { decodeCursor, cursorWhere, buildNextCursor } from "../utils/cursor";

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
}

const LIST_SELECT = {
  id: true,
  category: true,
  action: true,
  tableName: true,
  recordId: true,
  ipAddress: true,
  createdAt: true,
  user: { select: { id: true, username: true, fullName: true } },
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
    const data = hasMore ? items.slice(0, limit) : items;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? buildNextCursor(last) : null;

    return {
      success: true,
      data,
      pagination: { nextCursor, hasMore, limit },
    };
  }

  static async findById(id: string) {
    const record = await prisma.systemLog.findUnique({
      where: { id },
      include: { user: { select: { id: true, username: true, fullName: true } } },
    });
    if (!record) return { success: false, data: null, message: "Kayıt bulunamadı" };
    return { success: true, data: record };
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
          select: { id: true, username: true, fullName: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const enriched = data.map((d) => ({
      id: d.id,
      category: d.category,
      action: d.action,
      tableName: d.tableName,
      recordId: d.recordId,
      ipAddress: d.ipAddress,
      createdAt: d.createdAt,
      user: d.userId ? userMap.get(d.userId) ?? null : null,
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
          select: { id: true, username: true, fullName: true },
        })
      : null;
    return { success: true, data: { ...record, user } };
  }

  /**
   * Activity Page filter dropdown'ı — yalnız DOMAIN kategorisinde log'u olan
   * kullanıcılar. AUTH/SYSTEM event kullanıcıları Sistem Kayıtları sayfasında
   * kullanılır ve orada hardcoded değil, dinamik liste gerektirmez.
   */
  static async listActiveUsers() {
    return dropdownCache.get("users", async () => {
      const rows = await prisma.systemLog.findMany({
        where: { userId: { not: null }, category: "DOMAIN" },
        distinct: ["userId"],
        select: { user: { select: { id: true, username: true, fullName: true } } },
        take: 200,
      });
      return rows
        .map((r) => r.user)
        .filter((u): u is { id: string; username: string; fullName: string } => !!u);
    });
  }

  /** Activity Page filter dropdown'ı — sadece DOMAIN tableName'leri. */
  static async listActiveTables() {
    return dropdownCache.get("tables", async () => {
      const rows = await prisma.systemLog.findMany({
        where: { category: "DOMAIN" },
        distinct: ["tableName"],
        select: { tableName: true },
        take: 200,
      });
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
