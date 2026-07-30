// =============================================================================
// Sack Search Service — Saha #1+#23: Çuval/Top Arama
// =============================================================================
// Üç soruya tek ekrandan cevap:
//   1) "X üründen hangi çuvallarda ne kadar var?"  → searchSacks(itemId/colorId/width)
//      — çuval listesi + her çuvalda EŞLEŞEN top sayısı/metresi.
//   2) "Şu çuvalda ne var?"                        → searchSacks(sackCode) + getSackContents
//   3) "Bu top hangi çuvalda/sevkiyatta?"          → locateRoll(barcode)
// Kapsam (scope): POOL (havuzda, shipmentId null) | PLANNED (planlı sevkiyatta) |
// DISPATCHED (sevk edilmiş) | ALL. Varsayılan: POOL + PLANNED (sevk edilmemiş).
// Salt-okunur — yazma/audit yok. Liste cursor'lı (sacks yıllar içinde büyür),
// aggregate'ler yalnız sayfadaki çuvallar için (over-fetch yok).
// =============================================================================

import { Prisma, ShipmentStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import type { CursorPaginatedResponse } from "./base.service";
import { decodeDynamicCursor, dynamicCursorWhere, buildNextDynamicCursor } from "../utils/cursor";
import { isDailyCode } from "../utils/code-format";
import { buildTurkishSearch } from "../utils/query-parser";
import { SACK_ABSENT_STATUSES } from "./helpers/sack-invariants.helper";

const PLANNED_STATUSES: ShipmentStatus[] = [ShipmentStatus.PLANNED];

/** Çuval-seçimli salt-okunur dökümlerde (çeki listesi, içerik dökümü) üst sınır. */
const MAX_SELECTED_SACKS = 200;

/** Tek değer / dizi → temiz ID dizisi (filtre semantiği: aynı alan içinde VEYA). */
function toIdList(v: string | string[] | undefined): string[] {
  return (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);
}

export type SackSearchScope = "POOL" | "PLANNED" | "DISPATCHED" | "ALL";

export interface SackSearchParams {
  /** Tek ID ya da ID listesi — liste verilirse aynı alan içinde VEYA (IN) uygulanır. */
  itemId?: string | string[];
  colorId?: string | string[];
  width?: number;
  widthMin?: number;
  widthMax?: number;
  customerId?: string | string[];
  scope?: SackSearchScope;
  shipmentNo?: string;
  sackCode?: string;
  includeDispatched?: boolean;
  /** Serbest arama — sackNo / müşteri adı-kodu / sevkiyat no (DataTable arama kutusu). */
  search?: string;
  /** Sıralama alanı — yalnız Sack skaler kolonu (createdAt | sackNo); aksi createdAt. */
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  /** İlk sayfada toplam tahmini (DataTable). */
  withTotal?: boolean;
  cursor?: string;
  limit?: number;
}

/** Kapsam → Sack where OR parçaları (POOL=havuz, PLANNED/DISPATCHED=sevkiyat statüsü). */
function scopeWhere(scope: SackSearchScope): Prisma.SackWhereInput[] {
  switch (scope) {
    case "POOL":
      return [{ shipmentId: null }];
    case "PLANNED":
      return [{ shipment: { status: { in: PLANNED_STATUSES } } }];
    case "DISPATCHED":
      return [{ shipment: { status: ShipmentStatus.DISPATCHED } }];
    case "ALL":
      return [{ shipmentId: null }, { shipment: { is: {} } }];
  }
}

export class SackSearchService {
  /**
   * Çuval arama — içerik (ürün/renk/en) ve/veya kimlik (kod/sevkiyat/müşteri)
   * filtreli. İçerik filtresi aktifken her satırda eşleşen top adedi+metresi
   * ayrıca döner ("bu çuvalda aradığından ne kadar var").
   */
  async searchSacks(params: SackSearchParams): Promise<CursorPaginatedResponse<unknown>> {
    const limit = Math.min(Math.max(1, params.limit ?? 50), 100);
    const sortField: "createdAt" | "sackNo" = params.sortBy === "sackNo" ? "sackNo" : "createdAt";
    const sortOrder: "asc" | "desc" = params.sortOrder === "asc" ? "asc" : "desc";

    // İçerik (rulo düzeyi) filtresi — ürün/renk/en (en tek değer VEYA min-max aralık).
    // Çoklu ID = alan içinde VEYA (IN); farklı alanlar arasında VE (sektör standardı).
    const rollFilter: Prisma.RollWhereInput = {};
    const itemIds = toIdList(params.itemId);
    const colorIds = toIdList(params.colorId);
    if (itemIds.length) rollFilter.itemId = { in: itemIds };
    if (colorIds.length) rollFilter.colorId = { in: colorIds };
    if (params.widthMin != null || params.widthMax != null) {
      rollFilter.width = {
        ...(params.widthMin != null ? { gte: params.widthMin } : {}),
        ...(params.widthMax != null ? { lte: params.widthMax } : {}),
      };
    } else if (params.width != null) {
      rollFilter.width = params.width;
    }
    const hasContentFilter = Object.keys(rollFilter).length > 0;

    // Kapsam: verilen scope; yoksa includeDispatched'e göre ALL, aksi POOL+PLANNED (varsayılan).
    const scopeOr: Prisma.SackWhereInput[] = params.scope
      ? scopeWhere(params.scope)
      : params.includeDispatched
        ? scopeWhere("ALL")
        : [{ shipmentId: null }, { shipment: { status: { in: PLANNED_STATUSES } } }];

    const andClauses: Prisma.SackWhereInput[] = [{ OR: scopeOr }];
    const customerIds = toIdList(params.customerId);
    if (customerIds.length) andClauses.push({ customerId: { in: customerIds } });
    const shipmentNo = params.shipmentNo?.trim();
    if (shipmentNo) andClauses.push({ shipment: { is: { OR: buildTurkishSearch<Prisma.ShipmentWhereInput>(shipmentNo, ["shipmentNo"]) } } });
    const sackCode = params.sackCode?.trim();
    if (sackCode) andClauses.push({ OR: buildTurkishSearch<Prisma.SackWhereInput>(sackCode, ["sackNo"]) });
    // Serbest arama (DataTable kutusu) — sackNo / müşteri adı-kodu / sevkiyat no.
    const search = params.search?.trim();
    if (search) {
      andClauses.push({ OR: buildTurkishSearch<Prisma.SackWhereInput>(search, ["sackNo", "customer.name", "customer.code", "shipment.shipmentNo"]) });
    }
    if (hasContentFilter) andClauses.push({ rolls: { some: rollFilter } });

    const where: Prisma.SackWhereInput = { AND: andClauses };
    const cursor = decodeDynamicCursor(params.cursor);
    const finalWhere: Prisma.SackWhereInput = cursor
      ? { AND: [where, dynamicCursorWhere(cursor, sortField, sortOrder) as Prisma.SackWhereInput] }
      : where;

    const rows = await prisma.sack.findMany({
      where: finalWhere,
      orderBy: [{ [sortField]: sortOrder }, { id: sortOrder }],
      take: limit + 1,
      select: {
        id: true,
        sackNo: true,
        seq: true,
        weightKg: true,
        createdAt: true,
        // Yorum listede yalnız KIRPILMIŞ önizleme olarak döner (aşağıda notePreview) —
        // 500 karakterlik metni sayfa başına 100 satır çekmek payload'ı şişirir
        // (perf kuralı #7). Tam metin çuval detayında / getSackNotes ile alınır.
        notes: true,
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
          },
        },
      },
    });
    const totalEstimate = params.withTotal ? await prisma.sack.count({ where }) : undefined;

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const ids = pageRows.map((s) => s.id);
    const nextCursor = hasMore
      ? buildNextDynamicCursor(pageRows[pageRows.length - 1] as unknown as Record<string, unknown>, sortField)
      : null;

    // Sayfa kapsamı aggregate'leri: toplam içerik + (filtre aktifse) eşleşen kısım.
    // HAYALET DIŞLANIR (`SACK_ABSENT_STATUSES`): çuvalda kayıtlı ama fiziksel olarak
    // binada olmayan top (kartelaya/tambura/fasona gitmiş) sayılırsa liste, çuval
    // etiketi (label.service — aynı küme) ve irsaliye AYNI çuval için ÜÇ FARKLI top
    // adedi basardı. Filtre `matchAgg`'a da uygulanır; yoksa içerik filtresi seçili
    // ürünün hayaletini sayıp "eşleşen > toplam" absürtlüğü doğar.
    const presentOnly = { status: { notIn: SACK_ABSENT_STATUSES } };
    const [allAgg, matchAgg, swatchAgg] = ids.length
      ? await Promise.all([
          prisma.roll.groupBy({
            by: ["sackId"],
            where: { sackId: { in: ids }, ...presentOnly },
            _count: { _all: true },
            _sum: { currentQty: true },
          }),
          hasContentFilter
            ? prisma.roll.groupBy({
                by: ["sackId"],
                where: { sackId: { in: ids }, ...presentOnly, ...rollFilter },
                _count: { _all: true },
                _sum: { currentQty: true },
              })
            : Promise.resolve([]),
          prisma.swatch.groupBy({
            by: ["sackId"],
            where: { sackId: { in: ids } },
            _count: { _all: true },
          }),
        ])
      : [[], [], []];

    const allBySack = new Map(allAgg.map((g) => [g.sackId, g]));
    const matchBySack = new Map(matchAgg.map((g) => [g.sackId, g]));
    const swatchBySack = new Map(swatchAgg.map((g) => [g.sackId, g]));

    const data = pageRows.map((s) => {
      const all = allBySack.get(s.id);
      const match = matchBySack.get(s.id);
      return {
        id: s.id,
        sackNo: s.sackNo,
        seq: s.seq,
        weightKg: s.weightKg === null ? null : Number(s.weightKg),
        createdAt: s.createdAt,
        // Yorum var mı (💬 göstergesi) + ilk 80 karakter (satır ipucu).
        hasNote: !!s.notes,
        notePreview: s.notes ? s.notes.slice(0, 80) : null,
        customer: s.customer,
        branch: s.branch,
        shipment: s.shipment, // null = havuzda; dolu = sevkiyatta
        rollCount: all?._count._all ?? 0,
        totalQty: Number(all?._sum.currentQty ?? 0),
        swatchCount: swatchBySack.get(s.id)?._count._all ?? 0,
        // İçerik filtresi yokken null — UI eşleşme sütununu gizler.
        matchRollCount: hasContentFilter ? (match?._count._all ?? 0) : null,
        matchQty: hasContentFilter ? Number(match?._sum.currentQty ?? 0) : null,
      };
    });

    return {
      success: true,
      data,
      pagination: { nextCursor, hasMore, limit, ...(totalEstimate !== undefined ? { totalEstimate } : {}) },
    };
  }

  /**
   * Tek çuvalın dökümü — arama satırı genişletilince lazy yüklenir.
   * Tek çuval = sınırlı kapsam (onlarca top) → satırları çekmek güvenli.
   */
  async getSackContents(sackId: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: {
        id: true,
        sackNo: true,
        seq: true,
        weightKg: true,
        // Tartının kaynağı — İÇ iz, yalnız DETAY yüzeyinde. Listeye eklenmedi
        // (gürültü) ve BELGEYE/ETİKETE hiç girmez (schema.prisma doc'u).
        // NULL = bu alandan önce tartılmış (legacy) → rozet gösterilmez.
        weightSource: true,
        notes: true, // tek çuval → tam yorum (liste aksine kırpılmaz)
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, code: true, name: true } },
          },
        },
        rolls: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            barcode: true,
            // ⚠️ HAYALET GÖRÜNÜRLÜĞÜ — bu ekran (Paketleme / Çuvallar → çuval düzenle)
            // operatörün hayalet topu GÖRÜP ÇIKARDIĞI yerdir; guard'ların hata mesajı
            // buraya yönlendirir. Bu yüzden liste BURADA FİLTRELENMEZ ve `status`
            // döndürülür (istemci rozetler). Filtrelemek kaçış yolunu kapatırdı.
            status: true,
            currentQty: true,
            width: true,
            qualityGrade: true,
            // Etiket bayat mı — müşteri değişimi/relabel sonrası "yeniden bas"
            // uyarısını ve toplu yeniden-basma aksiyonunu besler.
            labelDirty: true,
            item: { select: { id: true, name: true } },
            color: { select: { id: true, name: true, hex: true } },
          },
        },
        swatches: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            barcode: true,
            item: { select: { id: true, name: true } },
            color: { select: { id: true, name: true, hex: true } },
          },
        },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    return { success: true, data: sack };
  }

  /**
   * Çeki listesi verisi — SEÇİLEN çuvalların içerik özetiyle tek istekte dökümü.
   * Senaryo: müşterinin farklı sevkiyatlarda bekleyen çuvallarından bir alt küme
   * seçilir ("sadece gri Patos"), kağıda basılır, sahada bulunan çuvalın üstü
   * çizilir. Çalışma kağıdıdır — PrintedDocument (donmuş/versiyonlu) DEĞİL.
   * Salt-okunur; seçim ≤200 çuval + çuval başına onlarca top → tek sorgu güvenli.
   */
  async getPickList(sackIds: string[]): Promise<ApiResponse<unknown>> {
    const ids = [...new Set(sackIds)];
    if (ids.length === 0) throw AppError.badRequest("En az bir çuval seçilmeli");
    if (ids.length > MAX_SELECTED_SACKS) {
      throw AppError.badRequest(`Bir çeki listesinde en fazla ${MAX_SELECTED_SACKS} çuval olabilir`);
    }

    const sacks = await prisma.sack.findMany({
      where: { id: { in: ids } },
      // Sevkiyat + çuval sırası: sahada aynı sevkin çuvalları yan yana durur.
      orderBy: [{ shipmentId: "asc" }, { seq: "asc" }],
      select: {
        id: true,
        sackNo: true,
        seq: true,
        weightKg: true,
        // Çeki listesi bir İÇ çalışma kağıdı (müşteriye gitmez) → notun TAM metni
        // döner (liste uçlarındaki 80 karakter kırpması burada gereksiz; kapsam
        // seçili çuvallarla sınırlı, en fazla 200). Basılması İSTEMCİDE opsiyonel.
        notes: true,
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
          },
        },
        rolls: {
          // HAYALET DIŞLANIR: çeki listesi sahada "bu çuvalda şu ürünlerden N top
          // var" diye okunan bir arama kağıdıdır. Kartelaya/tambura gitmiş top
          // sayılırsa operatör olmayan malı arar ve "top eksik" alarmı verir.
          // Aynı küme etiket + liste + irsaliyede de kullanılır (tek kaynak).
          where: { status: { notIn: SACK_ABSENT_STATUSES } },
          select: {
            currentQty: true,
            width: true,
            item: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
        swatches: { select: { id: true } },
      },
    });

    const data = sacks.map((s) => {
      // Ürün·renk·en bazında özet (irsaliye döküm diliyle aynı).
      const groups = new Map<string, { itemName: string; colorName: string | null; width: number | null; qty: number; rollCount: number }>();
      let totalQty = 0;
      for (const r of s.rolls) {
        const widthNum = r.width === null ? null : Number(r.width);
        const key = `${r.item.name}|${r.color?.name ?? ""}|${widthNum ?? ""}`;
        const g = groups.get(key) ?? {
          itemName: r.item.name,
          colorName: r.color?.name ?? null,
          width: widthNum,
          qty: 0,
          rollCount: 0,
        };
        g.qty += Number(r.currentQty);
        g.rollCount += 1;
        groups.set(key, g);
        totalQty += Number(r.currentQty);
      }
      return {
        id: s.id,
        sackNo: s.sackNo,
        seq: s.seq,
        weightKg: s.weightKg === null ? null : Number(s.weightKg),
        notes: s.notes,
        customer: s.customer,
        branch: s.branch,
        shipment: s.shipment,
        rollCount: s.rolls.length,
        swatchCount: s.swatches.length,
        totalQty,
        contents: [...groups.values()],
      };
    });

    return { success: true, data };
  }

  /**
   * İÇERİK DÖKÜMÜ — seçilen çuvalların TOP BAZLI dökümü (Excel/PDF/yazdır kaynağı).
   *
   * Çeki listesinden (`getPickList`) farkı: orası ürün·renk·en bazında GRUPLU özet
   * basar (sahada çuval ararken doğru olan), burası her topu ayrı satır olarak
   * verir (barkod dahil) — "çuvalda tam olarak ne var" sorusunun cevabı.
   * Aynı iskelet: aynı ≤200 çuval sınırı, aynı sıralama (sevkiyat + çuval sırası,
   * sahada aynı sevkin çuvalları yan yana durur), salt-okunur, audit yok.
   *
   * Decimal alanlar BURADA `Number()`'a çevrilir — `getSackContents` bunu yapmadığı
   * için istemci her kullanımda `Number(...)` sarmak zorunda kalıyor; yeni uçta o
   * tuzak tekrarlanmaz.
   */
  async getContentDump(sackIds: string[]): Promise<ApiResponse<unknown>> {
    const ids = [...new Set(sackIds)];
    if (ids.length === 0) throw AppError.badRequest("En az bir çuval seçilmeli");
    if (ids.length > MAX_SELECTED_SACKS) {
      throw AppError.badRequest(`Bir dökümde en fazla ${MAX_SELECTED_SACKS} çuval olabilir`);
    }

    const sacks = await prisma.sack.findMany({
      where: { id: { in: ids } },
      orderBy: [{ shipmentId: "asc" }, { seq: "asc" }],
      select: {
        id: true,
        sackNo: true,
        seq: true,
        weightKg: true,
        // İÇ döküm (müşteriye giden belge değil) → notun TAM metni döner. Basılıp
        // basılmayacağına İSTEMCİ karar verir (opt-in) — kök CLAUDE.md kuralı.
        notes: true,
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        shipment: { select: { id: true, shipmentNo: true, status: true } },
        rolls: {
          orderBy: { createdAt: "asc" },
          // HAYALET DIŞLANIR — `SACK_ABSENT_STATUSES` (SHIPPED sayılır). Döküm bir
          // SAYIM/BELGE yüzeyi: çeki listesi ve liste aggregate'leri de aynı kümeyi
          // eler. Elemezsek liste "3 top" derken döküm 4 satır basar (sessiz çelişki).
          where: { status: { notIn: SACK_ABSENT_STATUSES } },
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            width: true,
            qualityGrade: true,
            item: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
        swatches: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            barcode: true,
            item: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
      },
    });

    const data = sacks.map((s) => {
      const rolls = s.rolls.map((r) => ({
        id: r.id,
        barcode: r.barcode,
        itemName: r.item.name,
        colorName: r.color?.name ?? null,
        width: r.width === null ? null : Number(r.width),
        qty: Number(r.currentQty),
        qualityGrade: r.qualityGrade,
      }));
      return {
        id: s.id,
        sackNo: s.sackNo,
        seq: s.seq,
        weightKg: s.weightKg === null ? null : Number(s.weightKg),
        notes: s.notes,
        customer: s.customer,
        branch: s.branch,
        shipment: s.shipment,
        rollCount: rolls.length,
        totalQty: rolls.reduce((a, r) => a + r.qty, 0),
        rolls,
        swatches: s.swatches.map((w) => ({
          id: w.id,
          barcode: w.barcode,
          itemName: w.item.name,
          colorName: w.color?.name ?? null,
        })),
      };
    });

    return { success: true, data };
  }

  /**
   * Top yerini bul — barkod EXACT eşleşme (ILIKE contains seq-scan tuzağına
   * girilmez; barkodlar tam okutulur). Çuvalsız/sevkiyatsız toplar için de
   * konum cevabı verir (statü = depoda/üretimde/sevk edildi).
   */
  async locateRoll(barcode: string): Promise<ApiResponse<unknown>> {
    const code = barcode.trim();
    if (!code) throw AppError.badRequest("Barkod gerekli");
    // Çuval kodu okutulduysa top araması anlamsız — ne yapacağını söyle
    // (çuval etiketi basılabiliyor, bu okutma kaçınılmaz).
    if (isDailyCode(code, "CV")) {
      throw AppError.badRequest(
        `${code} bir ÇUVAL kodu — bu ekran TOP barkodu bekler. Çuvalı bulmak için çuval aramasını kullanın.`,
      );
    }

    const roll = await prisma.roll.findFirst({
      where: { barcode: code },
      select: {
        id: true,
        barcode: true,
        status: true,
        currentQty: true,
        width: true,
        qualityGrade: true,
        item: { select: { id: true, name: true } },
        color: { select: { id: true, name: true, hex: true } },
        sack: { select: { id: true, sackNo: true, seq: true, weightKg: true, notes: true } },
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (!roll) throw AppError.notFound("Bu barkodla top bulunamadı");
    return { success: true, data: roll };
  }
}

export const sackSearchService = new SackSearchService();
