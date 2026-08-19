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
import { foldNameForCompare, normalizeDisplayName } from "./helpers/name-normalize.helper";
import { dailyCodePrefix, nextDailySeq, foldCodeForCompare } from "../utils/code-format";
import { withBarcodeRetry } from "../utils/barcode-retry";

// =============================================================================
// KAYIT KÜNYESİ — kim oluşturdu / kim son değiştirdi (2026-08-19)
// =============================================================================
// Tasarım: docs/design/KAYIT-KUNYESI-TASARIM.md
//
// Kaydın kimliğine ait KALICI gerçek KOLONDA durur; audit'ten okunmaz çünkü
// audit 6 ayda arşivlenir (CLAUDE.md kuralı; `record-info` ucu tam bu yüzden
// 6 aydan eski kayıtta boş dönüyordu).
//
// ⚠️ `sanitizeWriteData`'nın İÇİNE KOYULMADI: o metot DMMF çözülemezse ham
// veriyi ERKEN DÖNDÜRÜYOR — künye o kaçış yolunda sessizce atlanırdı. Aynı
// gerekçe ad normalizasyonunda da tartışıldı ve orada da dışarıda bırakıldı.
//
// ⚠️ KAPSAM LİSTESİ ŞART, "hepsine yaz" DEĞİL: kolonu olmayan modele yazmak
// Prisma'da çalışma-zamanı hatasıdır. Liste `scripts/test_record_provenance.ts`
// tarafından ŞEMAYA karşı doğrulanır — model kolonu alırsa buraya da eklenmeli.
// =============================================================================

/** Künye kolonu TAŞIYAN Prisma modelleri (BaseService yolundan yazılanlar). */
const PROVENANCE_MODELS = new Set([
  "color", "customer", "customerBranch", "defectType", "fabricProperty", "item",
  "machine", "order", "peripheralDevice", "productRecipe", "qualityGrade",
  "returnReason", "route", "station",
]);

export function withActor(
  data: Record<string, unknown>,
  userId: string | undefined,
  mode: "CREATE" | "UPDATE",
  modelName: string,
): Record<string, unknown> {
  if (!userId || !PROVENANCE_MODELS.has(modelName)) return data;
  // CREATE'te ikisi de yazılır: "hiç değiştirilmemiş kayıt" için de son
  // değiştiren = oluşturan olmalı, yoksa arayüz boş alan gösterir.
  if (mode === "CREATE") return { ...data, createdById: userId, updatedById: userId };
  return { ...data, updatedById: userId };
}


import {
  decideCodeUniqueness,
  assertCodeAvailable,
  type CodeCandidate,
  type CodeUniquenessTexts,
} from "./helpers/code-unique.helper";

// Model adı → sıralanabilir (scalar/enum) alan adları. Prisma dmmf'ten lazy build
// + cache. İstemciden gelen sortBy bu kümede (veya relationSortMap'te) değilse
// createdAt'e düşülür → bilinmeyen kolon `PrismaClientValidationError` (HTTP 500) engellenir.
// F45 NOT: allowlist modelin TÜM scalar/enum kolonları — indekssiz kolona (description/notes)
// sort İZİN VERİLİR; gerçek indeks kısıtı için config'e sortableFields eklenmeli.
// Model bulunamazsa null → guard'lamaz (geri uyum).
//
// ⚠️ DB-ÜRETİMLİ (GENERATED) KOLONLAR ÜÇ YÜZEYDEN DE DÜŞÜRÜLÜR (2026-08-19).
// Arama katlaması `<kolon>Fold` gölgeleri getirdi (migration 20260819060000);
// bunlar `GENERATED ALWAYS AS (tr_fold(...)) STORED` ve şemada sıradan bir
// `String?` gibi görünüyor. Süzülmeselerdi üç ayrı arıza doğardı:
//   1) YAZMA — istemci `{"nameFold":"x"}` gönderirse PostgreSQL isteği reddeder
//      ("cannot insert a non-DEFAULT value into column"), yani 13 bare-CRUD
//      route'unda basit bir alan adıyla 500 üretilebilirdi.
//   2) SIRALAMA — `sortBy=nameFold` katlanmış anahtara göre sıralardı ve Türkçe
//      sırayı bozardı ("Çanakkale" bütün C'lerin önüne düşer). Sıralama Türkçe
//      collation'ın işi (`tr_sort`), katlamanın değil.
//   3) FİLTRE — F30 oracle yüzeyini bir kolon daha genişletirdi.
// TESPİT AD SÖZLEŞMESİYLE, çünkü başka yolu yok: Prisma 7'nin RUNTIME DMMF'i
// minimaldir — alan başına yalnız `{name, kind, type}` taşır (ölçüldü 2026-08-19);
// `default`/`isGenerated` orada YOKTUR, yani "bu kolonu DB üretiyor" bilgisi
// çalışma anında okunamaz. Sözleşme bu yüzden DB tarafında İKİ YÖNLÜ kilitlendi
// (`scripts/test_db_invariants.ts` §9): her GENERATED kolon `Fold` ile biter VE
// `Fold` ile biten her kolon GENERATED'dır. İkisinden biri bozulursa test düşer;
// yani buradaki basit ek, gevşek değil bağlıdır.
const GENERATED_FIELD_SUFFIX = "Fold";
const modelSortFieldCache = new Map<string, Set<string> | null>();
type DmmfField = { name: string; kind: string };
function isDbGenerated(field: DmmfField): boolean {
  return field.name.endsWith(GENERATED_FIELD_SUFFIX);
}
function sortableFieldsFor(modelName: string): Set<string> | null {
  const key = modelName.toLowerCase();
  if (modelSortFieldCache.has(key)) return modelSortFieldCache.get(key) ?? null;
  const models = (
    Prisma as unknown as {
      dmmf?: { datamodel?: { models?: Array<{ name: string; fields: DmmfField[] }> } };
    }
  ).dmmf?.datamodel?.models;
  const model = models?.find((m) => m.name.toLowerCase() === key);
  const result = model
    ? new Set(
        model.fields
          .filter((f) => (f.kind === "scalar" || f.kind === "enum") && !isDbGenerated(f))
          .map((f) => f.name)
      )
    : null;
  modelSortFieldCache.set(key, result);
  return result;
}

// F29: Boot-time guard — sanitizeWriteData/safeSortBy/safeFilters süzgeçleri
// Prisma.dmmf'e (runtime, deprecated yüzey) bağlı. Bir Prisma major upgrade'inde
// bu yüzey kalkarsa TÜM modeller null döner ve üç guard da SESSİZCE fail-open olur
// (13 bare-BaseController route'un mass-assignment koruması düşer). Fail-CLOSED:
// çekirdek model çözülemezse sunucuyu başlatma (server.ts app.listen'den ÖNCE çağırır).
export function assertBaseServiceGuards(): void {
  const probe = sortableFieldsFor("Item");
  if (!probe || probe.size === 0) {
    throw new Error(
      "[base.service] KRİTİK: Prisma DMMF çözülemedi — sanitizeWriteData/safeSortBy " +
        "guardları fail-open olur. Sunucu başlatılmıyor. (Prisma sürüm/generate uyumsuzluğu?)",
    );
  }
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
  /**
   * Yalnız KOD BİÇİMLİ terimde (rakam içeren) aranan, Türkçe varyanta
   * açılmayan alanlar — tipik olarak derin ilişkilerin ucundaki belge
   * numaraları. Gerekçe: `buildCodeSearch` (query-parser).
   */
  codeSearchFields?: string[];
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
   * Otomatik kod üretimi (backend-authoritative): verilirse create() `field`
   * (default "code") alanını `PREFIX + GGAAYY + NNNN` günlük sıralı üretir ve
   * İSTEMCİDEN GELEN kodu YOK SAYAR — customer/fabricProperty deseniyle birebir
   * (tüm master-data aynı formatı alsın). Eşzamanlı iki create aynı sıra no'yu
   * okuyup INSERT'te `@unique` çakışırsa (P2002) withBarcodeRetry taze no ile
   * yeniden dener. autoCode verildiğinde `uniqueField` reactivate yolu KULLANILMAZ
   * (yeni kod her zaman taze) — ama `uniqueField` yine ad-mükerrer 409 mesajını
   * mevcut kaydın koduyla zenginleştirir, o yüzden birlikte set edilebilir.
   */
  autoCode?: {
    /** Kod öneki, örn. "RNK". Ardına GGAAYY (gün-ay-yıl) + sıra eklenir. */
    prefix: string;
    /** Kodun yazılacağı kolon (default "code"). */
    field?: string;
    /** Günlük sıra hane sayısı (default 4 → 9999/gün). */
    digits?: number;
  };
  /**
   * Ad-mükerrer koruması: verilirse create/update bu kolonda Türkçe-duyarsız
   * (trim + çoklu-boşluk-tekle + tr-BÜYÜK katlama) eş arar; aktif eş → 409,
   * pasif eş → "aktifleştirin" 409. DB unique kısıtı bilinçli YOK — canlı
   * veride tarihsel mükerrerler olabilir; migration patlatmak yerine yalnız
   * YENİ mükerrer engellenir. Update ad gerçekten değişmedikçe kontrol etmez —
   * tarihsel mükerrer kayıtlar düzenlenebilir kalır. Modelde `isActive` kolonu
   * varsayılır (tüm master-data tablolarında var).
   */
  duplicateNameField?: string;
  /**
   * Ad tekilliğinin kapsam kolonu (örn. Machine için "stationId" — ad yalnız
   * aynı istasyon içinde tekil olmalı). Update'te payload'da yoksa mevcut
   * kayıttan okunur.
   */
  duplicateNameScopeField?: string;
  /**
   * Ad-mükerrer aday sorgusuna eklenen sabit where (örn. PeripheralDevice
   * için `{ deletedAt: null }` — hard-delete tombstone'ları aday sayılmasın;
   * tombstone aktifleştirilemediğinden adı süresiz bloke ederdi).
   */
  duplicateNameWhere?: Record<string, unknown>;
  /** 409 mesajlarında görünen Türkçe varlık adı (örn. "istasyon"); yoksa "kayıt". */
  entityLabel?: string;
  /**
   * BÜYÜK harfe normalize edilecek EK metin alanları (2026-08-19 saha talebi).
   *
   * `duplicateNameField` OTOMATİK dahildir — ayrıca yazmaya gerek yok. Sebep:
   * depolanan biçim ile mükerrer-karşılaştırma anahtarı ayrışırsa kontrol kendi
   * yazdığı kaydı bulamaz. Bu alan yalnız ADA EK metin kolonları içindir
   * (örn. ikinci bir unvan alanı).
   */
  upperCaseFields?: string[];
  /**
   * Normalizasyondan MUAF alanlar — `duplicateNameField` büyük harfe
   * çevrilmemesi gereken bir kolonsa (örn. serbest metin/açıklama tekilliği).
   * Bugün kullanan yok; kapı bilinçli açık bırakıldı, muaf yazan gerekçesini
   * config'in yanına yazmalı.
   */
  preserveCaseFields?: string[];
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
   * `createdAt`'e düşer. Bilinmeyen kolon 500'ünü engeller (indekssiz kolona sort İZİN VERİLİR — allowlist=tüm scalar/enum).
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
   *
   * F30 GÜVENLİK NOTU: allowlist = modelin TÜM skaler/enum kolonları (UI'ın
   * filtrelenebilir sunduğu alt küme DEĞİL). Response select'inde gizlenmiş bir
   * kolon bile `filter[kolon]=x` ile eşitlik-probe edilebilir (var/yok oracle).
   * Bugün risk yok (BaseService modelleri sır kolonu içermez); DÜZ saklanan sır
   * kolonlu (quickPin/cardToken emsali) bir modeli BaseService'e BAĞLAMA —
   * enumerasyon oracle'ı doğar. Gerekirse config'e `filterableFields` allowlist'i ekle.
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
      params.search,
      this.config.codeSearchFields
    );
    applyDateRange(built, params, this.config.dateFields ?? []);
    const extra = this.extraWhere(req);
    const where = extra ? { AND: [built, extra] } : built;
    // F40: offset modunda id tie-breaker — eşit-değerli sortBy'da (ör. aynı isim)
    // sayfalar arası mükerrer/kayıp satırı önler (cursor yolu 347 ile parite).
    const orderBy =
      params.sortBy === "id"
        ? buildOrderByClause(params.sortBy, params.sortOrder)
        : [
            buildOrderByClause(params.sortBy, params.sortOrder),
            { id: params.sortOrder },
          ];
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
      params.search,
      this.config.codeSearchFields
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
        // F47: sessiz boş dönüş yerine net 400 (buildPagination MAX_OFFSET seddiyle
        // tutarlı) — istemci "veri yok" değil "filtre daralt" mesajı görsün.
        throw AppError.badRequest(
          `Sayfa derinliği aşıldı (offset=${offset}). Lütfen filtre daraltın veya tarih aralığı kullanın.`,
        );
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
    // F44: Express 5'te Content-Type application/json değilse req.body undefined
    // kalır; Object.entries(undefined) → TypeError → 500 + audit gürültüsü.
    // İstemci hatası 5xx'e düşmesin diye erken net 400 ver.
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw AppError.badRequest("Geçersiz istek gövdesi");
    }
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

  /**
   * AD ALANLARINI BÜYÜK HARFE ÇEVİR — depolamanın tek boğazı (2026-08-19).
   *
   * `create`/`update`'te `sanitizeWriteData`'dan HEMEN SONRA koşar, yani
   * mükerrer kontrolü de kod üretimi de normalize edilmiş değeri görür.
   * `sanitizeWriteData`'nın İÇİNE konmadı: o metot DMMF çözülemezse ham veriyi
   * erken döndürüyor (`if (!allowed) return data`) — normalizasyon o kaçış
   * yolunda sessizce atlanırdı.
   *
   * Yalnız string alanlara dokunur; null/undefined/sayı olduğu gibi geçer
   * (alanı temizleme niyeti "" olarak gelir ve "" olarak kalır).
   */
  protected normalizeNameFields(data: Record<string, unknown>): Record<string, unknown> {
    const exempt = new Set(this.config.preserveCaseFields ?? []);
    const fields = new Set<string>();
    if (this.config.duplicateNameField) fields.add(this.config.duplicateNameField);
    for (const f of this.config.upperCaseFields ?? []) fields.add(f);
    for (const f of fields) {
      if (exempt.has(f)) continue;
      const v = data[f];
      if (typeof v === "string" && v.length > 0) data[f] = normalizeDisplayName(v);
    }
    return data;
  }

  /**
   * `duplicateNameField` kolonunda Türkçe-duyarsız ad eşi arar (bkz. config
   * yorumu). Master-data tabloları küçük olduğundan adaylar tek select ile
   * çekilip JS'te tr-TR katlamayla karşılaştırılır — PG lower() İ/ı harflerinde
   * hatalı olduğundan `mode:'insensitive'` bilinçli kullanılmaz. Custom
   * create/update yazan alt sınıflar (super.* çağırmayan yollar) bu metodu
   * kendileri çağırır.
   */
  protected async assertNameNotDuplicate(
    data: Record<string, unknown>,
    excludeId?: string,
  ): Promise<void> {
    const field = this.config.duplicateNameField;
    if (!field) return;
    const raw = data[field];
    if (typeof raw !== "string" || raw.trim().length === 0) return;
    const target = foldNameForCompare(raw);
    const label = this.config.entityLabel ?? "kayıt";

    // Kapsamlı tekillik (örn. Machine.stationId): payload'da yoksa mevcut kayıttan.
    let scopeWhere: Record<string, unknown> = {};
    const scopeField = this.config.duplicateNameScopeField;
    if (scopeField) {
      let scopeVal = data[scopeField];
      if (scopeVal === undefined && excludeId) {
        const current = (await this.delegate.findUnique({
          where: { id: excludeId },
        })) as Record<string, unknown> | null;
        scopeVal = current?.[scopeField];
      }
      if (scopeVal === undefined || scopeVal === null) return; // kapsam belirsiz — zorunlu alan validasyonu ayrıca yakalar
      scopeWhere = { [scopeField]: scopeVal };
    }

    const codeField = this.config.uniqueField;
    const candidates = (await this.delegate.findMany({
      where: {
        ...(this.config.duplicateNameWhere ?? {}),
        ...scopeWhere,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true,
        isActive: true,
        [field]: true,
        ...(codeField ? { [codeField]: true } : {}),
      },
    })) as Record<string, unknown>[];

    const hit = candidates.find(
      (c) => typeof c[field] === "string" && foldNameForCompare(c[field] as string) === target,
    );
    if (!hit) return;
    const codePart =
      codeField && typeof hit[codeField] === "string"
        ? ` (${codeField === "code" ? "kod" : codeField}: ${hit[codeField]})`
        : "";
    throw AppError.conflict(
      hit.isActive === true
        ? `'${raw.trim()}' adında bir ${label} zaten var${codePart}. Aynı ${label} ikinci kez eklenemez.`
        : `'${raw.trim()}' adında PASİF bir ${label} zaten var${codePart}. Yenisini eklemek yerine mevcut kaydı aktifleştirin.`,
    );
  }

  /**
   * Kod-tekilliği 409 metinleri. `activeExactLead` BİLİNÇLİ olarak eski cümledir
   * (`Bu code ile aktif kayıt zaten var`) — `scripts/test_recipe.ts` ve route
   * Swagger'ları o metne bakıyor; yeni bilgi cümlenin ARKASINA eklenir.
   */
  private codeTexts(key: string): CodeUniquenessTexts {
    return {
      activeExactLead: `Bu ${key} ile aktif kayıt zaten var`,
      entityLabel: this.config.entityLabel ?? "kayıt",
    };
  }

  /**
   * Kod çakışması adayları — TEK select, katlama JS'te (`assertNameNotDuplicate`
   * ile aynı gerekçe: PG `lower()` İ/ı'da hatalı, `mode:'insensitive'` ILIKE
   * üretir ve `_` joker olur). Master-data tabloları küçüktür.
   *
   * `duplicateNameWhere` aday süzgeci KOD tarafında da uygulanır — PeripheralDevice'ta
   * `{ deletedAt: null }` demektir: hard-delete tombstone'ları (`DEL-<t36>-<eski kod>`)
   * aday sayılmaz. Sayılsaydı silinmiş cihazın kodu süresiz bloke olurdu (ad
   * tarafında aynı sorun aynı süzgeçle çözülmüştü).
   */
  private async loadCodeCandidates(
    key: string,
    excludeId?: string,
  ): Promise<CodeCandidate[]> {
    const nameField = this.config.duplicateNameField;
    const rows = (await this.delegate.findMany({
      where: {
        ...(this.config.duplicateNameWhere ?? {}),
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true,
        isActive: true,
        [key]: true,
        ...(nameField ? { [nameField]: true } : {}),
      },
    })) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      code: typeof r[key] === "string" ? (r[key] as string) : null,
      name: nameField && typeof r[nameField] === "string" ? (r[nameField] as string) : null,
      isActive: r.isActive === true,
    }));
  }

  /**
   * Sıradaki otomatik günlük kod: `PREFIX + GGAAYY + NNNN`. `autoCode` config'i
   * gerektirir. collation-güvenli sorgu (gte + startsWith) + sayısal max+1 —
   * customer/fabricProperty `nextXxxCode` ile aynı kalıp ([[code-format]]).
   */
  protected async nextAutoCode(): Promise<string> {
    const cfg = this.config.autoCode;
    if (!cfg) throw new Error("nextAutoCode çağrıldı ama autoCode config'i yok");
    const field = cfg.field ?? "code";
    const digits = cfg.digits ?? 4;
    const fullPrefix = dailyCodePrefix(cfg.prefix);
    const rows = (await this.delegate.findMany({
      where: { [field]: { gte: fullPrefix, startsWith: fullPrefix } },
      select: { [field]: true },
    })) as Record<string, unknown>[];
    const seq = nextDailySeq(
      rows.map((r) => r[field] as string | null | undefined),
      fullPrefix,
    );
    return `${fullPrefix}${String(seq).padStart(digits, "0")}`;
  }

  /**
   * Nested-create transform + delegate.create + audit. create() iki yoldan
   * çağırır (normal + autoCode retry döngüsü) — insert gövdesi tek kaynak.
   */
  protected async performInsert(
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    // Transform nested array fields to Prisma's { create: [...] } format
    const prismaData = withActor({ ...data }, userId, "CREATE", this.config.modelName);
    if (this.config.nestedCreateFields) {
      for (const field of this.config.nestedCreateFields) {
        if (Array.isArray(prismaData[field])) {
          prismaData[field] = { create: prismaData[field] };
        }
      }
    }

    const record = (await this.delegate.create({
      data: prismaData,
      ...(this.config.defaultInclude ? { include: this.config.defaultInclude } : {}),
    })) as Record<string, unknown>;

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: this.config.tableName,
      recordId: record.id as string,
      newData: data,
    });

    return { success: true, data: record, message: "Kayıt oluşturuldu" };
  }

  async create(
    rawData: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const data = this.normalizeNameFields(this.sanitizeWriteData(rawData));

    // autoCode: backend-authoritative günlük kod. İstemci kodu DÜŞÜRÜLÜR; kod her
    // create'te taze üretildiğinden uniqueField reactivate yolu geçersiz — atlanır.
    // Ad-mükerrer guard'ı retry DIŞINDA bir kez (koddan bağımsız, idempotent);
    // @unique kod çakışması withBarcodeRetry ile taze sıra no okunarak telafi edilir.
    if (this.config.autoCode) {
      const codeField = this.config.autoCode.field ?? "code";
      delete data[codeField];
      await this.assertNameNotDuplicate(data);
      return withBarcodeRetry(async () => {
        data[codeField] = await this.nextAutoCode();
        return this.performInsert(data, userId);
      });
    }

    if (this.config.uniqueField) {
      const key = this.config.uniqueField;
      const incomingValue = data[key];
      if (typeof incomingValue === "string" && incomingValue.length > 0) {
        // §18 (2026-08-15): tekillik artık TAM EŞLEŞME değil, HARF-DUYARSIZ.
        // Eski `findFirst({ [key]: value })` `sefa` ile `SEFA`yı ayrı kimlikler
        // sayıyordu; kod bu sistemde kimliktir. Gerekçe + kapsam + tarihsel
        // kayıt politikası: `helpers/code-unique.helper.ts` dosya başlığı.
        //
        // ⚠️ Burada advisory kilit YOK (item.service'te var): BaseService.create
        // transaction AÇMAZ ve audit bilinçli olarak tx dışında yazılır. Guard
        // `assertNameNotDuplicate` ile aynı sınıftadır — panelden yapılan
        // master-data yaratımını korur, yarış korumasını değil (tam-eşleşme
        // yarışını DB'deki `@unique` kapatmaya devam eder).
        const candidates = await this.loadCodeCandidates(key);
        const decision = decideCodeUniqueness(incomingValue, candidates, this.codeTexts(key));
        if (decision.kind === "REACTIVATE") {
          // Reactivate edilen kaydın kendi adı hariç tutulur — yeni ad başka
          // bir kayıtla çakışıyorsa reactivate de reddedilir.
          // ⚠️ Hedefin kodu gönderilen kodla BİREBİR aynıdır (harf farkı 409'a
          // düşer, bkz. `decideCodeUniqueness`) → payload dokunulmadan geçer ve
          // bu yolun audit çıktısı §18 öncesiyle bayt-bayt aynı kalır.
          await this.assertNameNotDuplicate(data, decision.target.id);
          return this.reactivate(decision.target.id, data, userId);
        }
      }
    }
    await this.assertNameNotDuplicate(data);

    return this.performInsert(data, userId);
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
    const data = this.normalizeNameFields(this.sanitizeWriteData(rawData));
    // Fetch old data for audit
    const oldRecord = await this.delegate.findUnique({ where: { id } });

    // Ad-mükerrer kontrolü yalnız ad (veya kapsam kolonu) GERÇEKTEN değişirken —
    // canlıdaki tarihsel mükerrer kayıtlar aynen düzenlenebilir kalır. Kayıt hiç
    // yoksa kontrol atlanır — yanıltıcı 409 yerine Prisma'nın not-found'u dönsün.
    const dupField = this.config.duplicateNameField;
    if (dupField && oldRecord) {
      const old = oldRecord as Record<string, unknown>;
      const oldName = old[dupField];
      // Ad payload'da yoksa mevcut ad geçerli kalır (kapsam-taşıma durumu için).
      const effectiveName =
        typeof data[dupField] === "string" ? (data[dupField] as string) : oldName;
      const nameChanged =
        typeof data[dupField] === "string" &&
        (typeof oldName !== "string" ||
          foldNameForCompare(data[dupField] as string) !== foldNameForCompare(oldName));
      const scopeField = this.config.duplicateNameScopeField;
      const scopeChanged =
        !!scopeField &&
        data[scopeField] !== undefined &&
        data[scopeField] !== old[scopeField];
      if ((nameChanged || scopeChanged) && typeof effectiveName === "string") {
        await this.assertNameNotDuplicate({ ...data, [dupField]: effectiveName }, id);
      }
    }

    // §18 — KOD tekilliği update yolunda da harf-duyarsız. Eskiden update kodu
    // HİÇ kontrol etmiyordu (yalnız DB `@unique` seddi vardı, o da harf-duyarlı):
    // `PATCH { code: "sefa" }` mevcut `SEFA` kaydının yanına ikinci bir kimlik
    // yazabiliyordu. ⚠️ Kontrol YALNIZ kod GERÇEKTEN (katlanmış hâliyle)
    // değişirken koşar — aksi halde canlıdaki tarihsel ikizin KENDİSİ
    // düzenlenemez hâle gelirdi (kendi ikizine çarpar); ad guard'ının yukarıdaki
    // kuralıyla birebir aynı gerekçe.
    const codeField = this.config.uniqueField;
    if (codeField && oldRecord && typeof data[codeField] === "string") {
      const old = oldRecord as Record<string, unknown>;
      const nextCode = data[codeField] as string;
      const prevCode = typeof old[codeField] === "string" ? (old[codeField] as string) : "";
      if (foldCodeForCompare(nextCode) !== foldCodeForCompare(prevCode)) {
        assertCodeAvailable(
          nextCode,
          await this.loadCodeCandidates(codeField, id),
          this.codeTexts(codeField),
        );
      }
    }

    const updated = await this.delegate.update({
      where: { id },
      data: withActor(data, userId, "UPDATE", this.config.modelName),
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

    // F42: bağımlı kayıt (Restrict FK) varsa P2003 fırlar; error middleware bunu
    // "kayıt bulunamadı/silinmiş" 400'üne eşliyor (create-yanlış-FK mesajı, DELETE'te
    // yanıltıcı). Anlamlı 409'a çevir — "yıkıcı işlemde net onay" kuralıyla uyumlu.
    try {
      await this.delegate.delete({ where: { id } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2003"
      ) {
        throw AppError.conflict(
          "Bu kayda bağlı başka kayıtlar var — kalıcı olarak silinemez. Kaydı pasife alın.",
        );
      }
      throw err;
    }

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
