// =============================================================================
// DEPO SERVİSİ — BaseService CRUD + üç guard
// =============================================================================
// Depo saf tanım verisidir; listeleme/arama/kod üretimi BaseService'ten gelir.
// Eklenen tek şey, varsayılan deponun ve dolu deponun korunması.
//
// ⚠️ "Varsayılan depo" bir KURAL taşır: depo söylenmeyen her giriş oraya düşer
// (`resolveTargetWarehouseId`). Pasifleştirilir ya da silinirse o kural cevapsız
// kalır ve yeni toplar DEPOSUZ doğar — hata yok, log yok, yalnız envanterde
// sessiz boşluk. Bu yüzden guard servis katmanında AÇIK; DB tarafında da
// `rolls_warehouseId_fkey` RESTRICT ile ikinci hat var.
// =============================================================================
import { Prisma, WarehouseEventType } from "@prisma/client";
import prisma from "../lib/prisma";
import { BaseService } from "./base.service";
import { AppError } from "../utils/app-error";
import { buildNextCursor, cursorWhere, decodeCursor } from "../utils/cursor";
import type { ApiResponse } from "../types/api.types";

// =============================================================================
// DEPO HAREKET DEFTERİ — OKUMA YÜZEYİ
// =============================================================================
// Defter 2026-08-14'ten beri YAZILIYOR (`warehouse-ledger.helper`) ama tek okuma
// yolu transfer detayıydı (`transferId` ile süzülmüş TRANSFER satırları). Yani
// "bu depoya ne girdi / bundan ne çıktı" sorusunun hiçbir ekranda cevabı yoktu:
// veri vardı, kapısı yoktu. Bu, iplik defterinin (`GET /api/yarn/movements` +
// `YarnMovementsSheet`) birebir ikizidir ve o emsalin sözleşmesini izler.
//
// ⚠️ `requireFinanceEnabled` KOYULMADI — ve bu ÖLÇÜLMÜŞ bir karardır, ihmal
// değil. İplik uçları rejim kapısı taşır çünkü İPLİK ticaret paketine ait bir
// kavramdır (fabrikada iplik stoğu yoktur). Depo defteri ise fabrikada da
// yazılıyor: satırları `inventory` (KK1 girişi, top iptali), `shipping` (sevk +
// storno), `return.service` (müşteri iadesi) ve `subcontractor` üretiyor —
// dördü de fabrika yollarıdır ve `finance.enabled` KAPALIYKEN de koşar. Kapı
// koymak, fabrikada YAZILAN defteri fabrikada OKUNAMAZ yapardı.
// ⚠️ AYRIM (2026-09-02): depo TANIMI ve DEFTERİ (`GET /api/warehouses`,
// `/api/warehouses/movements`) rejimsiz KALIR; `/api/warehouse-transfers/*`
// ise `depo.multiEnabled` kapısı TAŞIR. İkisi farklı sorulardır: defteri
// yazmak çekirdek iştir, depolar ARASI taşıma ise çoklu depo yüzeyidir ve tek
// depolu bir kurulumda taşınacak ikinci depo yoktur.
//
// ⚠️ YÖN (`direction`) SUNUCUDA TÜRETİLİR, istemcide DEĞİL. "Giren mi çıkan mı"
// sorusunun cevabı BAKAN DEPOYA görelidir (aynı TRANSFER satırı kaynak depo
// için çıkan, hedef depo için girendir). İki istemci bu kuralı ayrı ayrı
// yazsaydı biri er geç `eventType`e bakıp (ENTRY=giren, SHIPMENT=çıkan) TRANSFER
// satırını hep aynı yöne basardı — rakam doğru, cümle yalan.
//
// ⚠️ SAYFA TOPLAMI YOK (iplik dökümündeki "yürüyen bakiye yok" kuralının ikizi):
// döküm cursor'lu ve kısmidir; elimizdeki sayfadan "bu depoya N m girdi" yazmak
// görünmeyen satırları yok saymak olurdu. Gerçekten gerekirse çözüm istemcide
// toplamak değil, backend'in filtre bazlı aggregate döndürmesidir.
// =============================================================================

/** Defter satırının, BAKAN DEPOYA göre yönü. */
export type WarehouseMovementDirection = "IN" | "OUT";

/**
 * Satırın yönü — `warehouseId` verilmemişse (tüm depolar dökümü) yön YOKTUR ve
 * `null` döner: hangi depodan bakıldığı belli değilken "giren" demek uydurmadır.
 *
 * ⚠️ from === to durumunda da `null` döner. Şema TRANSFER'de ikisinin FARKLI
 * olmasını şart koşar, yani bu satır bugün doğamaz; yine de sessizce "giren"
 * demek yerine yönsüz bırakılır — veri tuhaflığı ekranda görünmeli, gizlenmemeli.
 */
export function warehouseMovementDirection(
  row: { fromWarehouseId: string | null; toWarehouseId: string | null },
  warehouseId?: string,
): WarehouseMovementDirection | null {
  if (!warehouseId) return null;
  const isIn = row.toWarehouseId === warehouseId;
  const isOut = row.fromWarehouseId === warehouseId;
  if (isIn === isOut) return null; // ikisi de / hiçbiri
  return isIn ? "IN" : "OUT";
}

export interface WarehouseMovementListParams {
  limit?: number;
  cursor?: string;
  /** Bu depoya DOKUNAN hareketler (giren VEYA çıkan). */
  warehouseId?: string;
  eventType?: WarehouseEventType;
  rollId?: string;
  sackId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

class WarehouseService extends BaseService {
  constructor() {
    super({
      modelName: "warehouse",
      tableName: "WAREHOUSE",
      // ⚠️ KOD ↔ METİN kovası AYRI (2026-09-01): metin yolu `<kolon>Fold`
      // gölgesini sorar, kod yolu ham kolonu. `code` metin kovasında kaldığı
      // sürece var olmayan `codeFold`a soruluyordu → arama kutusuna yazınca 500.
      searchFields: ["name", "address", "notes"],
      codeSearchFields: ["code"],
      uniqueField: "code",
      duplicateNameField: "name",
      entityLabel: "depo",
      // Kod backend-authoritative: `DP+GGAAYY+NNNN` (istemci kodu yok sayılır).
      autoCode: { series: "warehouse" },
    });
  }

  /** Varsayılan depo pasife ALINAMAZ (kural cevapsız kalır). */
  async update(id: string, data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    if (data.isActive === false) {
      const w = await prisma.warehouse.findUnique({ where: { id }, select: { isDefault: true, name: true } });
      if (w?.isDefault) {
        throw AppError.conflict(
          `"${w.name}" VARSAYILAN depodur — pasife alınamaz. Önce başka bir depoyu varsayılan yapın.`,
        );
      }
    }
    return super.update(id, data, userId);
  }

  /** Soft-delete de pasifleştirmedir → aynı guard (controller.remove buraya gelir). */
  async softDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const w = await prisma.warehouse.findUnique({ where: { id }, select: { isDefault: true, name: true } });
    if (w?.isDefault) {
      throw AppError.conflict(
        `"${w.name}" VARSAYILAN depodur — silinemez. Önce başka bir depoyu varsayılan yapın.`,
      );
    }
    return super.softDelete(id, userId);
  }

  /**
   * Kalıcı silme — varsayılan depo ve İÇİNDE KAYIT OLAN depo engellenir.
   *
   * DB'de `rolls_warehouseId_fkey` zaten RESTRICT (silme P2003 ile düşer); bu guard
   * kullanıcıya HAM veritabanı hatası yerine ne olduğunu söyleyen mesajı verir ve
   * sayıları listeler (kök CLAUDE.md: "X kayıt etkilenecek" gibi soyut sayı yetmez).
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const existing = await prisma.warehouse.findUnique({
      where: { id },
      select: { id: true, name: true, isDefault: true },
    });
    if (!existing) return { success: false, data: null, message: "Depo bulunamadı" };
    if (existing.isDefault) {
      throw AppError.conflict(`"${existing.name}" VARSAYILAN depodur — kalıcı silinemez.`);
    }

    const [rollCount, receiptCount, transferFromCount, transferToCount, movementCount] = await Promise.all([
      prisma.roll.count({ where: { warehouseId: id } }),
      prisma.goodsReceipt.count({ where: { warehouseId: id } }),
      prisma.warehouseTransfer.count({ where: { fromWarehouseId: id } }),
      prisma.warehouseTransfer.count({ where: { toWarehouseId: id } }),
      prisma.warehouseMovement.count({
        where: { OR: [{ fromWarehouseId: id }, { toWarehouseId: id }] },
      }),
    ]);

    const blockers: string[] = [];
    if (rollCount > 0) blockers.push(`${rollCount} top`);
    if (receiptCount > 0) blockers.push(`${receiptCount} mal kabul fişi`);
    const transferCount = transferFromCount + transferToCount;
    if (transferCount > 0) blockers.push(`${transferCount} transfer`);
    if (movementCount > 0) blockers.push(`${movementCount} depo hareketi`);

    if (blockers.length > 0) {
      throw AppError.conflict(
        `Depoya bağlı kayıtlar var (${blockers.join(", ")}) — kalıcı silinemez. Depoyu pasife alın.`,
      );
    }
    return super.hardDelete(id, userId);
  }

  /**
   * Varsayılan depoyu DEĞİŞTİR — tek tx: eskisini düşür, yenisini kaldır.
   *
   * ⚠️ İki adımı ayrı yazmak partial unique'e (`warehouses_isDefault_key`) çarpar:
   * yeni depoyu önce işaretlemek "iki varsayılan" anlamına gelir ve DB reddeder.
   * Sıra bu yüzden LOAD-BEARING: önce eskiyi düşür, sonra yeniyi işaretle.
   */
  async setDefault(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const target = await prisma.warehouse.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true, isDefault: true },
    });
    if (!target) throw AppError.notFound("Depo bulunamadı");
    if (!target.isActive) throw AppError.badRequest("Pasif depo varsayılan yapılamaz.");
    if (target.isDefault) return { success: true, data: target, message: "Bu depo zaten varsayılan." };

    await prisma.$transaction(async (tx) => {
      await tx.warehouse.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      await tx.warehouse.update({ where: { id }, data: { isDefault: true } });
    });

    const { AuditService } = await import("./audit.service");
    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WAREHOUSE",
      recordId: id,
      newData: { kind: "SET_DEFAULT_WAREHOUSE", name: target.name },
    });

    return { success: true, data: { id, name: target.name }, message: `"${target.name}" varsayılan depo yapıldı.` };
  }

  /**
   * DEPO HAREKET DÖKÜMÜ — cursor'lu, en yeniden eskiye.
   *
   * ⚠️ CURSOR, OFFSET DEĞİL: defter append-only ve yıllarca büyür; `skip`
   * kullanmak perf kuralı 5 ihlalidir (ayrıca `MAX_OFFSET=10000` seddine
   * çarpardı). Sıralama `createdAt desc, id desc` — `cursorWhere`ın tie-breaker
   * sözleşmesiyle birebir aynı olmak ZORUNDA, ayrışırsa sayfa sınırındaki
   * satırlar ya tekrarlanır ya sessizce atlanır.
   *
   * ⚠️ SÜZME SUNUCUDA. Döküm sayfalı olduğu için istemcide süzmek yalnız O ANKİ
   * SAYFAYI süzer ve kullanıcı "kayıt yok" sanır — oysa kayıt bir sonraki
   * sayfadadır (2026-08-12 top listesi filtresi dersi).
   *
   * ⚠️ `warehouseId` KOŞULU `OR`DUR (from VEYA to) ve bu yüzden koşullar
   * `AND` dizisinde toplanır: cursor koşulu da bir `OR` üretir, ikisini aynı
   * nesnenin kökünde tutmak İKİNCİSİNİN BİRİNCİYİ EZMESİ demekti — filtre
   * sessizce düşer ve liste "filtresizmiş gibi" döner (hata yok, log yok).
   *
   * ⚠️ İNDEX — ÖLÇÜLDÜ, YENİSİ EKLENMEDİ (perf kuralı 12 + 13). Bugünkü tabloda
   * (39 satır) planlayıcı Seq Scan seçiyor ve haklı; sorgu 0,05 ms. Mevcut
   * `[toWarehouseId, eventType, createdAt]` / `[fromWarehouseId, …]` çiftleri
   * OLAY TÜRÜ DE SEÇİLDİĞİNDE tam önek eşleşmesi verir. TETİKLEYİCİ: tür
   * seçilmeden yapılan depo dökümünde `createdAt` sıralaması index'ten
   * gelemiyor (aradaki `eventType` yüzünden) — `warehouse_movements` ~50k
   * satırı geçtiğinde bu sorguyu EXPLAIN'le; gerekirse `[toWarehouseId,
   * createdAt]` + `[fromWarehouseId, createdAt]` eklenir (vardiya dışında,
   * kural 14).
   */
  async listMovements(params: WarehouseMovementListParams): Promise<{
    success: true;
    data: unknown[];
    nextCursor: string | null;
  }> {
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));

    const and: Prisma.WarehouseMovementWhereInput[] = [];
    if (params.warehouseId) {
      and.push({
        OR: [{ fromWarehouseId: params.warehouseId }, { toWarehouseId: params.warehouseId }],
      });
    }
    if (params.eventType) and.push({ eventType: params.eventType });
    if (params.rollId) and.push({ rollId: params.rollId });
    if (params.sackId) and.push({ sackId: params.sackId });
    if (params.dateFrom || params.dateTo) {
      and.push({
        createdAt: {
          ...(params.dateFrom ? { gte: params.dateFrom } : {}),
          ...(params.dateTo ? { lte: params.dateTo } : {}),
        },
      });
    }
    const cur = decodeCursor(params.cursor);
    if (cur) and.push(cursorWhere(cur));

    const rows = await prisma.warehouseMovement.findMany({
      where: and.length > 0 ? { AND: and } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      // Perf kuralı 7 — `include` değil `select`: defter satırının kendisi
      // küçüktür, ilişkiler şişirir. Yalnız ekranda BASILAN alanlar çekilir.
      select: {
        id: true,
        eventType: true,
        qty: true,
        notes: true,
        createdAt: true,
        fromWarehouseId: true,
        toWarehouseId: true,
        fromWarehouse: { select: { id: true, code: true, name: true } },
        toWarehouse: { select: { id: true, code: true, name: true } },
        roll: {
          select: {
            id: true,
            barcode: true,
            width: true,
            item: { select: { id: true, name: true } },
            color: { select: { id: true, name: true } },
          },
        },
        sack: { select: { id: true, sackNo: true } },
        transfer: { select: { id: true, transferNo: true } },
        goodsReceipt: { select: { id: true, receiptNo: true } },
        shipment: { select: { id: true, shipmentNo: true } },
        rollReturn: { select: { id: true } },
        // TERS KAYIT BAĞI — "bu satır storno mudur" sorusunun TEK cevabı. Panel rozeti
        // bunu okur; olay tipi (`*_REVERSAL`) yalnız varsayılan tondur.
        reversesMovementId: true,
        // Sayım fark fişi / stornosu — "Belge" sütunu boş kalmasın (satırın kaynağı sayımdır).
        stockCount: { select: { id: true, countNo: true } },
        user: { select: { id: true, fullName: true, username: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      success: true,
      // Yön SUNUCUDA türetilir (dosya başlığı) — istemci `eventType`ten kendi
      // kuralını uydurmasın. `isReversal` de aynı sınıftır: tespit BAĞDAN gelir,
      // enum'dan değil (tasarım D2a) — iki kaynak olursa biri gün gelir yalan söyler.
      data: page.map((r) => ({
        ...r,
        direction: warehouseMovementDirection(r, params.warehouseId),
        isReversal: r.reversesMovementId !== null,
      })),
      nextCursor: hasMore ? buildNextCursor(page[page.length - 1]) : null,
    };
  }
}

export const warehouseService = new WarehouseService();
export default warehouseService;
