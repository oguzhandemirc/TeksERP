// =============================================================================
// Tambur Service / output-rolls
// =============================================================================
// Son çıkan toplar listesi (listRecentOutputRolls).
// `tambur.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../tambur.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { normalizeScanCode } from "../../utils/code-format";
import { ApiResponse } from "../../types/api.types";
import { factoryDayStart } from "../../constants/time";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../../utils/cursor";
import { buildTextSearch } from "../../utils/query-parser";
import type { CursorPaginatedResponse } from "../base.service";
import { K18_DEAD_STATUSES } from "../batch.service";
import {
  Prisma,
  Roll,
} from "@prisma/client";
import { TAMBUR_ENTRY_SOURCES } from "../../constants/tambur-entry-sources";
import { customerCodeSearchRollIds } from "../helpers/roll-scan-resolve.helper";

export async function listRecentOutputRolls(params?: {
    workOrderId?: string;
    limit?: number;
    /** Cursor mode aktivasyonu — verilirse pagination cursor response döner. */
    cursor?: string;
    /** `cursor=...` yokken bile cursor formatı istemek için (ilk sayfa). */
    mode?: string;
    /** Barkod / ürün adı-kodu / renk / parti araması. */
    search?: string;
    /** Cursor mode ilk fetch'te totalEstimate doldur. */
    withTotal?: boolean;
    /**
     * HIZLI TARİH: kaç FABRİKA GÜNÜ geriye bakılacak (1 = bugün, 2 = son 2 gün).
     * `dateFrom`/`dateTo` ile birlikte gönderilirse BU KAZANIR — hızlı seçim
     * operatörün son dokunduğu şeydir; ikisini AND'lemek "bugün" derken boş
     * liste döndürebilirdi (aralık dünü gösteriyorsa kesişim boş).
     */
    dayRange?: number;
    /** Serbest aralık (mutlak an — istemci yerel gün sınırlarını kendisi yollar). */
    dateFrom?: Date;
    dateTo?: Date;
    /** Kalite kodu (1.KALITE / A1 / FIRE). */
    qualityGrade?: string;
    /** Etiket hedefindeki müşteri (`Roll.labelCustomerId`). */
    customerId?: string;
    /** Kumaş (2026-08-12) — KK1 "Tüm Girişler" ile ORTAK filtre şeridinden. */
    itemId?: string;
    /** Kesimi yapan makine / personel (2026-08-12): "Bu makine" + Personel çipi. */
    createdMachineId?: string;
    createdById?: string;
  }): Promise<ApiResponse<Roll[]> | CursorPaginatedResponse<Roll>> {
    const where: Prisma.RollWhereInput = {
      // Tambur istasyonundan ÇIKAN her top — iki doğum yolu var:
      //   TAMBUR_SPLIT  → kesim çocuğu (kart okutulmuş normal akış)
      //   TAMBUR_MANUAL → "Manuel Ekle" modu, kartsız bitmiş top
      //
      // ⚠️ TAMBUR_MANUAL 2026-08-03'te EKLENDİ ve bu bir hata düzeltmesidir:
      // liste yalnız TAMBUR_SPLIT gösterdiği için manuel eklenen top buraya HİÇ
      // düşmüyordu. Bu ekranda etiketi yeniden basmanın TEK yolu Çıkanlar
      // önizlemesindeki "Bas / Yeni Etiket" olduğundan, yazıcı hata verdiğinde
      // operatörün elinde tek çıkar yol topu SIFIRDAN tekrar girmekti — yani
      // envantere mükerrer ("yalancı kopya") stok yazmak. Kaydın kendisi
      // doğruydu, kayıp olan şey ONA ULAŞMAKTI.
      entrySource: { in: [...TAMBUR_ENTRY_SOURCES] },
      // Sonradan tüketilen/iptal edilen çocuk (re-cut'ta TAMBUR_CONSUMED,
      // kartela/fason tüketimi, CANCELLED) fiziksel top değil — etiket basılmaz.
      status: { notIn: K18_DEAD_STATUSES },
      // İş emri süzgeci verilirse manuel toplar DOĞAL OLARAK düşer
      // (`producedInStepId` null — hiçbir WO'nun çıktısı değiller). Bu doğru:
      // "şu iş emrinden ne çıktı" sorusunun cevabı onlar değil. Mobil Çıkanlar
      // modalı bu süzgeci GEÇMEZ, o yüzden manuel toplar orada görünür.
      ...(params?.workOrderId
        ? { producedInStep: { workOrderId: params.workOrderId } }
        : {}),
    };
    // ── TARİH SÜZGECİ (2026-08-09) ──────────────────────────────────────────
    // Saha isteği: "bugün / son 2 gün / belli tarih aralığı". Gün sınırı
    // `factoryDayStart()` ile çözülür — düz `new Date()` gece vardiyasının
    // 00:00-03:00 arasındaki işini BİR ÖNCEKİ güne yazardı (kök CLAUDE.md'nin
    // "fabrika günü" kuralı). Çıpa `createdAt`: bu liste ÜRETİM anına bakar,
    // "son işlem"e değil (etiket yeniden basımı tarihi kaydırmasın).
    if (params?.dayRange) {
      // Çıpayı N-1 gün geri al, SONRA gün başına yasla — `factoryDayStart`
      // hedef günün kendi UTC ofsetini yeniden türettiği için yaz/kış saati
      // geçişinde de doğru sınır çıkar (düz ms çıkarma tek başına kayardı).
      const anchor = new Date(Date.now() - (params.dayRange - 1) * 86_400_000);
      where.createdAt = { gte: factoryDayStart(anchor) };
    } else if (params?.dateFrom || params?.dateTo) {
      // Serbest aralık: sınırlar İSTEMCİNİNDİR (raporlardaki `resolveDateRange`
      // sözleşmesi) — backend ek gün yuvarlaması YAPMAZ, yaparsa istemcinin
      // niyeti iki kez yorumlanır.
      where.createdAt = {
        ...(params.dateFrom ? { gte: params.dateFrom } : {}),
        ...(params.dateTo ? { lte: params.dateTo } : {}),
      };
    }
    if (params?.qualityGrade) where.qualityGrade = params.qualityGrade;
    // Kumaş: düz eşitlik (tekil seçim). Çoklu seçim istenirse `readIdCondition`
    // ile `{ in: [...] }`e çevrilir — ham CSV geçirmek P2007/400 demektir.
    if (params?.itemId) where.itemId = params.itemId;
    if (params?.createdMachineId) where.createdMachineId = params.createdMachineId;
    if (params?.createdById) where.createdById = params.createdById;
    if (params?.customerId) {
      // Etiket hedefindeki müşteri — `Roll.labelCustomerId` (B4). Kolon
      // yazılmadan önce basılmış toplarda NULL'dur ve süzgece takılmaz;
      // bu bilinçli (geri doldurma ayrı bir adım).
      where.labelCustomerId = params.customerId;
    }

    const search = params?.search?.trim();
    if (search) {
      // Müşteri koduyla eşleşen çıkış topları (D4-F1b; ayar kapalıyken [] → bayt-aynı).
      const customerCodeIds = await customerCodeSearchRollIds(search);
      // Barkod: TAM eşleşme (unique index seek) — `contains`/ILIKE en_US.UTF-8
      // collation'da barcode indeksini KULLANAMAZ → seq scan (ana rulo listesiyle
      // aynı karar, bkz. inventory.service buildRollWhere). Barkod okutulur/
      // yapıştırılır; ortasından substring araması saha akışı değil. Ürün/renk/
      // parti küçük master tablolarda kaldığı için `contains` (fuzzy) korunur.
      where.OR = [
        // ⚠️ `normalizeScanCode` ZORUNLU: el tarayıcısı barkodu KÜÇÜK harfle
        // gönderebiliyor (2026-08-17 saha vakası) ve burada TAM EŞİTLİK arandığı
        // için küçük harfli girdi SESSİZCE 0 sonuç verir — top listede "yok"
        // görünür ama yan panelde açılır (okutma yolu normalize ediyor). Ana top
        // listesi 2026-08-19'da düzeltilmişti; bu üç yüzey (Tambur çıktı listesi +
        // kartela liste/istatistik) atlanmıştı.
        { barcode: normalizeScanCode(search) },
        ...(customerCodeIds.length > 0 ? [{ id: { in: customerCodeIds } }] : []),
        ...buildTextSearch<Prisma.RollWhereInput>(search, {
          text: ["item.name", "color.name", "item.customerAliases.some.alias"],
          code: ["item.code", "producedInStep.workOrder.workOrderNumber"],
        }),
      ];
    }

    const include = {
      item: true,
      color: true,
      producedInStep: {
        select: { workOrder: { select: { id: true, workOrderNumber: true } } },
      },
    } as const;

    // Cursor mode (mobil infinite scroll + arama). Legacy çağrı (cursor/mode
    // yok) eski `ApiResponse<Roll[]>` "en yeni N" cevabını alır.
    const useCursor = !!params?.cursor || params?.mode === "cursor";
    if (useCursor) {
      const limit = Math.min(Math.max(1, params?.limit ?? 50), 200);
      const cursor = decodeDynamicCursor(params?.cursor);
      const cursorWhereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "createdAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.roll.findMany({
          where: cursorWhereClause,
          include,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
        params?.withTotal
          ? prisma.roll.count({ where })
          : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const data = hasMore ? items.slice(0, limit) : items;
      const last = data[data.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "createdAt") : null;
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

    const limit = Math.min(Math.max(params?.limit ?? 50, 1), 200);
    const rolls = await prisma.roll.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include,
    });
    return { success: true, data: rolls };
  }
