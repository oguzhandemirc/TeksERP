// =============================================================================
// Shipping Service / pool
// =============================================================================
// Çuval havuzu okumaları: havuz listesi, yön kilidi, müşteri havuz çuvalları, çuval depo panosu.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================

import {
  Prisma,
  ShipmentStatus,
  ShipmentDestination,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import {
  NON_SACKABLE_STATUSES,
  SACK_ABSENT_STATUSES,
} from "../helpers/sack-invariants.helper";
import {
  D0,
} from "../helpers/allocation.helper";
import { ACTIVE_TAG_SELECT, toTagBadges } from "../helpers/sack-tag.helper";
import { ApiResponse } from "../../types/api.types";
import {
  readShipmentDestinationLock,
} from "../helpers/shipment-destination.helper";
import type { CursorPaginatedResponse } from "../base.service";
import { uyari } from "../../lib/logger";
import { PackingGroupService } from "../packing-group.service";
import {
  buildTextSearch,
} from "../../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../../utils/cursor";
import { boardTotalsWithHold } from "../helpers/sack-store-board.helper";

export async function listPool(params: { customerId?: string; search?: string }): Promise<ApiResponse<unknown>> {
    const where: Prisma.SackWhereInput = { shipmentId: null };
    if (params.customerId) where.customerId = params.customerId;
    const search = params.search?.trim();
    if (search) {
      where.OR = buildTextSearch<Prisma.SackWhereInput>(search, {
        text: ["customer.name"],
        code: ["customer.code", "sackNo"],
      });
    }
    const sacks = await prisma.sack.findMany({
      where,
      take: 2000,
      select: {
        id: true,
        customerId: true,
        weightKg: true,
        customer: { select: { id: true, code: true, name: true } },
      },
    });
    if (sacks.length === 0) return { success: true, data: [] };

    // Roll metrajı çuval bazında (havuz kapsamı) — sackId → toplam.
    const rollAgg = await prisma.roll.groupBy({
      by: ["sackId"],
      where: { sackId: { in: sacks.map((s) => s.id) }, status: { notIn: NON_SACKABLE_STATUSES } },
      _sum: { currentQty: true },
      _count: { _all: true },
    });
    const rollBySack = new Map(rollAgg.map((g) => [g.sackId, g]));

    const UNASSIGNED = "__none__";
    const byCustomer = new Map<string, {
      customer: { id: string; code: string; name: string } | null;
      sackCount: number;
      totalKg: Prisma.Decimal;
      totalMeters: Prisma.Decimal;
      rollCount: number;
    }>();
    for (const s of sacks) {
      const key = s.customerId ?? UNASSIGNED;
      let e = byCustomer.get(key);
      if (!e) {
        e = { customer: s.customer, sackCount: 0, totalKg: D0(), totalMeters: D0(), rollCount: 0 };
        byCustomer.set(key, e);
      }
      e.sackCount += 1;
      if (s.weightKg) e.totalKg = e.totalKg.plus(s.weightKg);
      const ra = rollBySack.get(s.id);
      if (ra) {
        e.totalMeters = e.totalMeters.plus(ra._sum.currentQty ?? 0);
        e.rollCount += ra._count._all;
      }
    }
    const data = [...byCustomer.values()].map((e) => ({
      customer: e.customer,
      sackCount: e.sackCount,
      totalKg: Number(e.totalKg),
      totalMeters: Number(e.totalMeters),
      rollCount: e.rollCount,
    }));
    data.sort((a, b) => b.sackCount - a.sackCount || (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "", "tr"));
    return { success: true, data };
  }

export async function getDestinationLock(customerId: string, branchId: string | null): Promise<ApiResponse<unknown>> {
    return { success: true, data: await readShipmentDestinationLock(prisma, { customerId, branchId }) };
  }

export async function listCustomerPoolSacks(customerId: string): Promise<ApiResponse<unknown>> {
    // `defaultDestination`: 2026-09-23 öncesi tabletler seçicisini buradan başlatır — sahada
    // oldukları sürece alan KALIR. Yeni istemci yönü `/destination-lock`tan okur.
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, code: true, name: true, defaultDestination: true } });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");
    // GÜVENLİK TAVANI (2026-07-30) — sorgu eskiden LİMİTSİZDİ. Kardeşi `listPool`
    // `take: 2000` taşıyor; sınırsız sorgu bir tavan kadar bile korumasızdır (perf
    // kuralı #5). Ölçüm: bugün en kalabalık müşterinin 3 havuz çuvalı var (toplam
    // 369 çuval) → tavan bugün ISIRMIYOR, büyümeye karşı emniyet supabı.
    //
    // ⚠️ YÖN KRİTİK: `orderBy asc` + düz `take` EN YENİ çuvalları keserdi. Mobil
    // Paketleme ekranı AKTİF ÇUVALI listenin SONUNDAN seçiyor (`ensureActiveSack`
    // → `list[list.length - 1]`), yani tavan ısırsaydı yeni açılan çuval görünmez
    // olur ve operatör farkında olmadan ESKİ bir çuvala okuturdu. Bu yüzden `desc`
    // çekip sayfayı `reverse()` ile asc'e döndürüyoruz: kesilen uç ESKİ olanlar.
    const POOL_SACK_CAP = 2000;
    const sacksDesc = await prisma.sack.findMany({
      where: { customerId, shipmentId: null },
      orderBy: { createdAt: "desc" },
      take: POOL_SACK_CAP,
      select: {
        // weighedAt: kartta "✓ 14:22" (tartıldı izi) — tek-dokunuş tartıdan sonra
        // operatör hangi çuvalın tartıldığını modal açmadan görmeli.
        id: true, sackNo: true, weightKg: true, weighedAt: true, branchId: true, notes: true,
        // Paketleme grubu (çalışma yaftası) — istemci listeyi bu alana göre
        // bloklar. NULL = "Gruplanmamış" (bugünkü ve varsayılan hâl).
        packingGroupId: true,
        branch: { select: { id: true, code: true, name: true } },
        // İZLER (çuval etiketi) — tablette SALT-OKUNUR çip. Tek kaynak
        // `ACTIVE_TAG_SELECT`: rozet/filtre/belge ayrışmasın. Havuz çuvalı tanımı
        // gereği sevk EDİLMEMİŞTİR (`shipmentId: null`), yani `clearedAt` yüklemi
        // burada bugün ısırmaz — yine de ORTAK select'ten geçer, çünkü ayrı yazılan
        // ikinci bir yüklem tam da bu depoda adı konmuş "ayrışan yüzey" sınıfıdır.
        tags: ACTIVE_TAG_SELECT,
        // `status`: hayalet topu (çuvalda kayıtlı ama fiziksel olarak binada olmayan)
        // istemci işaretleyebilsin. Top ARRAY'İ filtrelenmez — filtrelenirse operatör
        // onu göremez ve çıkaramaz; sayaçlar aşağıda ayrıca dışlar.
        rolls: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, status: true, width: true, currentQty: true, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true, hex: true } } } },
        swatches: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true } } } },
      },
    });
    // Sözleşme KORUNUR: istemciler `createdAt asc` bekliyor (mobil aktif çuvalı sondan
    // seçiyor). `desc + take` ile en yeniler alındı, burada asc'e döndürülüyor.
    const sacks = sacksDesc.reverse();
    const data = sacks.map((sk) => {
      // SAYAÇLAR hayaleti DIŞLAR → çuval etiketi (label.service, aynı küme), liste ve
      // irsaliye aynı adedi/metrajı basar. Görünüm ise hepsini gösterir (üstteki not).
      const present = sk.rolls.filter((r) => !SACK_ABSENT_STATUSES.includes(r.status));
      const totalQty = present.reduce((s, r) => s.plus(r.currentQty), D0());
      return {
        id: sk.id, sackNo: sk.sackNo, weightKg: sk.weightKg != null ? Number(sk.weightKg) : null,
        packingGroupId: sk.packingGroupId,
        weighedAt: sk.weighedAt, notes: sk.notes,
        // ⚠️ Yanına ayrı hesaplanmış bir etiket SAYACI EKLENMEZ: Sevk Kapısı ile
        // `/pool` zaten iki farklı rakam üretiyor, üçüncüsü olmasın. Çip listesi
        // rozetin KENDİSİDİR; sayı isteyen `tags.length` okur.
        tags: toTagBadges(sk.tags),
        branch: sk.branch,
        rollCount: present.length, swatchCount: sk.swatches.length, totalQty: Number(totalQty),
        rolls: sk.rolls.map((r) => ({ id: r.id, barcode: r.barcode, status: r.status, width: r.width != null ? Number(r.width) : null, currentQty: Number(r.currentQty), item: r.item, color: r.color })),
        swatches: sk.swatches.map((s) => ({ id: s.id, barcode: s.barcode, item: s.item, color: s.color })),
      };
    });
    // `truncated`: tavan ısırdıysa SESSİZ KALMA. Bu ekranda kesilen çuval yalnız
    // görünmez olmuyor — sevkiyata GİRMİYOR, KPI'lardan düşüyor ve aramada bile
    // bulunamıyor (arama bellekteki dizide çalışıyor). İstemci bunu bir uyarı
    // şeridine çevirmeli. Alan EKLEMELİ olduğu için eski istemcileri kırmaz.
    const truncated = sacksDesc.length === POOL_SACK_CAP;
    if (truncated) {
      uyari("listCustomerPoolSacks", `müşteri ${customerId}: havuz çuvalı ${POOL_SACK_CAP} tavanına ulaştı — en eskiler kesildi.`,
      );
    }
    // Gruplar AYNI yanıtta: istemci ikinci bir tur atmasın (liste ile grup
    // başlıkları ayrı anlarda gelirse ekran bir kare boyunca "gruplanmamış"
    // gösterirdi). Bayrak kapalıyken servis boş dizi döner.
    const groups = (await PackingGroupService.list(customerId)).data ?? [];
    return { success: true, data: { customer, sacks: data, groups, truncated, limit: POOL_SACK_CAP } };
  }

export async function listSackStoreBoard(params: { status?: string; search?: string; destination?: string; cursor?: string; limit?: number }): Promise<CursorPaginatedResponse<unknown>> {
    const limit = Math.min(Math.max(1, params.limit ?? 30), 100);
    const where: Prisma.ShipmentWhereInput = { status: ShipmentStatus.PLANNED };
    if (params.destination === "DOMESTIC" || params.destination === "EXPORT") {
      where.destination = params.destination as ShipmentDestination;
    }
    const search = params.search?.trim();
    if (search) {
      // Parti kodu/adı da aranır (`PRT-2609-0007` · `P-2`): çuval sevkten sonra da
      // `packingGroupId` taşır, sevkiyat partisiyle bulunur (saha 2026-09-22).
      where.OR = buildTextSearch<Prisma.ShipmentWhereInput>(search, {
        text: ["customer.name"],
        code: ["shipmentNo", "sacks.some.sackNo", "sacks.some.packingGroup.code", "sacks.some.packingGroup.name"],
      });
    }

    const cursor = decodeDynamicCursor(params.cursor);
    const finalWhere: Prisma.ShipmentWhereInput = cursor ? { AND: [where, dynamicCursorWhere(cursor, "createdAt", "asc") as Prisma.ShipmentWhereInput] } : where;

    const rows = await prisma.shipment.findMany({
      where: finalWhere,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: { id: true, shipmentNo: true, status: true, destination: true, procedureCode: true, createdAt: true, plateNumber: true, driverName: true, carrier: true, customer: { select: { id: true, code: true, name: true } }, branch: { select: { id: true, code: true, name: true } } },
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const ids = pageRows.map((s) => s.id);
    const nextCursor = hasMore ? buildNextDynamicCursor(pageRows[pageRows.length - 1] as unknown as Record<string, unknown>, "createdAt") : null;

    // D4-I4: toplamlar + cari kilidi tek sorguda (`boardTotalsWithHold`; eski iki groupBy ile aynı yüklem).
    const totals = await boardTotalsWithHold(ids);
    const data = pageRows.map((s) => {
      const t = totals.get(s.id);
      return { id: s.id, shipmentNo: s.shipmentNo, status: s.status, destination: s.destination, procedureCode: s.procedureCode, createdAt: s.createdAt, plateNumber: s.plateNumber, driverName: s.driverName, carrier: s.carrier, customer: s.customer, branch: s.branch, sackCount: t?.sackCount ?? 0, cartCount: t?.cartCount ?? 0, bulkCount: t?.bulkCount ?? 0, cartLabels: t?.cartLabels ?? [], rollCount: t?.rollCount ?? 0, totalKg: t?.totalKg ?? 0, totalQty: t?.totalQty ?? 0, held: t?.held ?? false, holdScopes: t?.holdScopes ?? [], holdText: t?.holdText ?? null };
    });
    return { success: true, data, pagination: { nextCursor, hasMore, limit } };
  }
