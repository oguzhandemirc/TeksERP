// =============================================================================
// MAL KABUL — satın alınan malın depoya girişi (üretimsiz stok girişi)
// =============================================================================
// Alım-satım kurulumunun ANA giriş kapısı: tedarikçiden gelen mal → depo → top
// satırları → barkod + etiket → WAREHOUSE. Üretici fabrikada bu akış kullanılmaz
// (mal KK1'den ham olarak girer ve rotaya sokulur).
//
// ⚠️ İKİNCİ BİR GİRİŞ MOTORU YAZILMAZ. Her satır `InventoryService.createInitialEntry`
// çağırır; mükerrer tuzağı (advisory lock), `clientToken` idempotency'si, barkod
// rezervasyonu, izinli renk/özellik doğrulaması ve etiket niyeti oradan BEDAVA
// gelir. Emsal: `tambur-manual.produceFinishedRoll` (o da iş emrisiz, hareketsiz,
// doğrudan depoya yazan bir sarmalayıcıdır).
//
// ⚠️ FİŞ BİR KAPTIR, ATOMİK BİR PAKET DEĞİL. `createInitialEntry` kendi
// transaction'ını açtığı için satırlar TEK tx'te toplanamaz; bu bilinçli olarak
// korunuyor çünkü tersi (tek dev tx) mükerrer tuzağının advisory kilidini fişin
// tamamı boyunca tutardı. Sonuç: bir satır düşerse diğerleri KALIR ve düşen satır
// somut sebebiyle döner (`failed[]`) — "10 top girildi" deyip 2'sini yutmak en
// kötü davranıştır (kurşun toplu dağıtım emsali).
// =============================================================================
import {
  GoodsReceiptStatus,
  ItemType,
  PriceKind,
  PrintedDocType,
  Prisma,
  PurchaseOrderStatus,
  RollEntrySource,
  RollStatus,
  YarnMovementKind,
} from "@prisma/client";
import { registerPrintedDocBuilder } from "./printed-document.service";
import { renderGoodsReceiptHtml, type GoodsReceiptDoc } from "./document-render/warehouse-doc.html";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { InventoryService } from "./inventory.service";
import { resolveItemPricesFor } from "./item-price.service";
import { applyYarnMovementTx, reverseGoodsReceiptYarnTx, yarnMovementSign } from "./yarn.service";
// Paket D3 — fiş bir ALIŞ SİPARİŞİNİ karşılayabilir. Bağ OPSİYONELDİR: sipariş
// bir PLANDIR, kabulün ön koşulu değil (siparişsiz mal kabulü meşru kalır).
import {
  PURCHASE_ORDER_LOCK_NS,
  syncPurchaseOrderSafely,
  type PurchaseOrderSyncResult,
} from "./purchase-order.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { buildWhereClause } from "../utils/query-parser";
import type { ApiResponse } from "../types/api.types";

const inventory = new InventoryService();

/** Fiş numarası ön eki — MK + GGAAYY + NNNN. */
const RECEIPT_PREFIX = "MK";

export interface GoodsReceiptLineInput {
  itemId: string;
  colorId?: string | null;
  initialQty: number;
  weightKg?: number | null;
  width?: number | null;
  qualityGrade?: string | null;
  foldType?: string | null;
  propertyIds?: string[];
  /** Satın alma BİRİM fiyatı (opsiyonel) — fişin para biriminde. Topa yazılır
   *  ve alış faturası satırının fiyatı ondan türer. Girilmezse fatura fiyatsız
   *  taslak doğar (onay zaten fiyatsızı reddediyor). */
  unitPrice?: number | null;
  /** Satır başına idempotency — ağ kopmasında yarım fiş mükerrer top doğurmaz. */
  clientToken?: string;
}

export interface GoodsReceiptCreateInput {
  warehouseId: string;
  supplierId?: string | null;
  deliveryNoteNo?: string | null;
  currency?: "TRY" | "USD" | "EUR" | "GBP" | "RUB";
  notes?: string | null;
  clientToken?: string;
  /** Bu fişin karşıladığı ALIŞ SİPARİŞİ (opsiyonel — D3). */
  purchaseOrderId?: string | null;
  lines?: GoodsReceiptLineInput[];
}

interface LineFailure {
  index: number;
  itemId: string;
  reason: string;
}

/**
 * Kabul satırının sonucu — TOP mu, İPLİK mi.
 *
 * ⚠️ İkisi TEK sayaçta toplanmaz: "12 top girildi" deyip 5'inin aslında kg
 * iplik olduğunu yutmak, operatörün fişi kâğıtla karşılaştırmasını imkânsız
 * yapardı. Sayaçlar ayrı, mesajlar ayrı.
 */
export interface AddLinesResult {
  /** Doğan `Roll` id'leri (kumaş/konfeksiyon satırları). */
  created: string[];
  /** Doğan `YarnMovement` id'leri (iplik satırları). */
  createdYarn: string[];
  failed: LineFailure[];
  /**
   * D3 — fiş bir alış siparişine bağlıysa satırlardan SONRA koşan karşılanma
   * senkronunun sonucu. Sipariş bağı yoksa `null`; alan OPSİYONEL çünkü mevcut
   * çağıranlar (üretici fabrika akışı) bunu hiç okumaz ve okumamalı.
   */
  purchaseOrder?: PurchaseOrderSyncResult | null;
}

async function nextReceiptNo(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const prefix = dailyCodePrefix(RECEIPT_PREFIX, now);
  const rows = await tx.goodsReceipt.findMany({
    where: { receiptNo: { gte: prefix, startsWith: prefix } },
    select: { receiptNo: true },
  });
  return buildDailyCode(RECEIPT_PREFIX, nextDailySeq(rows.map((r) => r.receiptNo), prefix), now);
}

/**
 * Kullanıcı mesajı için satır özeti.
 *
 * ⚠️ İplik yokken çıktı ESKİSİYLE BİREBİR ("N top") — kumaş fişinin mesajı bu
 * özellik yüzünden değişmemeli.
 */
function describeLineResult(r: AddLinesResult): string {
  const parts = [`${r.created.length} top`];
  if (r.createdYarn.length > 0) parts.push(`${r.createdYarn.length} iplik kalemi`);
  return parts.join(" + ");
}

/**
 * D3 — FAZLA KABUL UYARISI (mesaj kuyruğu).
 *
 * ⚠️ Fazla mal REDDEDİLMEZ (kayıt gerçeği yazar) ama YUTULMAZ da: sipariş
 * kalemi ısmarlanandan fazlasını aldıysa depocu bunu FİŞİ KAPATIRKEN görmeli,
 * ay sonunda faturayla karşılaştırırken değil. Sipariş bağı yoksa / fazla yoksa
 * BOŞ string döner → mevcut mesajlar bayt-bayt korunur.
 */
export function describeOverReceipt(sync: PurchaseOrderSyncResult | null | undefined): string {
  if (!sync) return "";
  const parts: string[] = [];
  if (sync.overReceiptLines.length > 0) {
    parts.push(`${sync.overReceiptLines.length} kalemde sipariş miktarı AŞILDI (kalem ${sync.overReceiptLines.join(", ")})`);
  }
  // ⚠️ Siparişte HİÇ olmayan ürün: mal depoya girdi ve kaydı doğru, ama hiçbir
  // sipariş kalemine yazılamadı — en olası sebep açılır listeden YANLIŞ
  // siparişin seçilmesidir. Sessizce düşürmek, karşılanma rakamını sebebi
  // söylenmeden eksik bırakırdı.
  if (sync.unmatchedItemIds.length > 0) {
    parts.push(`${sync.unmatchedItemIds.length} ürün bu siparişte YOK (yanlış sipariş seçilmiş olabilir)`);
  }
  return parts.length > 0 ? ` ⚠ ${sync.orderNo}: ${parts.join("; ")}.` : "";
}

export class GoodsReceiptService {
  /**
   * Fiş açar; `lines` verilmişse satırları da işler.
   *
   * Depo ZORUNLU ve AÇIK verilir — mal kabulde "hangi depoya" sorusunun sessiz bir
   * varsayılanı olamaz (tek depolu kurulumda arayüz onu otomatik seçer, kullanıcıya
   * sormaz; sözleşme yine de açıktır).
   */
  async create(input: GoodsReceiptCreateInput, userId?: string): Promise<ApiResponse<unknown>> {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: input.warehouseId },
      select: { id: true, name: true, isActive: true },
    });
    if (!warehouse) throw AppError.badRequest("Depo bulunamadı.");
    if (!warehouse.isActive) throw AppError.badRequest(`"${warehouse.name}" deposu pasif — mal bu depoya alınamaz.`);

    if (input.supplierId) {
      const sup = await prisma.customer.findUnique({
        where: { id: input.supplierId },
        select: { id: true, name: true, isActive: true },
      });
      if (!sup) throw AppError.badRequest("Tedarikçi bulunamadı.");
      if (!sup.isActive) throw AppError.badRequest(`"${sup.name}" pasif durumda.`);
    }

    // İdempotent tekrar: aynı fiş iki kez açılmaz (ağ kopması / çift tıklama).
    if (input.clientToken) {
      const dupe = await prisma.goodsReceipt.findUnique({
        where: { clientToken: input.clientToken },
        select: { id: true, receiptNo: true },
      });
      if (dupe) {
        return {
          success: true,
          data: await this.loadDetail(dupe.id),
          message: `Bu fiş zaten açılmış (${dupe.receiptNo}).`,
        };
      }
    }

    const receipt = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        // ── D3: ALIŞ SİPARİŞİ BAĞI ────────────────────────────────────────
        // ⚠️ Doğrulama ve bağ yazımı AYNI TX'te ve ALIŞ SİPARİŞİNİN advisory
        // kilidi ALTINDA yapılır (`purchase-order.service.cancel` de aynı
        // kilidi alır). Aksi hâlde "kontrol ettim, iptal değildi" ile "fişi
        // bağladım" arasına bir iptal sızabilir ve fiş, iptal edilmiş bir
        // siparişi işaret ederek karşılanma raporundan sessizce düşerdi.
        // ⚠️ Kilit HER SORGUDAN ÖNCE alınır (TOCTOU dersi).
        let supplierId = input.supplierId ?? null;
        if (input.purchaseOrderId) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PURCHASE_ORDER_LOCK_NS}::int, hashtext(${input.purchaseOrderId}))`;
          const po = await tx.purchaseOrder.findUnique({
            where: { id: input.purchaseOrderId },
            select: { id: true, orderNo: true, status: true, supplierId: true },
          });
          if (!po) throw AppError.badRequest("Alış siparişi bulunamadı.");
          if (po.status === PurchaseOrderStatus.CANCELLED) {
            throw AppError.conflict(`${po.orderNo} iptal edilmiş — bu siparişe mal kabul yapılamaz.`);
          }
          // Tedarikçi ÇELİŞKİSİ sessizce çözülmez: hangisinin doğru olduğunu
          // yalnız operatör bilir ve yanlış tarafa yazmak alış faturası
          // mutabakatını yanlış cariye bağlardı.
          if (supplierId && supplierId !== po.supplierId) {
            throw AppError.badRequest(
              `Fişteki tedarikçi ${po.orderNo} siparişinin tedarikçisiyle aynı değil — birini düzeltin.`,
            );
          }
          // Fişte tedarikçi seçilmemişse siparişten MİRAS ALINIR: alış faturası
          // tedarikçisiz fişten kesilemiyor ve bilgi zaten elimizde.
          supplierId = supplierId ?? po.supplierId;
        }

        const receiptNo = await nextReceiptNo(tx);
        return tx.goodsReceipt.create({
          data: {
            receiptNo,
            warehouseId: input.warehouseId,
            supplierId,
            deliveryNoteNo: input.deliveryNoteNo?.trim() || null,
            currency: input.currency ?? "TRY",
            notes: input.notes?.trim() || null,
            clientToken: input.clientToken ?? null,
            purchaseOrderId: input.purchaseOrderId ?? null,
            createdById: userId ?? null,
          },
          select: { id: true, receiptNo: true },
        });
      }),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "GOODS_RECEIPT",
      recordId: receipt.id,
      newData: { receiptNo: receipt.receiptNo, warehouseId: input.warehouseId, supplierId: input.supplierId ?? null },
    });

    const lineResult: AddLinesResult = input.lines?.length
      ? await this.addLines(receipt.id, input.lines, userId)
      : { created: [], createdYarn: [], failed: [], purchaseOrder: null };

    return {
      success: true,
      data: { ...(await this.loadDetail(receipt.id)), failed: lineResult.failed, purchaseOrder: lineResult.purchaseOrder ?? null },
      message:
        (lineResult.failed.length > 0
          ? `${receipt.receiptNo}: ${describeLineResult(lineResult)} girildi, ${lineResult.failed.length} satır atlandı.`
          : `${receipt.receiptNo} oluşturuldu (${describeLineResult(lineResult)}).`) +
        describeOverReceipt(lineResult.purchaseOrder),
    };
  }

  /**
   * Fişe top ekler. Her satır kendi transaction'ında doğar (yukarıdaki "fiş bir
   * kaptır" notu); düşen satır `failed[]` içinde SEBEBİYLE döner.
   */
  async addLines(receiptId: string, lines: GoodsReceiptLineInput[], userId?: string): Promise<AddLinesResult> {
    const receipt = await prisma.goodsReceipt.findUnique({
      where: { id: receiptId },
      // ⚠️ `supplierId` + `currency` fiyat ÖN-DOLUMU (D2) için okunur: fiyat
      // (kalem × cari × yön × para birimi) DÖRT boyutludur; üçünü bilmeden
      // sorulan soru yanlış satırı bulur.
      select: {
        id: true,
        receiptNo: true,
        status: true,
        warehouseId: true,
        supplierId: true,
        currency: true,
        // D3 — satırlardan sonra alış siparişinin karşılanması tazelenir.
        purchaseOrderId: true,
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul fişi bulunamadı.");
    if (receipt.status === GoodsReceiptStatus.CANCELLED) {
      throw AppError.conflict(`${receipt.receiptNo} iptal edilmiş — satır eklenemez.`);
    }

    // ── FİYAT ÖN-DOLUMU (D2) ────────────────────────────────────────────────
    // ⚠️ ASLA EZMEZ: yalnız `unitPrice` HİÇ GÖNDERİLMEMİŞ (`null`/`undefined`)
    // satırlar için çözülür. `unitPrice: 0` depocunun BİLİNÇLİ girdisidir
    // (bedava numune) ve üstüne yazmak, yazdığını sessizce değiştirmek olurdu.
    // ⚠️ Çözülemezse alan BOŞ KALIR, sıfıra DÜŞMEZ — "fiyat bilinmiyor" ile
    // "bedava" aynı şey değildir.
    // ⚠️ TEK sorgu: 500 satırlık fişte satır başına lookup perf kuralı 7/9
    // ihlali olurdu. HER satırda fiyat AÇIKÇA girilmişse sorgu hiç koşmaz; ama
    // olağan durum tersidir (depocu fiyat yazmaz) → fiş başına BİR ek sorgu
    // vardır. "Sıfır ek maliyet" DEĞİL, "satır sayısından bağımsız tek sorgu".
    // Fiyat satırı olmayan kurulumda sorgu boş küme döner ve ön-dolum yapılmaz.
    const priceNeeded = [...new Set(lines.filter((l) => l.unitPrice == null).map((l) => l.itemId))];
    const priceMap =
      priceNeeded.length > 0
        ? await resolveItemPricesFor({
            itemIds: priceNeeded,
            kind: PriceKind.PURCHASE,
            currency: receipt.currency,
            customerId: receipt.supplierId,
          })
        : null;
    const priceFor = (line: GoodsReceiptLineInput): Prisma.Decimal.Value | null =>
      line.unitPrice ?? priceMap?.get(line.itemId)?.price ?? null;

    // Kalem TÜRLERİ TEK sorguda okunur (N+1 yok — 500 satırlık fişte satır
    // başına lookup perf kuralı 7/9 ihlali olurdu). Bulunamayan kalem burada
    // ELENMEZ: hata üretmeyi `createInitialEntry`'ye bırakırız ki mevcut
    // `failed[]` mesajı bayt-bayt aynı kalsın.
    //
    // ⚠️ `isActive` DE OKUNUR ve iplik dalında ARANIR. Kumaş yolunda pasif
    // kalemi `createInitialEntry` zaten reddediyor ("Ürün bulunamadı veya
    // pasif"); iplik dalı onu atladığı için AYNI fişte pasif bir kalem
    // kumaşsa reddediliyor, iplikse SESSİZCE deftere yazılıyordu — üstelik
    // `POST /api/yarn/movements` aynı kalemi reddederken. Aynı verinin iki
    // kapısı farklı cevap veriyorsa hangisinin doğru olduğu sorulamaz.
    const itemInfo = new Map<string, { itemType: ItemType; isActive: boolean; name: string }>();
    const ids = [...new Set(lines.map((l) => l.itemId))];
    if (ids.length > 0) {
      const rows = await prisma.item.findMany({
        where: { id: { in: ids } },
        select: { id: true, itemType: true, isActive: true, name: true },
      });
      for (const r of rows) itemInfo.set(r.id, { itemType: r.itemType, isActive: r.isActive, name: r.name });
    }

    const created: string[] = [];
    const createdYarn: string[] = [];
    const failed: LineFailure[] = [];

    for (const [index, line] of lines.entries()) {
      try {
        // ── İPLİK DALI ────────────────────────────────────────────────────
        // İplik `Roll` DOĞURMAZ: top metreyle/barkodla tek tek izlenir, iplik
        // kg ile ve toplu izlenir. Aynı satırdan hem `Roll` hem `YarnMovement`
        // doğurmak aynı malı İKİ KEZ saydırırdı.
        const info = itemInfo.get(line.itemId);
        if (info?.itemType === ItemType.YARN) {
          // Pasif kalem: kumaş yolundaki `createInitialEntry` guard'ının ikizi.
          // Mesaj bilerek o yolla AYNI cümleyi kurar — operatör aynı hatayı
          // fişin iki farklı satırında iki farklı şekilde okumasın.
          if (!info.isActive) throw AppError.notFound("Ürün bulunamadı veya pasif (silinmiş)");
          createdYarn.push(await this.addYarnLine(receipt, line, userId));
          continue;
        }

        const res = await inventory.createInitialEntry(
          {
            itemId: line.itemId,
            colorId: line.colorId ?? null,
            initialQty: line.initialQty,
            weightKg: line.weightKg ?? undefined,
            width: line.width ?? undefined,
            qualityGrade: line.qualityGrade ?? undefined,
            propertyIds: line.propertyIds,
            clientToken: line.clientToken,
          },
          userId,
          null,
          false,
          {
            // Satın alınan mal ÜRETİME girmez → doğrudan satılabilir depoya.
            forcedStatus: RollStatus.WAREHOUSE,
            forcedEntrySource: RollEntrySource.PURCHASE_RECEIPT,
            warehouseId: receipt.warehouseId,
            goodsReceiptId: receipt.id,
            foldType: line.foldType ?? null,
            // Fiyat ÖN-DOLUMU: satırın kendi fiyatı KAZANIR; yoksa kalem
            // kartının alış fiyatı (tedarikçi istisnası > kart varsayılanı)
            // uygulanır; o da yoksa NULL kalır.
            purchasePrice: priceFor(line),
            // Mal kabulde istasyon YOK (üretim noktası değil) — kolon NULL kalır.
            entryStationId: null,
          },
        );
        created.push((res.data as { id: string }).id);
      } catch (err) {
        failed.push({
          index,
          itemId: line.itemId,
          reason: err instanceof Error ? err.message : "Bilinmeyen hata",
        });
      }
    }

    // ── D3: ALIŞ SİPARİŞİ KARŞILANMASI ────────────────────────────────────
    // ⚠️ SATIRLARDAN SONRA, kaynaktan yeniden hesapla. Satır satır `increment`
    // ATILMAZ: satırlar ayrı tx'lerde doğuyor ("fiş bir kaptır") ve düşen bir
    // satır sayacı yarım bırakırdı. Kaynak-temelli senkron ne olursa olsun
    // doğru sonucu yazar ve tekrar çağrılması zararsızdır (idempotent).
    // ⚠️ Sipariş bağı yoksa TEK SORGU BİLE koşmaz — üretici fabrikada bu satır
    // görünmez (`syncPurchaseOrderSafely` null'da hemen döner).
    const purchaseOrder = await syncPurchaseOrderSafely(receipt.purchaseOrderId);

    return { created, createdYarn, failed, purchaseOrder };
  }

  /**
   * İPLİK KABUL SATIRI — kg defterine `IN` yazar (fiş bağıyla).
   *
   * ⚠️ `initialQty` İPLİKTE KG'DİR. Fiş formunda tek bir "miktar" alanı vardır
   * ve birimi KALEMİN TÜRÜ belirler (kumaş → metre, iplik → kg). İkinci bir
   * alan icat etmek panelin iki ayrı satır tipi taşımasını gerektirirdi.
   *
   * ⚠️ ÇELİŞEN GİRDİ SESSİZCE SEÇİLMEZ, REDDEDİLİR: `weightKg` de gönderilmiş
   * ve miktardan farklıysa hangisinin doğru olduğunu yalnız operatör bilir —
   * birini seçmek defteri sessizce yanlışlardı. Aynı gerekçeyle kumaşa özgü
   * alanlar (renk/en/kalite/kat/özellik) iplikte reddedilir: `YarnStock`
   * (kalem × depo) onları TAŞIYAMAZ ve sessizce düşürülmeleri, operatöre
   * "boyalı ipliğim ayrı izleniyor" yalanını söylerdi. (Lot/renk kırılımı
   * gerektiğinde çözüm `YarnLot`tur, sessiz kabul değil.)
   */
  private async addYarnLine(
    receipt: { id: string; receiptNo: string; warehouseId: string },
    line: GoodsReceiptLineInput,
    userId?: string,
  ): Promise<string> {
    const qtyKg = new Prisma.Decimal(line.initialQty);
    if (line.weightKg != null && !new Prisma.Decimal(line.weightKg).equals(qtyKg)) {
      throw AppError.badRequest(
        `İplik satırında miktar (${qtyKg.toString()} kg) ile ağırlık (${line.weightKg} kg) çelişiyor. ` +
          `İplikte miktar zaten kg'dır — ağırlık alanını boş bırakın.`,
      );
    }

    const strays: string[] = [];
    if (line.colorId) strays.push("renk");
    if (line.width != null) strays.push("en");
    if (line.qualityGrade) strays.push("kalite");
    if (line.foldType) strays.push("kat");
    if (line.propertyIds?.length) strays.push("özellik");
    if (strays.length > 0) {
      throw AppError.badRequest(
        `İplik satırı ${strays.join(" / ")} taşıyamaz — iplik stoğu kalem × depo bazında kg olarak tutulur. ` +
          `Bu alanlar kumaş (top) satırlarına aittir.`,
      );
    }

    // ⚠️ FİYAT: iplik satırının birim fiyatını taşıyacak bir kolon ŞU AN YOK
    // (kumaşta fiyat `Roll.purchasePrice`'a yazılır ve alış faturası ondan
    // türer; `YarnMovement`in fiyat kolonu yok). Sessizce düşürmek, alış
    // faturasının o kalemi FİYATSIZ doğurması demekti; operatörün AÇIKÇA
    // yazdığı fiyat bu yüzden SEBEBİYLE reddedilir — susup yutmaktansa.
    // (D2 kart fiyatı ön-dolumu da iplikte taşınamaz; kolon eklenene kadar
    // fiyat alış faturasına elle girilir. Bkz. rapor: `YarnMovement.unitPrice`.)
    if (line.unitPrice != null) {
      throw AppError.badRequest(
        "İplik satırında birim fiyat henüz taşınmıyor (fiyatı taşıyacak kolon yok) — " +
          "satırı fiyatsız girin, alış faturasında fiyatı elle yazın.",
      );
    }

    const res = await prisma.$transaction((tx) =>
      applyYarnMovementTx(tx, {
        itemId: line.itemId,
        warehouseId: receipt.warehouseId,
        kind: YarnMovementKind.IN,
        qtyKg,
        goodsReceiptId: receipt.id,
        reason: `Mal kabul (${receipt.receiptNo})`,
        userId: userId ?? null,
      }),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "YARN_MOVEMENT",
      recordId: res.movementId,
      newData: {
        source: "GOODS_RECEIPT",
        receiptNo: receipt.receiptNo,
        itemId: line.itemId,
        warehouseId: receipt.warehouseId,
        kind: YarnMovementKind.IN,
        qtyKg: qtyKg.toString(),
        balanceAfter: res.balanceKg.toString(),
      },
    });

    return res.movementId;
  }

  /**
   * Fişi iptal eder: toplar `softDelete` ile CANCELLED olur (mal HİÇ girmedi
   * semantiği — `qtyOut=0` storno), fiş CANCELLED işaretlenir.
   *
   * ⚠️ SEVK EDİLMİŞ ya da BAŞKA İŞLEM GÖRMÜŞ top varsa fiş iptal EDİLMEZ: mal
   * gerçekten kullanılmış, "hiç girmedi" demek defteri yalanlar. Operatör önce
   * o topları ayıklamalı.
   */
  async cancel(id: string, reason: string | undefined, userId?: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.goodsReceipt.findUnique({
      where: { id },
      select: { id: true, receiptNo: true, status: true, purchaseOrderId: true },
    });
    if (!receipt) throw AppError.notFound("Mal kabul fişi bulunamadı.");
    if (receipt.status === GoodsReceiptStatus.CANCELLED) {
      return { success: true, data: receipt, message: `${receipt.receiptNo} zaten iptal edilmiş.` };
    }

    const rolls = await prisma.roll.findMany({
      where: { goodsReceiptId: id },
      select: { id: true, barcode: true, status: true },
    });

    // Guard: iptal yalnız "mal hiç kullanılmadı" iken meşru.
    const used = rolls.filter(
      (r) => r.status !== RollStatus.WAREHOUSE && r.status !== RollStatus.A1_STOCK && r.status !== RollStatus.CANCELLED,
    );
    if (used.length > 0) {
      const sample = used.slice(0, 5).map((r) => `${r.barcode ?? r.id.slice(0, 8)} (${r.status})`).join(", ");
      throw AppError.conflict(
        `${receipt.receiptNo}: ${used.length} top işlem görmüş (${sample}${used.length > 5 ? "…" : ""}) — fiş iptal edilemez. ` +
          `Önce o topları ayıklayın.`,
      );
    }

    // ⚠️ CLAIM ile İPLİK STORNOSU AYNI TX'TE.
    // Claim atomiktir (iki paralel iptalden yalnız biri geçer) ve ters kayıt
    // ONA BAĞLI: ayrı tx'lerde koşsalardı fiş CANCELLED olur, aradaki bir
    // çökmede iplik depoda kalırdı — bakiye sessizce şişer. Toplar hâlâ dışarıda
    // iptal edilir (`softDelete` kendi tx'ini açıyor, değiştirilmedi).
    //
    // ⚠️ KUMAŞ-ONLY FİŞTE DAVRANIŞ AYNI: ters kayıt fonksiyonu indeksli
    // `goodsReceiptId` üzerinden 0 satır okur ve HİÇBİR ŞEY yazmaz.
    const yarnReversal = await prisma.$transaction(async (tx) => {
      const claim = await tx.goodsReceipt.updateMany({
        where: { id, status: GoodsReceiptStatus.ACTIVE },
        data: {
          status: GoodsReceiptStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason?.trim() || null,
        },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Fiş bu sırada başka bir işleme girdi — yenileyip tekrar deneyin.");
      }
      return reverseGoodsReceiptYarnTx(
        tx,
        id,
        reason?.trim() || `Mal kabul fişi iptali (${receipt.receiptNo})`,
        userId ?? null,
      );
    });

    // Eksi bakiye ENGEL DEĞİL: iplik fişten sonra sarf edilmiş olabilir ve
    // iptali reddetmek defteri değil yalnız ekranı düzeltirdi. Ama SÖYLENİR.
    const yarnNegative = yarnReversal.filter((y) => y.balanceKg.lt(0));

    // Toplar tek tek iptal edilir (`softDelete` kendi tx'ini açar + kendi
    // guard'larını koşar — ölü etiket onayı dahil).
    const cancelled: string[] = [];
    const skipped: LineFailure[] = [];
    for (const [index, r] of rolls.entries()) {
      if (r.status === RollStatus.CANCELLED) continue;
      try {
        await inventory.softDelete(r.id, userId, {
          confirmActive: true,
          confirmLabelPrinted: true,
          reason: reason?.trim() || `Mal kabul fişi iptali (${receipt.receiptNo})`,
        });
        cancelled.push(r.id);
      } catch (err) {
        skipped.push({ index, itemId: r.id, reason: err instanceof Error ? err.message : "Bilinmeyen hata" });
      }
    }

    // ── D3: ALIŞ SİPARİŞİ KARŞILANMASI GERİ DÜŞER ─────────────────────────
    // ⚠️ TOPLAR İPTAL EDİLDİKTEN SONRA çalışır, önce değil: senkron kaynağı
    // (iptal edilmemiş toplar) okur; erken koşarsa henüz iptal edilmemiş
    // topları hâlâ "gelmiş" sayardı. Fişin kendisi zaten CANCELLED olduğu için
    // toplam sıfırlanır, sipariş OPEN'a döner ve yeniden kabule açılır.
    // ⚠️ `syncPurchaseOrderSafely` hatayı YUTAR — mal kabul iptali fiziksel bir
    // gerçeği kaydeder ve bir rapor rakamı yüzünden geri alınmamalıdır; rollup
    // bir sonraki senkronda kendini onarır.
    const poSync = await syncPurchaseOrderSafely(receipt.purchaseOrderId);

    void AuditService.log({
      userId,
      action: "DELETE",
      tableName: "GOODS_RECEIPT",
      recordId: id,
      newData: {
        kind: "CANCEL",
        receiptNo: receipt.receiptNo,
        cancelledRolls: cancelled.length,
        skipped: skipped.length,
        reason: reason ?? null,
        yarnReversed: yarnReversal.map((y) => ({ itemId: y.itemId, warehouseId: y.warehouseId, qtyKg: y.qtyKg.toString() })),
        purchaseOrderId: receipt.purchaseOrderId ?? null,
        purchaseOrderStatus: poSync?.status ?? null,
      },
    });

    const yarnNote =
      yarnReversal.length > 0
        ? ` ${yarnReversal.length} iplik kalemi ters kayıtla düşüldü.${
            yarnNegative.length > 0 ? ` ⚠️ ${yarnNegative.length} kalemde bakiye eksiye düştü (mal fişten sonra sarf edilmiş olabilir).` : ""
          }`
        : "";

    return {
      success: true,
      data: {
        id,
        receiptNo: receipt.receiptNo,
        cancelledRolls: cancelled.length,
        skipped,
        yarnReversed: yarnReversal.map((y) => ({
          itemId: y.itemId,
          warehouseId: y.warehouseId,
          qtyKg: y.qtyKg.toString(),
          balanceKg: y.balanceKg.toString(),
        })),
      },
      message:
        (skipped.length > 0
          ? `${receipt.receiptNo} iptal edildi; ${cancelled.length} top düşürüldü, ${skipped.length} top atlandı.`
          : `${receipt.receiptNo} iptal edildi (${cancelled.length} top).`) + yarnNote,
    };
  }

  /**
   * Fiş listesi (sayfalı). Sorgu SERVİSTE — route/controller katmanında prisma
   * import'u yasak (CLAUDE.md katman kuralı; ESLint bunu mekanik olarak kapatıyor).
   */
  async list(params: {
    page: number;
    pageSize: number;
    filters: Record<string, string | string[]>;
    search?: string;
  }): Promise<{ rows: unknown[]; total: number }> {
    const where = buildWhereClause(params.filters, ["receiptNo", "deliveryNoteNo", "notes"], params.search);
    const [rows, total] = await Promise.all([
      prisma.goodsReceipt.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: {
          id: true,
          receiptNo: true,
          status: true,
          deliveryNoteNo: true,
          createdAt: true,
          cancelledAt: true,
          warehouse: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          _count: { select: { rolls: true } },
        },
      }),
      prisma.goodsReceipt.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * Fiş detayı — başlık + toplar + iplik satırları.
   *
   * ⚠️ İPLİK SATIRLARI BURADA GÖRÜNMEK ZORUNDA: iplik `Roll` doğurmadığı için,
   * yalnız `rolls` dönseydi 500 kg iplik alınan fiş ekranda BOŞ görünürdü ve
   * depocu "kaydedilmemiş" sanıp ikinci kez girerdi. `yarnLines` EK bir
   * anahtardır — mevcut alanların hiçbiri değişmedi (kumaş fişi bayt-bayt aynı).
   */
  async loadDetail(id: string): Promise<Record<string, unknown>> {
    const receipt = await prisma.goodsReceipt.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        supplier: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true, username: true } },
        // D3 — bağlı alış siparişinin başlığı (fişten siparişe tıkla-git).
        purchaseOrder: { select: { id: true, orderNo: true, status: true, currency: true, expectedDate: true } },
        // Bu fişin doğurduğu iplik hareketleri — ters kayıtlar (iptal) DAHİL,
        // çünkü defter görünümü "ne oldu"yu anlatır, "ne kaldı"yı değil.
        yarnMovements: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            kind: true,
            qtyKg: true,
            reason: true,
            createdAt: true,
            item: { select: { id: true, name: true, code: true } },
            warehouse: { select: { id: true, name: true } },
          },
        },
        rolls: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            barcode: true,
            status: true,
            currentQty: true,
            initialQty: true,
            width: true,
            weightKg: true,
            item: { select: { id: true, name: true, code: true } },
            color: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul fişi bulunamadı.");

    const totalQty = receipt.rolls
      .filter((r) => r.status !== RollStatus.CANCELLED)
      .reduce((s, r) => s.plus(r.currentQty), new Prisma.Decimal(0));

    // İplik NET kg — ters kayıtlar düşülür. ⚠️ Metrajla TOPLANMAZ: 100 metre
    // kumaş ile 100 kg iplik farklı birimlerdir ve tek sayıya indirmek
    // anlamsız bir "toplam" üretirdi.
    const totalYarnKg = receipt.yarnMovements.reduce(
      (s, m) => s.plus(new Prisma.Decimal(m.qtyKg).mul(yarnMovementSign(m.kind))),
      new Prisma.Decimal(0),
    );

    return {
      ...receipt,
      totals: {
        rollCount: receipt.rolls.filter((r) => r.status !== RollStatus.CANCELLED).length,
        totalQty: Number(totalQty),
        yarnLineCount: receipt.yarnMovements.length,
        totalYarnKg: Number(totalYarnKg),
      },
    };
  }
}

export const goodsReceiptService = new GoodsReceiptService();
export default goodsReceiptService;

// =============================================================================
// DONMUŞ BELGE — Mal Kabul Fişi
// =============================================================================
// ⚠️ TRANSFERDEN FARKLI OLARAK BELGE İLK BASKIDA (lazy-init) DONAR, fiş açılışında
// DEĞİL. Sebep: fiş bir KAPTIR — mal parça parça gelir ve satırlar sonradan
// eklenir (`POST /:id/lines`). Açılışta dondurmak, içi BOŞ bir resmi belge
// üretirdi. `getCurrent`in lazy-init yolu ilk baskıda o anki içeriği dondurur.
//
// İptal edilmiş fişin belgesi İPTAL filigranıyla basılır (`voidInfo`) — kâğıt
// sahada dolaşmış olabilir, kaydı yok sayılmaz.
registerPrintedDocBuilder(PrintedDocType.GOODS_RECEIPT, {
  fresh: async (db, sourceId) => {
    const r = await db.goodsReceipt.findUnique({
      where: { id: sourceId },
      select: {
        receiptNo: true, createdAt: true, notes: true, deliveryNoteNo: true,
        status: true, cancelledAt: true, cancelReason: true,
        warehouse: { select: { name: true, code: true } },
        supplier: { select: { name: true, code: true } },
        createdBy: { select: { fullName: true, username: true } },
        rolls: {
          orderBy: { createdAt: "asc" },
          select: {
            barcode: true, currentQty: true, width: true, status: true,
            item: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
      },
    });
    if (!r) return null;

    const doc: GoodsReceiptDoc = {
      header: {
        documentNo: r.receiptNo,
        date: r.createdAt.toISOString(),
        warehouseName: r.warehouse.name,
        warehouseCode: r.warehouse.code,
        supplierName: r.supplier?.name ?? null,
        supplierCode: r.supplier?.code ?? null,
        deliveryNoteNo: r.deliveryNoteNo,
        createdBy: r.createdBy?.fullName ?? r.createdBy?.username ?? null,
      },
      // İPTAL EDİLMİŞ top belgede GÖRÜNMEZ: fiş "bu mal girdi" der; iptal edilen
      // satır girmemiş sayılır (softDelete = qtyOut 0 stornosu ile aynı semantik).
      lines: r.rolls
        .filter((x) => x.status !== RollStatus.CANCELLED)
        .map((x) => ({
          barcode: x.barcode,
          itemName: x.item.name,
          colorName: x.color?.name ?? null,
          width: x.width != null ? Number(x.width) : null,
          qty: Number(x.currentQty),
        })),
      notes: r.notes,
    };

    return {
      documentNo: r.receiptNo,
      doc: doc as unknown as Record<string, unknown>,
      // Fiş iptal edilmişken ilk kez basılıyorsa belge doğrudan VOIDED doğar.
      voidInfo:
        r.status === GoodsReceiptStatus.CANCELLED
          ? { reason: r.cancelReason, at: r.cancelledAt ?? new Date() }
          : null,
    };
  },
  renderHtml: renderGoodsReceiptHtml,
});
