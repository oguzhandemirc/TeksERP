// =============================================================================
// TeksERP - Base Service (Generic CRUD with Prisma)
// =============================================================================
// Provides reusable CRUD operations for any Prisma model.
// Master Data controllers (Item, Customer, Station, etc.) use this directly.
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import {
  parseQueryParams,
  buildWhereClause,
  buildOrderByClause,
  buildPagination,
  isCursorRequested,
  applyDateRange,
} from "../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
  decodeOffsetCursor,
  encodeOffsetCursor,
} from "../utils/cursor";
import { PaginatedResponse, ApiResponse } from "../types/api.types";
import { Request } from "express";

// Model adı → sıralanabilir (scalar/enum) alan adları. Prisma dmmf'ten lazy build
// + cache. İstemciden gelen sortBy bu kümede (veya relationSortMap'te) değilse
// createdAt'e düşülür → bilinmeyen kolon `PrismaClientValidationError` (HTTP 500)
// ve indekssiz keyfi sort engellenir. Model bulunamazsa null → guard'lamaz (geri uyum).
const modelSortFieldCache = new Map<string, Set<string> | null>();
function sortableFieldsFor(modelName: string): Set<string> | null {
  const key = modelName.toLowerCase();
  if (modelSortFieldCache.has(key)) return modelSortFieldCache.get(key) ?? null;
  const models = (
    Prisma as unknown as {
      dmmf?: { datamodel?: { models?: Array<{ name: string; fields: Array<{ name: string; kind: string }> }> } };
    }
  ).dmmf?.datamodel?.models;
  const model = models?.find((m) => m.name.toLowerCase() === key);
  const result = model
    ? new Set(
        model.fields
          .filter((f) => f.kind === "scalar" || f.kind === "enum")
          .map((f) => f.name)
      )
    : null;
  modelSortFieldCache.set(key, result);
  return result;
}

// Model adı → NULLABLE (isRequired=false) skaler alanlar. Nullable kolona göre
// cursor sıralamasında orderBy'a `nulls:'last'` verilir ve cursor where'i
// null-aware kurulur (Postgres default'u DESC'te NULLS FIRST — cursor null
// grubuna kilitlenip non-null kayıtları sessizce yutuyordu).
const modelNullableFieldCache = new Map<string, Set<string>>();
function nullableFieldsFor(modelName: string): Set<string> {
  const key = modelName.toLowerCase();
  const cached = modelNullableFieldCache.get(key);
  if (cached) return cached;
  const models = (
    Prisma as unknown as {
      dmmf?: {
        datamodel?: {
          models?: Array<{
            name: string;
            fields: Array<{ name: string; kind: string; isRequired?: boolean }>;
          }>;
        };
      };
    }
  ).dmmf?.datamodel?.models;
  const model = models?.find((m) => m.name.toLowerCase() === key);
  const result = new Set(
    (model?.fields ?? [])
      .filter((f) => (f.kind === "scalar" || f.kind === "enum") && f.isRequired === false)
      .map((f) => f.name)
  );
  modelNullableFieldCache.set(key, result);
  return result;
}

export interface CursorPaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    /** İstemci için yaklaşık toplam (count). Sayma maliyetli olabilir; opsiyonel. */
    totalEstimate?: number;
  };
}

// Prisma delegate type helper — allows us to call .findMany, .create etc. dynamically
type PrismaDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  findUnique: (args: Record<string, unknown>) => Promise<unknown | null>;
  findFirst: (args: Record<string, unknown>) => Promise<unknown | null>;
  create: (args: Record<string, unknown>) => Promise<unknown>;
  update: (args: Record<string, unknown>) => Promise<unknown>;
  delete: (args: Record<string, unknown>) => Promise<unknown>;
  count: (args: Record<string, unknown>) => Promise<number>;
};

export interface BaseServiceConfig {
  modelName: string; // Prisma model name (e.g., "item", "customer")
  tableName: string; // For SystemLog (e.g., "ITEM", "CUSTOMER")
  searchFields?: string[]; // Fields to search via ?search= param
  /** `?dateField=...&dateFrom=...&dateTo=...` için kabul edilen kolonlar. */
  dateFields?: readonly string[];
  defaultInclude?: Record<string, unknown>; // Default relations to include
  nestedCreateFields?: string[]; // Array fields to wrap in { create: [...] } for Prisma nested writes
  /**
   * Soft-delete edilmiş kayıdın yeniden eklenmesini desteklemek için kullanılır.
   * Verilirse create() önce bu alan üzerinden pasif eş arar:
   *   - Aktif eş varsa: hata fırlatır (kullanıcı zaten var olanı görmeli).
   *   - Pasif eş varsa: update ile isActive=true yapıp güncel veriyi yazar (reactivate).
   * Genelde "code" (Color, Item, Station vb.). User için "username" olabilir.
   */
  uniqueField?: string;
  /**
   * İlişki / aggregate alanlarına göre sıralama eşlemesi: sanal `sortBy` anahtarı
   * → Prisma nested orderBy üreten fonksiyon.
   * Örn: `{ customer: (o) => ({ customer: { name: o } }) }`.
   * Keyset cursor ilişki değeri sıralayamadığından, bu anahtarlarla gelen cursor
   * istekleri `findAllCursor` içinde offset-cursor'a düşer (değerler canlı-doğru,
   * denormalize kolon gerekmez). Sadece bu service'i etkiler; opt-in.
   */
  relationSortMap?: Record<
    string,
    (order: "asc" | "desc") => Record<string, unknown>
  >;
}

export class BaseService {
  protected delegate: PrismaDelegate;
  protected config: BaseServiceConfig;

  constructor(config: BaseServiceConfig) {
    this.config = config;
    // Access the Prisma delegate dynamically: prisma["item"], prisma["customer"], etc.
    this.delegate = (prisma as unknown as Record<string, PrismaDelegate>)[config.modelName];

    if (!this.delegate) {
      throw new Error(`Prisma model '${config.modelName}' not found.`);
    }
  }

  /**
   * List with dynamic filtering, sorting, pagination, and search.
   *
   * İki modda çalışır (geri uyumlu):
   *   - **Offset mode** (default): `?page=1&pageSize=50` → eski sayfalama,
   *     küçük tablolar için uygun, sayfa atlatma destekler.
   *   - **Cursor mode**: `?cursor=<token>&limit=50` (veya `?mode=cursor`) →
   *     büyük tablolar için sabit hız, "Daha Fazla Yükle" pattern.
   *
   * İstemci cursor parametresi gönderirse otomatik cursor mode'a geçer.
   */
  async findAll(req: Request): Promise<PaginatedResponse<unknown> | CursorPaginatedResponse<unknown>> {
    if (isCursorRequested(req)) {
      return this.findAllCursor(req);
    }
    return this.findAllOffset(req);
  }

  /**
   * sortBy güvenlik süzgeci — istemciden gelen sortBy yalnız modelin gerçek
   * (scalar/enum) kolonu VEYA relationSortMap anahtarıysa kullanılır, değilse
   * `createdAt`'e düşer. Bilinmeyen kolon 500'ünü ve indekssiz keyfi sortu engeller.
   * Model dmmf'te bulunamazsa guard'lamaz (geri uyum).
   */
  protected safeSortBy(requested: string): string {
    const allowed = sortableFieldsFor(this.config.modelName);
    if (!allowed) return requested;
    if (allowed.has(requested)) return requested;
    if (this.config.relationSortMap && requested in this.config.relationSortMap) return requested;
    return "createdAt";
  }

  /**
   * filter[] güvenlik süzgeci — `filter[bilinmeyenKolon]=x` Prisma'da
   * `PrismaClientValidationError` (HTTP 500) yaratır (sortBy ile aynı sınıf).
   * Modelin gerçek (scalar/enum) kolonu olmayan filtre anahtarları sessizce
   * düşürülür → UI hatasız, 500 yok. Generic CRUD yolu skaler filtre kullanır;
   * relation filtreli subclass'lar zaten kendi findAll'ını override eder.
   */
  protected safeFilters(
    filters: Record<string, string | string[]>
  ): Record<string, string | string[]> {
    const allowed = sortableFieldsFor(this.config.modelName);
    if (!allowed) return filters;
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(filters)) {
      if (allowed.has(k)) out[k] = v;
    }
    return out;
  }

  /**
   * Alt sınıfların listeye ekleyebileceği ek `where` koşulu (örn. relation
   * scope filtresi). `findAll`'ın offset+cursor yollarında üretilen where ile
   * AND'lenir — `safeFilters` skaler-kolon süzgecine takılmadan ilişki bazlı
   * kısıt eklemenin yolu. Default: yok (diğer servisler etkilenmez).
   */
  protected extraWhere(
    _req: Request
  ): Record<string, unknown> | undefined {
    return undefined;
  }

  protected async findAllOffset(req: Request): Promise<PaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    params.sortBy = this.safeSortBy(params.sortBy || "createdAt");
    params.filters = this.safeFilters(params.filters);
    const built = buildWhereClause(
      params.filters,
      this.config.searchFields,
      params.search
    );
    applyDateRange(built, params, this.config.dateFields ?? []);
    const extra = this.extraWhere(req);
    const where = extra ? { AND: [built, extra] } : built;
    const orderBy = buildOrderByClause(params.sortBy, params.sortOrder);
    const { skip, take } = buildPagination(params.page, params.pageSize);

    const [data, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy,
        skip,
        take,
        ...(this.config.defaultInclude
          ? { include: this.config.defaultInclude }
          : {}),
      }),
      this.delegate.count({ where }),
    ]);

    return {
      success: true,
      data,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.ceil(total / params.pageSize),
      },
    };
  }

  /**
   * Cursor pagination ile listele.
   * - Birincil sıralama: `params.sortBy` (default `createdAt`), `sortOrder` ile.
   *   Tie-breaker: `id` aynı yönde — sayfalar arası kararlı.
   * - filter[]/search aynı çalışır.
   * - count opsiyonel: `?withTotal=true` parametresiyle açılır (sayma maliyeti).
   * - Cursor token'ı sortBy değerini içerir; sortBy değişirse istemci cursor'ı
   *   sıfırlamalı (`useDataTable` zaten sortBy değişiminde refetch ediyor).
   */
  protected async findAllCursor(req: Request): Promise<CursorPaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    params.filters = this.safeFilters(params.filters);
    const rawLimit = parseInt(req.query.limit as string, 10) || 50;
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const wantTotal = req.query.withTotal === "true";

    const sortBy = this.safeSortBy(params.sortBy || "createdAt");
    const sortOrder: "asc" | "desc" = params.sortOrder === "asc" ? "asc" : "desc";

    const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);

    const builtWhere = buildWhereClause(
      params.filters,
      this.config.searchFields,
      params.search
    );
    applyDateRange(builtWhere, params, this.config.dateFields ?? []);
    const extra = this.extraWhere(req);
    const baseWhere: Record<string, unknown> = extra
      ? { AND: [builtWhere, extra] }
      : builtWhere;

    // İlişki / aggregate sıralaması (customer.name, branch.name, lines _count):
    // keyset imkansız (cursor değeri top-level skaler olmalı) → offset-encoded
    // cursor'a düş. Frontend nextCursor'ı opak gördüğü için pagination değişmez.
    const relationSort = this.config.relationSortMap?.[sortBy];
    if (relationSort) {
      const offset = decodeOffsetCursor(req.query.cursor as string | undefined);
      // Derin offset guard — orders gibi mütevazı tablolar için fazlasıyla yeterli.
      if (offset > 10000) {
        return {
          success: true,
          data: [],
          pagination: { nextCursor: null, hasMore: false, limit },
        };
      }
      const [items, totalEstimate] = await Promise.all([
        this.delegate.findMany({
          where: baseWhere,
          orderBy: [relationSort(sortOrder), { id: sortOrder }],
          skip: offset,
          take: limit + 1,
          ...(this.config.defaultInclude
            ? { include: this.config.defaultInclude }
            : {}),
        }),
        wantTotal
          ? this.delegate.count({ where: baseWhere })
          : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const data = hasMore ? items.slice(0, limit) : items;
      const nextCursor = hasMore ? encodeOffsetCursor(offset + limit) : null;
      return {
        success: true,
        data,
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    // Nullable sıralama kolonu: nulls her iki yönde de EN SONA (cursor where'i
    // ile tutarlı) — yoksa DESC'te Postgres NULLS FIRST cursor'ı null grubuna
    // kilitler ve non-null kayıtların tamamı sayfalamadan düşer.
    const sortNullable = nullableFieldsFor(this.config.modelName).has(sortBy);
    const orderByPrimary = sortNullable
      ? { [sortBy]: { sort: sortOrder, nulls: "last" as const } }
      : { [sortBy]: sortOrder };

    const where = cursor
      ? { AND: [baseWhere, dynamicCursorWhere(cursor, sortBy, sortOrder, sortNullable)] }
      : baseWhere;

    // limit + 1 çekiyoruz; fazla 1 varsa hasMore=true
    const [items, totalEstimate] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy: [orderByPrimary, { id: sortOrder }],
        take: limit + 1,
        ...(this.config.defaultInclude
          ? { include: this.config.defaultInclude }
          : {}),
      }),
      wantTotal ? this.delegate.count({ where: baseWhere }) : Promise.resolve(undefined),
    ]);

    const hasMore = items.length > limit;
    const data = hasMore ? items.slice(0, limit) : items;
    const last = data[data.length - 1] as Record<string, unknown> | undefined;
    const nextCursor = hasMore ? buildNextDynamicCursor(last, sortBy) : null;

    return {
      success: true,
      data,
      pagination: {
        nextCursor,
        hasMore,
        limit,
        ...(totalEstimate !== undefined ? { totalEstimate } : {}),
      },
    };
  }

  /**
   * Find single record by ID.
   */
  async findById(id: string): Promise<ApiResponse<unknown>> {
    const record = await this.delegate.findUnique({
      where: { id },
      ...(this.config.defaultInclude
        ? { include: this.config.defaultInclude }
        : {}),
    });

    if (!record) {
      return { success: false, data: null, message: "Kayıt bulunamadı" };
    }

    return { success: true, data: record };
  }

  /**
   * Create a new record.
   *
   * uniqueField config'i verilmişse, aynı değere sahip pasif kayıt varsa
   * yeni kayıt yerine reactivate eder (eski ID + tarihçe korunur).
   * Aynı değere sahip aktif kayıt varsa AppError fırlatır.
   */
  /**
   * İstemci gövdesini modelin GERÇEK yazılabilir kolonlarına süzer (M-4):
   * - yalnız scalar/enum alanlar geçer (dmmf); ilişki adıyla gönderilen nested
   *   write operatörleri (`{"rolls":{"deleteMany":...}}` gibi) ATILIR — generic
   *   CRUD üzerinden fiziksel silme / ilişki manipülasyonu / audit'siz çocuk
   *   mutasyonu kapanır (13 bare-BaseController route'u tek noktadan korunur);
   * - `id`/`createdAt`/`updatedAt` sistem alanları atılır;
   * - `config.nestedCreateFields` anahtarları (bilinçli nested create) korunur.
   * Model dmmf'te bulunamazsa süzme yapılmaz (geri uyum — safeSortBy ile aynı).
   */
  protected sanitizeWriteData(data: Record<string, unknown>): Record<string, unknown> {
    const allowed = sortableFieldsFor(this.config.modelName);
    if (!allowed) return data;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === "id" || key === "createdAt" || key === "updatedAt") continue;
      if (allowed.has(key) || this.config.nestedCreateFields?.includes(key)) {
        out[key] = value;
      }
    }
    return out;
  }

  async create(
    rawData: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const data = this.sanitizeWriteData(rawData);
    if (this.config.uniqueField) {
      const key = this.config.uniqueField;
      const incomingValue = data[key];
      if (typeof incomingValue === "string" && incomingValue.length > 0) {
        const existing = (await this.delegate.findFirst({
          where: { [key]: incomingValue },
        })) as Record<string, unknown> | null;

        if (existing) {
          if (existing.isActive === true) {
            throw AppError.badRequest(
              `Bu ${key} ile aktif kayıt zaten var`,
            );
          }
          return this.reactivate(existing.id as string, data, userId);
        }
      }
    }

    // Transform nested array fields to Prisma's { create: [...] } format
    const prismaData = { ...data };
    if (this.config.nestedCreateFields) {
      for (const field of this.config.nestedCreateFields) {
        if (Array.isArray(prismaData[field])) {
          prismaData[field] = { create: prismaData[field] };
        }
      }
    }

    const record = await this.delegate.create({
      data: prismaData,
      ...(this.config.defaultInclude ? { include: this.config.defaultInclude } : {}),
    }) as Record<string, unknown>;

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: this.config.tableName,
      recordId: record.id as string,
      newData: data,
    });

    return { success: true, data: record, message: "Kayıt oluşturuldu" };
  }

  /**
   * Pasif kaydı reactive eder + gelen veriyi günceller.
   * create() içinden çağrılır; nested create alanları desteklenmez (M:N replace
   * gibi karmaşık ihtiyaçlarda servis kendi override'ını yazsın).
   */
  protected async reactivate(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const oldRecord = await this.delegate.findUnique({ where: { id } });

    const updateData: Record<string, unknown> = { ...data, isActive: true };
    if (this.config.nestedCreateFields) {
      for (const field of this.config.nestedCreateFields) {
        // Reactivate sırasında nested array'leri sessizce atla — servis
        // override etmeden M:N replace yapmak güvenli değil.
        delete updateData[field];
      }
    }

    const updated = await this.delegate.update({
      where: { id },
      data: updateData,
      ...(this.config.defaultInclude
        ? { include: this.config.defaultInclude }
        : {}),
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: oldRecord as Record<string, unknown> | null,
      newData: updateData,
    });

    return {
      success: true,
      data: updated,
      message: "Pasif kayıt yeniden aktive edildi",
    };
  }

  /**
   * Update an existing record.
   */
  async update(
    id: string,
    rawData: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const data = this.sanitizeWriteData(rawData);
    // Fetch old data for audit
    const oldRecord = await this.delegate.findUnique({ where: { id } });

    const updated = await this.delegate.update({
      where: { id },
      data,
      ...(this.config.defaultInclude
        ? { include: this.config.defaultInclude }
        : {}),
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: oldRecord as Record<string, unknown> | null,
      newData: data,
    });

    return { success: true, data: updated, message: "Kayıt güncellendi" };
  }

  /**
   * Soft-delete: set isActive = false (no physical DELETE).
   */
  async softDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const oldRecord = await this.delegate.findUnique({ where: { id } });

    const updated = await this.delegate.update({
      where: { id },
      data: { isActive: false },
      ...(this.config.defaultInclude
        ? { include: this.config.defaultInclude }
        : {}),
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: oldRecord as Record<string, unknown> | null,
      newData: { isActive: false },
    });

    return { success: true, data: updated, message: "Kayıt pasife alındı" };
  }

  /**
   * Hard-delete: physically remove the record from the database.
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const oldRecord = await this.delegate.findUnique({ where: { id } });

    if (!oldRecord) {
      return { success: false, data: null, message: "Kayıt bulunamadı" };
    }

    await this.delegate.delete({ where: { id } });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: oldRecord as Record<string, unknown> | null,
      newData: null,
    });

    return { success: true, data: oldRecord, message: "Kayıt kalıcı olarak silindi" };
  }
}
