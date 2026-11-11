// =============================================================================
// TeksERP - Order Service (extends BaseService)
// =============================================================================
// Overrides:
//   - create: auto-generates orderNumber as SIP+GGAAYY+NNNN
//   - softDelete: sets status = CANCELLED (Order has no isActive field)
//                 + iş emri bağlarını güvenli şekilde çözer (R1)
// Bölme (2026-11-08, davranış aynı): bu dosya CEPHEDİR — sınıf, dışa açık adlar ve
// metot imzaları burada; gövdeler `services/order/*.ts` alan modüllerinde
// kelimesi kelimesine durur (cephe metodu modül fonksiyonunu `this` bağlamıyla çağırır).
// Çağıranlar yalnız bu yoldan import eder; alan modülleri cepheyi yalnız TİP olarak okur.
// =============================================================================

import { assertCariNotHeldTx } from "./helpers/cari-hold.helper";
import { assertCustomerRiskLimitTx, customerRiskLimitIntakeWarningTx, riskLimitIntakeWarningText } from "./helpers/risk-exposure.helper";
import prisma from "../lib/prisma";
import { setWorkOrderTypeTx } from "./helpers/workorder-event.helper";
import type { ItemUnit } from "@prisma/client";
import { AuditService } from "./audit.service";
import { BaseService, BaseServiceConfig, CursorPaginatedResponse } from "./base.service";
import { ApiResponse, PaginatedResponse, QueryParams } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { type TokenReplay } from "./helpers/token-replay.helper";
import { resolveShipmentDestination } from "./helpers/shipment-destination.helper";
import {
  OrderStatus,
  Prisma,
  ReasonPresetKind,
  RollStatus,
  ShipmentStatus,
  WorkOrderStatus,
  WorkOrderType,
} from "@prisma/client";
import { resolveReasonCode } from "./reason-preset.service";
import {
  recomputeOrderStatusTx,
} from "./helpers/order-status.helper";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { markTravelerCardDirtyTx } from "./helpers/traveler-card-dirty.helper";
import { assertColorsAssignableToCustomer } from "./helpers/color-assignment.helper";
import { CustomerAliasService } from "./customer-alias.service";
import {
  assertNoBareFilterParams,
} from "../utils/query-parser";
import {
  withOrderWhere,
} from "./helpers/order-where.helper";
import {
  ORDER_WHERE_FILTER_KEYS,
} from "./helpers/order-where-filter.helper";
import { Request } from "express";
import { diffFields } from "./helpers/audit-diff.helper";
import { ACTIVE_ORDER_LINK, activeOrderLinkCount, unlinkOrderLinesTx, withActiveOrderLinks } from "./helpers/order-link.helper";
import { runItemUsageChecksTx, type ItemUsageCheck } from "./helpers/item-usage.helper";
import {
  lineTargetValuesNestedCreate,
  preparedTargetValues,
  targetSetChanged,
} from "./helpers/order-line-target-value.helper";
import { TERIM } from "../constants/terim";
import { gateOrderWhereFilters as gateOrderWhereFiltersImpl, extraWhere as extraWhereImpl, getOrderStats as getOrderStatsImpl } from "./order/list";
import { getOrderWhereDetail as getOrderWhereDetailImpl } from "./order/where-detail";
import { loadLineForCancel as loadLineForCancelImpl, getLineCancelPreview as getLineCancelPreviewImpl, cancelOrderLine as cancelOrderLineImpl } from "./order/line-cancel";
import { promoteCustomerAliases as promoteCustomerAliasesImpl, kumasaOzelRenkCiftleri as kumasaOzelRenkCiftleriImpl } from "./order/aliases";
import { validateLines as validateLinesImpl, validateLineColors as validateLineColorsImpl, validateLineItems as validateLineItemsImpl, prepareLineVariants as prepareLineVariantsImpl, assertLineRefsLive as assertLineRefsLiveImpl, resolveLineUnit as resolveLineUnitImpl, withUnitWarnings as withUnitWarningsImpl, validateBranch as validateBranchImpl, validateCustomer as validateCustomerImpl, assertValidCurrency as assertValidCurrencyImpl, assertDeadlineNotBeforeOrderDate as assertDeadlineNotBeforeOrderDateImpl } from "./order/validation";
import { findAvailableForWorkOrder as findAvailableForWorkOrderImpl, findAvailableOrderLines as findAvailableOrderLinesImpl, computeInProdBySpec as computeInProdBySpecImpl } from "./order/available";
import { getCoverageForLines as getCoverageForLinesImpl, getSpecAvailability as getSpecAvailabilityImpl } from "./order/coverage";
import { withResolvedColorNames as withResolvedColorNamesImpl, getOrderShipments as getOrderShipmentsImpl } from "./order/detail";
import { create as createImpl, finishOrderCreate as finishOrderCreateImpl, prepareOrderCreate as prepareOrderCreateImpl, insertPreparedOrder as insertPreparedOrderImpl, insertPreparedOrderTx as insertPreparedOrderTxImpl, nextOrderNumber as nextOrderNumberImpl, insertOrderTx as insertOrderTxImpl, findOrderByToken as findOrderByTokenImpl, orderReplay as orderReplayImpl } from "./order/create";
import { quickOrderFromRolls as quickOrderFromRollsImpl, quickOrderTx as quickOrderTxImpl, quickOrderReplay as quickOrderReplayImpl } from "./order/quick-order";
import { changeLineColor as changeLineColorImpl } from "./order/line-color";
import { getActiveShipmentLinks as getActiveShipmentLinksImpl, assertNoActiveShipments as assertNoActiveShipmentsImpl, hardDelete as hardDeleteImpl, softDelete as softDeleteImpl } from "./order/lifecycle";
import { getCancelPreview as getCancelPreviewImpl } from "./order/cancel";
import { manualComplete as manualCompleteImpl, reopen as reopenImpl } from "./order/status";
import type { OrderStats } from "./order/list";
import type { OrderShipmentsResult } from "./order/detail";
import type { OrderActor, PreparedOrderCreate } from "./order/create";
import { ORDER_HEADER_WRITABLE, ORDER_LINE_WRITABLE, computeAllowedActions, computeTotalAmount, pickDefaultAction, withExtraWarnings, type CancelAction, type OrderServiceThis, type OrderWithLines } from "./order/shared";

export type { OrderStats } from "./order/list";
export type { OrderShipmentRow, OrderShipmentsResult } from "./order/detail";
export type { PreparedOrderCreate, OrderActor } from "./order/create";
export { ORDER_HEADER_WRITABLE, ORDER_LINE_WRITABLE } from "./order/shared";
export type { CancelAction } from "./order/shared";


/**
 * Bekçi ihracı — bu iki saf fonksiyonun AYRIŞAMAZLIĞI ölçülebilir olmalı
 * (BULGU-T2-005). Üretim kodu bunu kullanmaz; kaynak okuyarak sözleşme ölçmek
 * kırılgan olduğu için asıl kontrol her (durum × tek-sipariş) kombinasyonunu
 * gerçekten koşturur.
 */
export const __test__ = { computeAllowedActions, pickDefaultAction };

/**
 * Sipariş düzenlemesinin kalem özeti (audit `changes` satırı): eklenen / çıkarılan / miktar-kalem
 * değişen aktif kalem sayısı. İptal kalem diff'e girmez (update yolu da ona dokunmaz). Fark yoksa null.
 */
export function summarizeLineEdit(
  current: ReadonlyArray<{ id: string; itemId: string; quantity: unknown; cancelledAt: Date | null }>,
  incoming: ReadonlyArray<Record<string, unknown>>,
): { field: string; old: unknown; new: unknown } | null {
  const active = new Map(current.filter((l) => l.cancelledAt == null).map((l) => [l.id, l]));
  const cancelled = new Set(current.filter((l) => l.cancelledAt != null).map((l) => l.id));
  let added = 0;
  let changed = 0;
  const kept = new Set<string>();
  for (const raw of incoming) {
    const rid = typeof raw.id === "string" ? raw.id : "";
    if (cancelled.has(rid)) continue;
    const ex = active.get(rid);
    if (!ex) { added++; continue; }
    kept.add(rid);
    const itemChanged = typeof raw.itemId === "string" && raw.itemId !== ex.itemId;
    const qtyChanged = raw.quantity !== undefined && String(Number(raw.quantity)) !== String(Number(ex.quantity));
    if (itemChanged || qtyChanged) changed++;
  }
  const removed = [...active.keys()].filter((k) => !kept.has(k)).length;
  if (added + removed + changed === 0) return null;
  const parts = [added ? `${added} eklendi` : "", removed ? `${removed} çıkarıldı` : "", changed ? `${changed} değişti` : ""].filter(Boolean);
  return { field: "lines", old: `${active.size} kalem`, new: `${active.size - removed + added} kalem (${parts.join(", ")})` };
}

export class OrderService extends BaseService {
  private aliasService = new CustomerAliasService();

  constructor(config: BaseServiceConfig) {
    super(config);
  }

  /**
   * Liste filtresi `filter[itemId]` / `filter[colorId]` / `filter[woState]`
   * ilişki bazlıdır: Order'da bu kolonlar yoktur. `safeFilters` skaler-süzgeci
   * bunları düşürür (500'ü önler) — burada ilişki koşuluna çevirip `findAll`'ın
   * where'ine AND'liyoruz. itemId+colorId birden verilirse AYNI satır eşleşmeli
   * (ürün X + renk Y olan kalem). `woState` = "İş Emri" rollup filtresi (CSV,
   * çoklu seçim OR'lanır) — DB'de hesaplanır, sayfadaki veriyle sınırlı değildir.
   *
   * itemId/colorId de ÇOKLU seçilebilir (`readIdCondition` → `{ in: [...] }`):
   * kendi içinde OR, birbirleriyle AND — "kırmızı VEYA mavi olan patos kalemi".
   * Eski `typeof === "string"` okuması CSV'yi ham geçirirdi; ikisi de uuid
   * kolonu olduğu için sonuç boş liste değil P2007 → HTTP 400 *"Geçersiz veri
   * formatı"* olurdu (arıza modları: query-parser `readIdCondition` notu).
   */
  /**
   * Liste where'i: `codeSearchFields`teki `lines.some.workOrderLinks.some.…` yolu koparılmış
   * bağdan eşleşmesin — yürüyücü aktif yüklemi ekler (AST kapısı string yolu göremez).
   */
  protected override buildListWhere(params: QueryParams, req: Request): Record<string, unknown> {
    return withActiveOrderLinks(super.buildListWhere(params, req));
  }

  /** Yeni "Nerede?" süzgeç adları çıplak gelirse 400 (sessizce yok sayılmasın). */
  protected override assertListQueryShape(req: Request): void {
    super.assertListQueryShape(req);
    assertNoBareFilterParams(req, ORDER_WHERE_FILTER_KEYS);
  }

  /** Üretim kapalıyken üretim-türevi süzgeç 403 MODULE_DISABLED; dönüş = üretim açık mı. */
  private async gateOrderWhereFilters(req: Request): Promise<boolean> {
    return gateOrderWhereFiltersImpl(req);
  }

  /**
   * Liste: her satıra `nerede` (ek alan; eski istemci görmez). Sayfa başına sabit 2 sorgu.
   * Üretim modülü kapalıysa `nerede` null (iş emri/top yüzeyi yok).
   */
  override async findAll(req: Request): ReturnType<BaseService["findAll"]> {
    const productionOn = await this.gateOrderWhereFilters(req);
    const res = await super.findAll(req);
    if (!productionOn) {
      return { ...res, data: (res.data as object[]).map((o) => ({ ...o, nerede: null })) };
    }
    type Row = Parameters<typeof withOrderWhere>[0][number];
    return { ...res, data: await withOrderWhere(res.data as Row[]) };
  }

  /**
   * Yan panel: siparişin bağlı her aktif iş emri için kart (rota adımları + ilerleme + aşama dağılımı).
   * Sabit sorgu: sipariş+İE+adımlar tek Prisma okuması + `loadWorkOrderFacts` (2).
   */
  async getOrderWhereDetail(orderId: string): Promise<ApiResponse<unknown>> {
    return getOrderWhereDetailImpl(orderId);
  }

  protected extraWhere(req: Request): Record<string, unknown> | undefined {
    return extraWhereImpl(req);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SİPARİŞ KALEMİ İPTALİ (2026-08-27)
  // ═══════════════════════════════════════════════════════════════════════
  // 10 kalemlik siparişin 3 kalemini iptal edip kalan 7'siyle devam etmek.
  // Bugüne dek imkânsızdı: kalem çıkarmanın tek yolu hard-delete idi ve aktif
  // iş emri bağı varsa TAMAMEN reddediliyordu.
  //
  // Kararlar (kullanıcı, 2026-08-26):
  //   • İptal SOFT — kalem listede kalır, "iptal" işaretli ve salt-okunur.
  //   • İş emri bağı OTOMATİK kopar; kullanıcı yalnız UYARILIR (engellenmez).
  //   • Kısmi sevk görmüş kalem iptal EDİLEBİLİR ("kalanı iptal"): sevk edilen
  //     geçerli sayılır, kalan düşer.
  //   • Son aktif kalem iptal edilirse sipariş: sevk varsa COMPLETED, yoksa
  //     CANCELLED (kural `recomputeOrderStatusTx`'ta — tek yazma noktası).

  /** Kalem iptalinde etkilenecek iş emri. */
  private async loadLineForCancel(orderId: string, lineId: string) {
    return loadLineForCancelImpl(orderId, lineId);
  }

  /**
   * İPTAL ÖNİZLEMESİ — "onayladığında ne olacak" somut listesi.
   * CLAUDE.md kuralı: yıkıcı işlemde etkilenen HER kayıt tek tek gösterilir;
   * "3 kayıt etkilenecek" gibi soyut sayı yetmez.
   */
  async getLineCancelPreview(orderId: string, lineId: string): Promise<ApiResponse<unknown>> {
    return getLineCancelPreviewImpl.call(this as unknown as OrderServiceThis, orderId, lineId);
  }

  /**
   * KALEMİ İPTAL ET. Sebep İSTEĞE BAĞLI (sipariş iptaliyle aynı gerekçe:
   * zorunlu tutmak operatörü rastgele kategori seçmeye iter).
   */
  async cancelOrderLine(
    orderId: string,
    lineId: string,
    userId?: string,
    reason?: { reasonCode?: string | null; reasonText?: string | null },
  ): Promise<ApiResponse<unknown>> {
    return cancelOrderLineImpl.call(this as unknown as OrderServiceThis, orderId, lineId, userId, reason);
  }

  /**
   * SİPARİŞ ÖZET ŞERİDİ — listedeki filtreye uyan kümenin sayıları.
   *
   * Where `buildListWhere` ile kurulur (BaseService) — yani `findAll`ın offset ve
   * cursor yollarıyla AYNI ifade. Envanterdeki `buildRollWhere` emsali: özet ile
   * liste ayrı where kurarsa üst satırdaki sayı alttaki tabloyla çelişir ve
   * operatör hangisine güveneceğini bilemez.
   *
   * ⚠️ İKİ FARKLI KAPSAM, BİLİNÇLİ:
   *   • ADET (`totalCount` / `byStatus`) listenin BİREBİR aynasıdır. Panel iptalleri
   *     varsayılan gizler (`hideCancelled` → `extraWhere`), o yüzden İPTAL kovası
   *     yalnız kullanıcı "İptalleri göster" dediğinde dolar. Burada ikinci bir
   *     iptal sorgusu KOŞULMAZ — koşsaydı şeridin toplamı listenin satır sayısını
   *     tutmazdı ki bu ekranın tek vaadi o eşitliktir.
   *   • METRAJ (`totalOrderedQty` / `totalShippedQty` / `totalOpenQty`) iptalleri
   *     HER ZAMAN dışlar: iptal edilmiş siparişin açık metrajı yoktur. Kullanıcı
   *     iptalleri görünür yapsa bile metraj değişmez.
   *
   * `totalOpenQty` düz çıkarmadır (istenen − sevk). Satır bazında kırpma
   * (`GREATEST(...,0)`) gerekmiyor: tahsis kapasitesi kilit altında taze okunur
   * (`order-status.helper` kilit protokolü) ve canlı kopyada aşırı sevkli kalem
   * ÖLÇÜLDÜ = 0. Yine de toplam 0'da kırpılır — invariant kırılırsa şerit negatif
   * metraj basmasın (gösterim koruması; muhasebe defteri değil).
   */
  async getOrderStats(req: Request): Promise<ApiResponse<OrderStats>> {
    return getOrderStatsImpl.call(this as unknown as OrderServiceThis, req);
  }

  /**
   * Müşteriye-özel ad terfisi (otomatik master kaydı).
   *
   * Sipariş satırında `customerItemName` / `customerColorName` girilmiş VE o
   * müşteri+ürün / müşteri+renk için master alias HENÜZ YOKSA → master tabloya
   * (CustomerItemAlias / CustomerColorAlias) yazılır. Böylece aynı müşteriye
   * sonraki sipariş girilirken `/aliases/suggest` bu adı otomatik getirir
   * (alan kilitli/dolu gelir).
   *
   * Master ZATEN VARSA dokunulmaz: bu durumda satırdaki değer bilinçli bir
   * tek-seferlik override'dır (frontend alanı master varken kilitler; "Override
   * Et" onayıyla farklı ad girilebilir). Master'ı ezmek o ayrımı bozar.
   *
   * Renkte ikinci kapı (MUSTERI-KUMAS-RENK-ADI karar 2): o müşteri + kumaş + renk
   * için KUMAŞA ÖZEL ad varsa satırdaki ad o kumaşın bağlamıdır — genel ada
   * terfi edilmez; yoksa X'in adı kumaşa özel adı olmayan bütün kumaşlara sızardı.
   * Kumaşa özel ad yalnız elle girilir, terfi onu yazmaz.
   *
   * Best-effort: sipariş zaten commit edilmiştir, alias kaydı yan-etkidir.
   * Terfi sırasında bir hata olursa (örn. ürün/renk pasifleştirilmiş) sipariş
   * kaydı bozulmamalı — hata satır bazında yutulur.
   */
  private async promoteCustomerAliases(
    customerId: string | null | undefined,
    lines: Array<Record<string, unknown>> | null | undefined,
    userId?: string
  ): Promise<void> {
    return promoteCustomerAliasesImpl.call(this as unknown as OrderServiceThis, customerId, lines, userId);
  }

  /** Satırlardaki (kumaş, renk) çiftlerinden bu müşteri için KUMAŞA ÖZEL renk adı olanlar. */
  private async kumasaOzelRenkCiftleri(
    customerId: string,
    lines: Array<Record<string, unknown>>,
  ): Promise<Set<string>> {
    return kumasaOzelRenkCiftleriImpl(customerId, lines);
  }

  /**
   * Sipariş kalemleri için finansal sınırlar:
   *   - quantity > 0 (pozitif metraj/adet)
   *   - unitPrice >= 0 ya da null (null = "fiyatlandırılmamış", iş kuralı)
   * Negatif/sıfır metraj veya negatif fiyat finansal kayıt + üretim akışını
   * bozacağı için service seviyesinde reddedilir (Zod yerine inline AppError,
   * mevcut validateBranch / assertValidCurrency deseniyle uyumlu).
   */
  private validateLines(lines: unknown): void {
    return validateLinesImpl(lines);
  }

  /**
   * Sipariş kalemlerindeki renkler bu müşteride kullanılabilir mi? Müşteriye
   * özel (assigned) bir renk, yanlış müşteride veya müşterisiz siparişte
   * reddedilir. Public renkler serbest. (UI zaten gizler; bu backend enforce.)
   */
  private async validateLineColors(
    lines: unknown,
    customerId: string | null | undefined,
  ): Promise<void> {
    return validateLineColorsImpl(lines, customerId);
  }

  /**
   * Sipariş kalemlerindeki ürün (itemId) ve istenen özelliklerin
   * (requiredPropertyIds) var + aktif olduğunu doğrular. Pasife alınmış
   * (soft-deleted) bir ürün/özellik DB FK kontrolünü geçer ve canlı sipariş
   * satırına yazılabilir — master-data'nın emekliye ayırdığı kayda finansal/
   * üretim bağı kurulur. KK1/WO ile aynı soft-delete-entry guard sınıfı.
   * (Var-olmayan UUID zaten P2003→400 ile yakalanır; bu guard pasif kayıtları kapatır.)
   */
  /**
   * Satır kalemlerini doğrular ve `itemId → Item.unit` haritasını döner: satır
   * birimi buradan kopyalanır (ikinci bir okuma doğmasın diye aynı sorgu).
   */
  /**
   * Satır ürünleri: var mı · kullanım kuralı (URUN-YASAM-DONGUSU.md §4) · izinli renk/özellik.
   * Yeni satır (ya da ürünü değişen satır) = A1 yeni sipariş; ürünü aynı kalan mevcut
   * satırın miktarı = A2. Dönen `checks` tx içinde kilit altında TEKRARLANIR.
   */
  private async validateLineItems(
    lines: unknown,
    ctx: {
      fromScannedRolls?: boolean;
      current?: ReadonlyArray<{ id: string; itemId: string; quantity: Prisma.Decimal | number }>;
    } = {},
  ): Promise<{ unitByItem: Map<string, ItemUnit>; checks: ItemUsageCheck[]; warnings: string[] }> {
    return validateLineItemsImpl.call(this as unknown as OrderServiceThis, lines, ctx);
  }

  /**
   * Varyant + hedef değer gövde kapıları (SY-K1k). Mevcut özellik doğrulamasından ÖNCE: hedefin BAYRAK ikizi
   * `requiredPropertyIds`e burada girer ki izinli liste/aktiflik kapıları onu da sınasın.
   */
  private async prepareLineVariants(
    lines: unknown,
    current: ReadonlyArray<{
      id: string;
      itemId: string;
      recipeId: string | null;
      targetValues?: ReadonlyArray<{ propertyId: string; valueId: string }>;
    }> = [],
  ): Promise<void> {
    return prepareLineVariantsImpl(lines, current);
  }

  /** Satırın renk/özellik referansları var ve aktif mi (M-23 / denetim Q2). */
  private async assertLineRefsLive(colorIds: Set<string>, propertyIds: Set<string>): Promise<void> {
    return assertLineRefsLiveImpl(colorIds, propertyIds);
  }

  /**
   * Satır birimi: gönderildiyse enum'a karşı doğrulanır, gönderilmediyse kalem
   * kartından kopyalanır. Sessiz `MT` varsayılanı YOK — kalem çözülemediyse 400
   * (varsayılan, 1000 kg'lık satırı metre saydıran sessiz yanlışın kendisiydi).
   */
  private resolveLineUnit(
    raw: Record<string, unknown>,
    unitByItem: Map<string, ItemUnit>,
  ): ItemUnit {
    return resolveLineUnitImpl(raw, unitByItem);
  }

  /** Yanıta MT-dışı satır uyarılarını ekler (engel değil, `warnings`). */
  private withUnitWarnings<T>(res: ApiResponse<T>): ApiResponse<T> {
    return withUnitWarningsImpl(res);
  }

  /**
   * Hedef şubenin müşteriye ait + aktif olduğunu doğrular.
   */
  private async validateBranch(
    branchId: string,
    customerId: string
  ): Promise<void> {
    return validateBranchImpl(branchId, customerId);
  }

  /**
   * Müşterinin varlığını + aktifliğini doğrular. Pasif (soft-deleted) müşteriye
   * yeni sipariş açılamaz — satış temsilcisi yanlış kayıt seçimini fark etmesin
   * diye iş kuralı seviyesinde reddedilir.
   */
  private async validateCustomer(customerId: string): Promise<void> {
    return validateCustomerImpl(customerId);
  }

  /** F148: para birimi ISO 4217 kataloğunda mı (create/update simetrik). null=opsiyonel. */
  private assertValidCurrency(currency: unknown): void {
    return assertValidCurrencyImpl(currency);
  }

  /** F148: termin >= sipariş tarihi (verilmezse referans = now). create/update ortak. */
  private assertDeadlineNotBeforeOrderDate(deadline: unknown, orderDate: unknown): void {
    return assertDeadlineNotBeforeOrderDateImpl(deadline, orderDate);
  }

  /**
   * İş emri picker'ı için müsait sipariş listesi.
   *
   * Gevşek/gap model (güncel): açık > 0 (quantity − shippedQty) satırı olan,
   * CANCELLED/COMPLETED-dışı siparişleri döner. WO bağı müsaitliği ETKİLEMEZ —
   * sipariş yalnız SEVKle kapanır, üretime girince değil. (Eski workOrderLinks-bazlı
   * filtreleme ve excludeWorkOrderId artık YOK; açık-satır süzgeci DB WHERE'inde.)
   *
   * Standart `filters` (status, customerId), `search`, `dateFrom/dateTo`,
   * `sortBy` ve sayfalama parametreleri `findAll` ile aynı şekilde çalışır.
   */
  async findAvailableForWorkOrder(
    req: Request
  ): Promise<PaginatedResponse<unknown>> {
    return findAvailableForWorkOrderImpl.call(this as unknown as OrderServiceThis, req);
  }

  /**
   * Bir topun özelliğine (itemId + opsiyonel colorId/width) uyan, Açık > 0 olan
   * AÇIK sipariş kalemlerini döner. Tambur "Yeniden Kes" (depo topu → müşteri
   * etiketi) ve top-önce paketleme picker'ları için.
   * Açık = quantity − sevk (OrderLine.shippedQty); WO bağı açığı etkilemez.
   * `withInProduction` verilirse her satıra ayrıca `inProduction` (üretimdeki) +
   * `netOpenQty` (= açık − üretimdeki) eklenir — Hızlı İş Emri "ne kadar daha
   * üretmeliyim" için. Tambur/Etiket bunu GÖNDERMEZ (bitmiş mal ataması; açık aynı kalır).
   */
  async findAvailableOrderLines(params: {
    itemId?: string | null;
    colorId?: string | null;
    width?: number | null;
    withInProduction?: boolean;
    // Cursor mod (sipariş-önce aramalı liste) — yalnız `limit` verilince devreye girer.
    search?: string | null;
    cursor?: string | null;
    limit?: number | null;
    withTotal?: boolean;
    /** Mobil picker "detaylı filtre" — müşteri bazlı daraltma. */
    customerId?: string | null;
    /**
     * "Bu kalemle AYNI iş emrinde üretilebilecek kalemler" — verilen satırın
     * spec'ini (kumaş + renk + en) okur ve listeyi ona daraltır.
     *
     * Neden ham `colorId`/`width` değil: spec'in parçaları NULL olabilir
     * (renksiz/ham kalem, eni girilmemiş kalem) ve "renk yok" ile "renk filtresi
     * yok" sorgu dizesinde aynı görünür — istemci NULL'ı kodlamaya çalışsa
     * eninde sonunda birini diğeri sanardı. Satır id'si tek parça, belirsizlik yok.
     */
    specOfLineId?: string | null;
  }): Promise<ApiResponse<unknown> | CursorPaginatedResponse<unknown>> {
    return findAvailableOrderLinesImpl.call(this as unknown as OrderServiceThis, params);
  }

  /**
   * F152: bir item'ın canlı WO'larından spec-havuz (item|renk|en) başına üretimdeki
   * (in-flight = committed − finished) miktarı. findAvailableOrderLines'ın hem cursor
   * hem legacy modu paylaşır. Anahtar formatı: `${itemId}|${colorId}|${width}`.
   */
  private async computeInProdBySpec(
    itemId: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    return computeInProdBySpecImpl(itemId);
  }

  /**
   * Kapsama (coverage) — WO formundaki seçili sipariş kalemleri için "ne kadar
   * üretmeliyim". Her spec (ürün+renk+en) için:
   *   istenen − sevk − üretimde − serbest depo − serbest ham = net açık (eksi = fazla).
   * HİBRİT MODEL:
   *  - sevk: kaleme özel (OrderLine.shippedQty) → satır bazında toplanır.
   *  - üretimde: canlı WO'ların hedef-spec başına in-flight'ı (committed − finished,
   *    computeWoMaterial). Spec-havuz: aynı spec'in her kalemi aynı değeri taşır
   *    (frontend bir kez sayar). Pro-rata / per-kalem tahsis YOK.
   *  - serbest depo/ham: item+renk+en eşleşen, sevkiyata okutulmamış
   *    (shipmentId=null) WAREHOUSE/STOCK toplar (fungible havuz).
   * excludeWorkOrderId: düzenleme modunda WO'nun kendi üretimini sayma.
   */
  async getCoverageForLines(params: {
    lineIds: string[];
    excludeWorkOrderId?: string;
  }): Promise<ApiResponse<unknown>> {
    return getCoverageForLinesImpl(params);
  }

  /**
   * Spec-bazlı anlık müsaitlik — sipariş GİRİŞ formunda (henüz kaydedilmemiş,
   * lineId'siz satır) "Depoda / Üretimde / Ham" ipucu için. getCoverageForLines
   * ile AYNI kaynakları kullanır ama tek spec (item+renk+en) parametresiyle,
   * satır/sevk muhasebesi olmadan:
   *  - freeWarehouse: item+renk+en birebir eşleşen serbest depo (WAREHOUSE).
   *  - freeStock: renk-joker + en-agnostik serbest ham (STOCK).
   *  - inProduction: canlı WO'ların hedef-spec başına in-flight'ı (computeInProdBySpec).
   * ANLIK FOTOĞRAF — rezervasyon değildir. Değerler DÜRÜST number döner (Decimal
   * JSON'a string sızmasın — getCoverageForLines emsalinin aksine, `.toNumber()`).
   */
  async getSpecAvailability(params: {
    itemId: string;
    colorId?: string | null;
    width?: number | null;
  }): Promise<
    ApiResponse<{
      freeWarehouse: number;
      inProduction: number;
      freeStock: number;
      /** Dışarıdan alınan yarı mamul — `freeStock`tan AYRI raporlanır (2026-08-27). */
      freeSemiFinished: number;
    }>
  > {
    return getSpecAvailabilityImpl.call(this as unknown as OrderServiceThis, params);
  }

  /**
   * Sipariş detayında "hangi sevkiyatlarla sevk edildi" drill-down'ı. İKİ kaynağı
   * birleştirir — `shippedQty` de bu ikisinin toplamıdır (order-status.helper
   * computeLineLedgerTx), o yüzden `dispatchedTotal` `order.shippedQty` ile MUTABIK olmalı:
   *   - Çuval sevki (SHIPMENT): SackAllocation → sack → shipment (CANCELLED hariç;
   *     DISPATCHED sevk edilen, PLANNED bekleyen).
   *   - Fason direkt sevk (DIRECT): SubcontractorDirectShipAllocation → directShipment
   *     (terminal — hep sevk edilmiş sayılır). Legacy directShipmentId=null → tek toplu satır.
   * Bilgilendirici snapshot (sevk muhasebesini değiştirmez).
   */
  /**
   * Detay: MT-dışı aktif satır varsa `warnings` ile "karşılama ölçülmüyor".
   * Satırlara `resolvedCustomerColorName` + `colorNameScope` eklenir (tek çözücü).
   * İzin fail-closed: `customer-alias:read` yoksa ana veri kademesi TAŞINMAZ.
   */
  async findById(id: string, opts?: { canReadCustomerAliases?: boolean }): Promise<ApiResponse<unknown>> {
    const res = await super.findById(id);
    if (res.success && res.data) {
      await this.withResolvedColorNames(res.data as OrderWithLines, opts?.canReadCustomerAliases === true);
    }
    return this.withUnitWarnings(res);
  }

  /** Satır adı → kumaşa özel → genel; `DEFAULT`a düşerse null (bizim ad dönmez). */
  private async withResolvedColorNames(order: OrderWithLines, withMaster: boolean): Promise<void> {
    return withResolvedColorNamesImpl(order, withMaster);
  }

  async getOrderShipments(orderId: string): Promise<ApiResponse<OrderShipmentsResult>> {
    return getOrderShipmentsImpl(orderId);
  }

  async create(data: Record<string, unknown>, userId?: string, opts?: { canSeeRiskAmounts?: boolean }): Promise<ApiResponse<unknown>> {
    return createImpl.call(this as unknown as OrderServiceThis, data, userId, opts);
  }

  /**
   * Doğuşun commit SONRASI yarısı (tek yol: uç + patron bulutu gelen kutusu): audit, müşteriye-özel ad terfisi
   * (girilen customerItemName/customerColorName master alias yoksa kalıcı kaydedilir), birim uyarıları.
   * `auditExtra` kaynak künyesidir (ör. `kaynak: "PATRON_BULUTU"`); iş verisi değil, ayak izi.
   */
  async finishOrderCreate(
    record: Record<string, unknown>,
    data: Record<string, unknown>,
    prepared: PreparedOrderCreate,
    opts?: { auditExtra?: Record<string, unknown> },
  ): Promise<ApiResponse<unknown>> {
    return finishOrderCreateImpl.call(this as unknown as OrderServiceThis, record, data, prepared, opts);
  }

  /**
   * Sipariş doğuşunun tx DIŞI yarısı: doğrulamalar, varsayılanlar, whitelist'li gövde, donmuş yön ve elle numara
   * kapısı. Yazmaz; `create`, hızlı sipariş ve patron bulutu gelen kutusu aynı kapılardan geçsin diye tek yerde.
   */
  async prepareOrderCreate(
    data: Record<string, unknown>,
    clientToken: string | null,
    actor: OrderActor,
    /** Yalnız hızlı sipariş: satırlar okutulan toplardan doğdu — gövdeden GELMEZ. */
    opts?: { fromScannedRolls?: boolean },
  ): Promise<PreparedOrderCreate> {
    return prepareOrderCreateImpl.call(this as unknown as OrderServiceThis, data, clientToken, actor, opts);
  }

  /**
   * orderNumber üretimi + create RETRY KAPSAMINDA (M-25): eşzamanlı iki POST aynı seq'i hesaplarsa kaybeden
   * P2002 sonrası taze max ile yeniden dener. Manuel numarada retry'a gerek yok ama P2002 yarışına (aynı anda
   * aynı manuel no) karşı yine sarılır — ikinci deneme çakışma kontrolünde 409'a düşer. clientToken P2002'si
   * retry EDİLMEZ (her deneme aynı token'ı yazar); çağıran onu replay'e çevirir.
   */
  private insertPreparedOrder(p: PreparedOrderCreate): Promise<Record<string, unknown>> {
    return insertPreparedOrderImpl.call(this as unknown as OrderServiceThis, p);
  }

  /**
   * TX-ALAN DİKİŞ: `prepareOrderCreate`ten geçmiş gövde VERİLEN tx'te yazılır. Kart kilitleri (8030 SHARED → FOR
   * SHARE) bu dikişin ilk ifadeleridir; 8036 token kilidi alınıyorsa ÇAĞIRANIN tx'inde ondan ÖNCE gelir (hızlı
   * sipariş ile aynı sıra). Sıra no kilitlerin ARKASINDA okunur; çakışmayı çağıranın `withBarcodeRetry`si çözer.
   */
  async insertPreparedOrderTx(tx: Prisma.TransactionClient, p: PreparedOrderCreate): Promise<Record<string, unknown>> {
    return insertPreparedOrderTxImpl.call(this as unknown as OrderServiceThis, tx, p);
  }

  /**
   * Otomatik sipariş no. Collation-güvenli: eski `lt: prefix+"￿"` üst sınırı glibc'de (U+FFFF ignorable)
   * bugünün satırlarını dışlar; `gte` (index seek) + `startsWith` (LIKE, collation-bağımsız tam-prefix).
   * ⚠️ C0 KAPSAMI: sayaç yalnız BU BİÇİM yürürlüğe girdikten sonra doğan kodlara bakar; biçim BİR KEZ okunmuş
   * `fmt` olarak geçirilir ("iki okuma" sınıfı).
   */
  private nextOrderNumber(db: Pick<Prisma.TransactionClient, "order">, p: PreparedOrderCreate): Promise<string> {
    return nextOrderNumberImpl(db, p);
  }

  /**
   * Siparişin TEK insert'i. `destination` data literalinde: donmuş kolonun yazıcısı AST ile ölçülür (`test_snapshot_kolonlari`).
   * Künye (`createdById`/`updatedById`) BaseService ile aynı yazıcıdan: `withActor` (`test_record_provenance` ölçer).
   */
  private insertOrderTx(tx: Prisma.TransactionClient, p: PreparedOrderCreate, orderNumber: string): Promise<Record<string, unknown>> {
    return insertOrderTxImpl.call(this as unknown as OrderServiceThis, tx, p, orderNumber);
  }

  private findOrderByToken(db: Prisma.TransactionClient, clientToken: string): Promise<Record<string, unknown> | null> {
    return findOrderByTokenImpl.call(this as unknown as OrderServiceThis, db, clientToken);
  }

  /**
   * create() replay'i (Roll emsali): önce 4. durum (iptal edilmiş sipariş "başarılı" dönmesin — müşteriye söz
   * verilen metraj listede görünmezdi), sonra kimlik: müşteri + şube + SATIR İZİ (ürün · renk · en · miktar; Decimal
   * 3 hane) + elle verilmişse sipariş no. Satır izi olmadan düzeltilmiş miktarın aynı token'la tekrarı eski
   * siparişi "oluşturuldu" diye döndürüp düzeltmeyi yutardı.
   */
  private orderReplay(data: Record<string, unknown>) {
    return orderReplayImpl.call(this as unknown as OrderServiceThis, data);
  }

  /**
   * Saha #11: ham/stok toplardan HIZLI SİPARİŞ. Operatör 70 topu tek tek satıra
   * girmek yerine okutur → müşteri seçer → sistem topları spec (ürün+renk+en)
   * bazında gruplayıp sipariş satırlarına çevirir, siparişi APPROVED açar ve
   * STOK topları WAREHOUSE'a (sevke hazır) alır.
   *
   * GEVŞEK MODEL KORUNUR: toplar siparişe BAĞLANMAZ — satırlar yalnız spec-toplam
   * talebi temsil eder; karşılanma yine spec-toplam üzerinden işler (sevkte). Top
   * okutmak burada yalnız "ne kadar/ne tür satır açılacağını" türetmek içindir.
   *
   * Top claim'i ile sipariş TEK tx'tir (biri düşerse ikisi de düşer); token kilidi (8036) tx'in ilk ifadesidir:
   * aynı token'lı ikinci deneme kazananın commit'ini bekler, sonra onun siparişini görür.
   */
  async quickOrderFromRolls(
    data: { customerId: string; branchId?: string | null; rollIds: string[]; clientToken?: string | null },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return quickOrderFromRollsImpl.call(this as unknown as OrderServiceThis, data, userId);
  }

  /** Hızlı siparişin yazan yarısı: token kilidi (8036) + token → kart kilitleri (8030) → top claim'i → sipariş. */
  private async quickOrderTx({ data, rolls, lines, clientToken, replay, userId }: {
    data: { customerId: string; branchId?: string | null };
    rolls: Array<{ id: string; barcode: string | null; status: RollStatus; shipmentId: string | null; sackId: string | null; currentStepId: string | null }>;
    lines: Array<{ itemId: string; colorId: string | null; width: number | null; quantity: number }>;
    clientToken: string | null;
    replay: TokenReplay<ApiResponse<unknown>>;
    userId: string | undefined;
  }): Promise<{ replayed: ApiResponse<unknown> } | { order: Record<string, unknown>; stockRollIds: string[] }> {
    return quickOrderTxImpl.call(this as unknown as OrderServiceThis, { data, rolls, lines, clientToken, replay, userId });
  }

  /**
   * Hızlı sipariş replay'i: iptal edilmişse 409 `ORDER_CANCELLED`; müşteri + şube + satırlar (ürün · renk · en ·
   * metraj — okutulan toplardan türeyen gövde) aynıysa önceki sipariş, değilse 409 CLIENT_TOKEN_COLLISION.
   */
  private quickOrderReplay(
    data: { customerId: string; branchId?: string | null },
    lines: Array<{ itemId: string; colorId: string | null; width: number | null; quantity: number }>,
    rollCount: number,
  ): TokenReplay<ApiResponse<unknown>> {
    return quickOrderReplayImpl.call(this as unknown as OrderServiceThis, data, lines, rollCount);
  }

  /**
   * Update override — status-gated header + lines editi.
   *
   * Kurallar:
   * - COMPLETED / CANCELLED → değiştirilemez (409).
   * - PARTIAL_SHIPPED → sadece `deadline` güncellenir; lines forbidden.
   * - APPROVED / PENDING → header alanları açık. Aktif WO (IN_PROGRESS/
   *   COMPLETED) bağlıysa customerId/branchId değiştirilemez.
   * - Lines: CANCELLED dışı herhangi bir WO bağı yoksa düzenlenebilir.
   *   Diff stratejisi: id eşleşene update, eşleşmeyene create, mevcut'ta var
   *   incoming'de yok ise delete. customerItemName/customerColorName + property
   *   referansları id korunduğu için bozulmaz.
   */
  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
    opts?: { canSeeRiskAmounts?: boolean },
  ): Promise<ApiResponse<unknown>> {
    const current = await prisma.order.findUnique({
      where: { id },
      select: {
        customerId: true,
        branchId: true,
        status: true,
        orderDate: true, // F148: termin-tarih kuralı için mevcut referans
        deadline: true,
        // Audit `changes` başlık farkı için eski değerler (ORDER_HEADER_WRITABLE'ın tamamı).
        currency: true,
        totalAmount: true,
        lines: {
          select: {
            id: true,
            itemId: true,
            // A2 (açık satırda miktar) kararı eski ↔ yeni miktarı karşılaştırır.
            quantity: true,
            // ⚠️ LOAD-BEARING: aşağıdaki `cancelledAt !== null` süzgeci bu alan
            // seçilmezse `undefined !== null` ile TÜM kalemleri iptal sayar ve
            // hiçbir kalem güncellenemez olurdu (sessiz felç).
            cancelledAt: true,
            recipeId: true,
            requiredProperties: { select: { propertyId: true } },
            targetValues: { select: { propertyId: true, valueId: true } },
            workOrderLinks: {
              where: ACTIVE_ORDER_LINK,
              select: {
                workOrder: { select: { status: true } },
              },
            },
          },
        },
      },
    });
    if (!current) throw AppError.notFound("Sipariş bulunamadı");

    if (
      current.status === OrderStatus.COMPLETED ||
      current.status === OrderStatus.CANCELLED
    ) {
      throw AppError.conflict(
        "Tamamlanmış veya iptal edilmiş sipariş düzenlenemez"
      );
    }

    const incomingLines = Array.isArray(data.lines)
      ? (data.lines as Array<Record<string, unknown>>)
      : null;

    const cleanData: Record<string, unknown> = { ...data };
    delete cleanData.lines;

    // HEADER WHITELIST (mass-assignment guard'ı — M-3): status / shippedQty /
    // completedAt / manualClosedById / orderNumber gibi muhasebe+kimlik alanları
    // istemci gövdesinden YAZILAMAZ. PATCH {"status":"CANCELLED"} cancel
    // kaskadını (WO-unbind matrisi), {"status":"COMPLETED"} manuel kapatma
    // gerekçesini atlardı; shippedQty "tek yazma noktası: sevkiyat akışı +
    // recomputeOrderStatusTx" invariant'ını (şema notu) bozardı. Statü/kapatma
    // için özel endpoint'ler var (cancel, manual-close).
    for (const key of Object.keys(cleanData)) {
      if (!ORDER_HEADER_WRITABLE.has(key)) delete cleanData[key];
    }

    // F148: create ile simetrik doğrulama (update'te eksikti). PARTIAL_SHIPPED'ten
    // ÖNCE çalışır → deadline-only PATCH'te de termin kuralı uygulanır (currency
    // PARTIAL_SHIPPED'te zaten whitelist'ten düşer).
    if (Object.prototype.hasOwnProperty.call(cleanData, "currency")) {
      this.assertValidCurrency(cleanData.currency);
    }
    const deadlineChanging = Object.prototype.hasOwnProperty.call(cleanData, "deadline");
    const orderDateChanging = Object.prototype.hasOwnProperty.call(cleanData, "orderDate");
    if (deadlineChanging || orderDateChanging) {
      const effDeadline = deadlineChanging ? cleanData.deadline : current.deadline;
      const effOrderDate = orderDateChanging ? cleanData.orderDate : current.orderDate;
      this.assertDeadlineNotBeforeOrderDate(effDeadline, effOrderDate);
    }

    // PARTIAL_SHIPPED: sadece deadline. Lines kabul edilmez, diğer header
    // alanları sessizce yutulur (eski davranış korunur).
    if (current.status === OrderStatus.PARTIAL_SHIPPED) {
      if (incomingLines) {
        throw AppError.conflict(
          "Kısmi sevk edilmiş siparişin kalemleri değiştirilemez"
        );
      }
      const allowed = new Set(["deadline"]);
      for (const key of Object.keys(cleanData)) {
        if (!allowed.has(key)) delete cleanData[key];
      }
      if (Object.keys(cleanData).length === 0) {
        // F156: no-op'ta da normal update ile aynı (defaultInclude'lu) tam şekli dön.
        const full = await this.findById(id);
        return { ...full, message: "Değişiklik yok" };
      }
      return super.update(id, cleanData, userId);
    }

    const branchChanging = Object.prototype.hasOwnProperty.call(cleanData, "branchId");
    const customerChanging = Object.prototype.hasOwnProperty.call(cleanData, "customerId");
    // Sipariş AÇIKÇA başka cariye/şubeye taşınırsa yön yeniden çözülür (o cariye açılmadı; eski değer audit'te).
    let retarget: { customerId: string; branchId: string | null } | null = null;
    const riskWarnings: string[] = [];

    if (branchChanging || customerChanging) {
      const blockingStatuses = new Set(["IN_PROGRESS", "COMPLETED"]);
      const hasBlockingWO = current.lines.some((line) =>
        line.workOrderLinks.some((link) =>
          blockingStatuses.has(link.workOrder.status)
        )
      );
      if (hasBlockingWO) {
        throw AppError.conflict(
          `Aktif ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} bağlı sipariş; müşteri veya şube değiştirilemez`
        );
      }

      const finalBranchId = branchChanging
        ? (cleanData.branchId as string | null)
        : current.branchId;
      const finalCustomerId = customerChanging
        ? (cleanData.customerId as string)
        : current.customerId;

      // M-22: müşteri değişiminde yeni müşteri varlık+isActive doğrulanır
      // (create() ile simetrik — pasif müşteriye sipariş taşınamaz).
      if (customerChanging) {
        await this.validateCustomer(finalCustomerId);
        // Kilitli cariye taşıma = yeni iş kabulü; yaratma kapısının yan kapısını kapatır.
        if (finalCustomerId !== current.customerId) {
          await assertCariNotHeldTx(prisma, finalCustomerId, "INTAKE");
          await assertCustomerRiskLimitTx(prisma, finalCustomerId, "INTAKE");
          // K3 (Seyitoğlu L4): kapı kapalıyken taşıma engellenmez, yanıta uyarı olur (yaratmayla aynı çekirdek).
          const risk = await customerRiskLimitIntakeWarningTx(prisma, finalCustomerId);
          if (risk) riskWarnings.push(riskLimitIntakeWarningText(risk, opts?.canSeeRiskAmounts === true, "güncellendi"));
        }

        // Lines payload'ı yoksa MEVCUT satır renkleri yeni müşteriye karşı
        // yeniden doğrulanır — eski müşteriye exclusive atanmış renk, sipariş
        // taşınınca satırda kalamaz (renk exclusivity backend-ENFORCE garantisi).
        if (!incomingLines) {
          const existingColorIds = [
            ...new Set(
              (
                await prisma.orderLine.findMany({
                  where: { orderId: id, colorId: { not: null } },
                  select: { colorId: true },
                })
              ).map((l) => l.colorId as string),
            ),
          ];
          if (existingColorIds.length > 0) {
            await assertColorsAssignableToCustomer(existingColorIds, finalCustomerId);
          }
        }
      }

      if (finalBranchId) {
        await this.validateBranch(finalBranchId, finalCustomerId);
      }
      retarget = { customerId: finalCustomerId, branchId: finalBranchId ?? null };
    }

    // Lines payload geldiyse: WO bağı kontrolü + diff uygula.
    let unitByItem: Map<string, ItemUnit> = new Map();
    let lineCheck: Awaited<ReturnType<OrderService["validateLineItems"]>> | null = null;
    if (incomingLines) {
      // CANCELLED WO bağları sayılmaz (iptal edilmiş, kalem serbest).
      const hasActiveWoLink = current.lines.some((line) =>
        line.workOrderLinks.some((link) => link.workOrder.status !== "CANCELLED")
      );
      if (hasActiveWoLink) {
        throw AppError.conflict(
          `${TERIM.terbiyeIsEmri.cumleBasi.yalin} açılmış siparişin kalemleri değiştirilemez. Önce ${TERIM.terbiyeIsEmri.cekimKucuk.belirtme} iptal edin.`
        );
      }
      this.validateLines(incomingLines);
      await this.prepareLineVariants(incomingLines, current.lines);
      lineCheck = await this.validateLineItems(incomingLines, { current: current.lines });
      unitByItem = lineCheck.unitByItem;

      const effectiveCustomerId = customerChanging
        ? (cleanData.customerId as string | null)
        : current.customerId;
      await this.validateLineColors(incomingLines, effectiveCustomerId);

      // totalAmount auto-recompute (cleanData'da explicit yoksa)
      if (cleanData.totalAmount === undefined) {
        cleanData.totalAmount = computeTotalAmount(
          incomingLines as Array<{ quantity?: number; unitPrice?: number | null | string }>
        );
      }
    }

    // Hedef değer kümesi değişen satırlar — audit'e eski/yeni küme (tx dışında yazılır).
    const targetChanges: Array<{ lineId: string; eski: unknown; yeni: unknown }> = [];
    // Tek transaction: lines diff + header update + final fetch.
    const updated = await prisma.$transaction(async (tx) => {
      // İLK ifade: satır kartlarının kilidi (8030 SHARED → FOR SHARE, itemId sırasıyla).
      if (lineCheck) await runItemUsageChecksTx(tx, lineCheck.checks);
      if (incomingLines) {
        // F144: WO-bağı guard'ını tx İÇİNDE TAZE re-check et — pre-tx (1362) okuma
        // ile deleteMany arasında eşzamanlı WO create (orderLinks INSERT) araya
        // girip CASCADE ile linki sessizce silebilir; statement commit'li linkleri görür.
        const activeLink = await tx.workOrderToOrderLine.findFirst({
          where: {
            ...ACTIVE_ORDER_LINK,
            orderLine: { orderId: id },
            workOrder: { status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] } },
          },
          select: { workOrderId: true },
        });
        if (activeLink) {
          throw AppError.conflict(
            `${TERIM.terbiyeIsEmri.cumleBasi.yalin} açılmış siparişin kalemleri değiştirilemez. Önce ${TERIM.terbiyeIsEmri.cekimKucuk.belirtme} iptal edin.`,
          );
        }
        // ── İPTAL EDİLMİŞ KALEM DOKUNULMAZ (2026-08-27) ──────────────────
        // İki ayrı tehlike var ve ikisi de SESSİZ:
        //   ① payload'da yoksa diff onu SİLER → iptal olgusu ve sevk edilmiş
        //      metrajı kayıtlardan kaybolur (sevkiyat mutabakatı bozulur),
        //   ② payload'da varsa metrajı/rengi DEĞİŞTİRİLEBİLİR → kapanmış bir
        //      kararın geçmişi sonradan yeniden yazılır.
        // İkisini de sunucuda kapatıyoruz; istemci disiplinine bırakılmaz.
        const cancelledLineIds = new Set(
          // Gevşek `!= null` (order-status.helper ile aynı gerekçe): alan
          // seçilmezse KATI karşılaştırma tüm kalemleri iptal sayar ve hiçbir
          // kalem güncellenemez olurdu.
          current.lines.filter((l) => l.cancelledAt != null).map((l) => l.id),
        );
        const existingById = new Map(current.lines.map((l) => [l.id, l]));
        const incomingIds = new Set(
          incomingLines
            .filter((l) => typeof l.id === "string" && (l.id as string).length > 0)
            .map((l) => l.id as string)
        );

        // Delete: existing - incoming. Cascade ile requiredProperties otomatik siler.
        // İPTAL EDİLMİŞ kalemler silme kümesinden ÇIKARILIR (payload'da olmasalar
        // da korunurlar) — form onları göstermese bile satır yaşamaya devam eder.
        const toDelete = [...existingById.keys()].filter(
          (eid) => !incomingIds.has(eid) && !cancelledLineIds.has(eid),
        );
        if (toDelete.length > 0) {
          // O-6: silinecek satırları FOR UPDATE ile kilitle — in-flight WO orderLine
          // INSERT'i (FK → FOR KEY SHARE) yalnız FOR UPDATE bloklar (FOR NO KEY UPDATE
          // yetmez). Sonra toDelete-scope taze link kontrolü: araya giren INSERT ya
          // guard'da yakalanır (409) ya da silme sonrası FK ihlaliyle düşer.
          await tx.$queryRaw`SELECT id FROM order_lines WHERE id = ANY(${toDelete}::uuid[]) FOR UPDATE`;
          // ⚠️ KAPSAM İPTAL EDİLMİŞ İŞ EMİRLERİNİ DE İÇERİR (2026-08-29 / K5).
          // Eskiden yalnız CANLI iş emirleri sayılıyordu; iptal edilmiş bir iş
          // emrine bağlı kalem silinebiliyor ve bağ satırı `onDelete: Cascade`
          // ile SESSİZCE düşüyordu → "bu iş emri hangi sipariş için açıldı"
          // olgusu hiçbir iz bırakmadan kayboluyordu (BULGU-T1-100; sahada 3
          // satır bu durumdaydı). Artık bağ DB seddiyle de korunuyor
          // (`work_order_to_order_lines_orderLineId_fkey` → RESTRICT), yani bu
          // kontrol kalkarsa kullanıcı ham FK hatası görürdü — mesajı veren yer
          // burası, koruma ise DB'de.
          const linkedToDeleted = await tx.workOrderToOrderLine.findFirst({
            where: { orderLineId: { in: toDelete }, ...ACTIVE_ORDER_LINK },
            select: { workOrderId: true, workOrder: { select: { status: true, workOrderNumber: true } } },
          });
          if (linkedToDeleted) {
            const wo = linkedToDeleted.workOrder;
            const iptalli =
              wo.status === WorkOrderStatus.CANCELLED || wo.status === WorkOrderStatus.SUPERSEDED;
            throw AppError.conflict(
              iptalli
                ? `Bu kalem için ${wo.workOrderNumber} ${TERIM.terbiyeIsEmri.tekilKucuk} açılmış — ${TERIM.terbiyeIsEmri.tekilKucuk} iptal edilse de kayıt duruyor ve silinemez. ` +
                  "Kalemi silmek yerine İPTAL edin; sevk edilmiş metraj ve geçmiş korunur."
                : `${TERIM.terbiyeIsEmri.cumleBasi.yalin} açılmış siparişin kalemleri değiştirilemez. Önce ${TERIM.terbiyeIsEmri.cekimKucuk.belirtme} iptal edin.`,
            );
          }
          await tx.orderLine.deleteMany({ where: { id: { in: toDelete } } });
        }

        for (const raw of incomingLines) {
          const propertyIds: string[] = Array.isArray(raw.requiredPropertyIds)
            ? [...new Set((raw.requiredPropertyIds as string[]).filter(Boolean))]
            : [];

          // SATIR WHITELIST (M-3): shippedQty (sevk defteri — forge edilirse
          // recompute header'a TERFİ ettirir) ve orderId (satırı başka siparişe
          // taşıma) dahil bilinmeyen her anahtar atılır; yalnız gerçek
          // düzenlenebilir kalem alanları geçer.
          const lineData: Record<string, unknown> = {};
          for (const key of Object.keys(raw)) {
            if (ORDER_LINE_WRITABLE.has(key)) lineData[key] = raw[key];
          }

          const existingLine =
            typeof raw.id === "string" ? existingById.get(raw.id as string) : undefined;
          // Birim: yeni satırda ve kalem değişiminde kalemden (ya da açık
          // gönderilen değerden); mevcut satırda gönderilmediyse DOKUNULMAZ.
          const unitSent = raw.unit != null && raw.unit !== "";
          const itemChanged =
            existingLine != null && typeof raw.itemId === "string" && raw.itemId !== existingLine.itemId;
          if (!existingLine || unitSent || itemChanged) {
            lineData.unit = this.resolveLineUnit(raw, unitByItem);
          } else {
            delete lineData.unit;
          }

          if (existingLine) {
            const lineId = existingLine.id;
            // İptal edilmiş kalem SALT-OKUNUR: bayat bir formdan gelen değişiklik
            // sessizce yutulur (400 atmak, kullanıcının dokunmadığı bir satır
            // yüzünden tüm kaydı düşürürdü — form kalemleri toptan gönderir).
            if (cancelledLineIds.has(lineId)) continue;
            await tx.orderLine.update({ where: { id: lineId }, data: lineData });

            const currentPropIds = new Set(
              existingLine.requiredProperties.map((p) => p.propertyId)
            );
            const incomingPropIds = new Set(propertyIds);
            const propsToDelete = [...currentPropIds].filter(
              (pid) => !incomingPropIds.has(pid)
            );
            const propsToAdd = [...incomingPropIds].filter(
              (pid) => !currentPropIds.has(pid)
            );

            if (propsToDelete.length > 0) {
              await tx.orderLineRequiredProperty.deleteMany({
                where: { orderLineId: lineId, propertyId: { in: propsToDelete } },
              });
            }
            if (propsToAdd.length > 0) {
              await tx.orderLineRequiredProperty.createMany({
                data: propsToAdd.map((propertyId) => ({ orderLineId: lineId, propertyId })),
                skipDuplicates: true,
              });
            }
            // Hedef değer kümesi ③b replace: gövdede yoksa dokunulmaz (eski istemci), fark yoksa yazılmaz.
            const targets = preparedTargetValues(raw);
            if (targets && targetSetChanged(existingLine.targetValues, targets)) {
              await tx.orderLineTargetValue.deleteMany({ where: { orderLineId: lineId } });
              if (targets.length > 0) {
                await tx.orderLineTargetValue.createMany({
                  data: targets.map((t) => ({ orderLineId: lineId, propertyId: t.propertyId, valueId: t.valueId })),
                });
              }
              targetChanges.push({ lineId, eski: existingLine.targetValues, yeni: targets });
            }
          } else {
            await tx.orderLine.create({
              data: {
                ...(lineData as Prisma.OrderLineUncheckedCreateInput),
                orderId: id,
                ...(propertyIds.length > 0
                  ? {
                      requiredProperties: {
                        create: propertyIds.map((propertyId) => ({ propertyId })),
                      },
                    }
                  : {}),
                ...lineTargetValuesNestedCreate(preparedTargetValues(raw)),
              },
            });
          }
        }
      }

      if (Object.keys(cleanData).length > 0) {
        // A10 (2026-07-31 denetimi): header yazımı tx-içi TAZE durum claim'iyle —
        // pre-tx status okuması (1763) ile commit arasında eşzamanlı cancel/
        // manual-close/kısmi-sevk araya girerse müşteri/şube/termin yazımı
        // terminal veya kısıtlı duruma sızmasın. Beklenen durum pre-tx okunandır;
        // değiştiyse 409 — istemci taze veriyle tekrar dener.
        const claimed = await tx.order.updateMany({
          where: { id, status: current.status },
          data: {
            ...cleanData,
            ...(retarget ? { destination: (await resolveShipmentDestination(tx, retarget)).destination } : {}),
          },
        });
        if (claimed.count === 0) {
          throw AppError.conflict(
            "Sipariş durumu bu sırada değişti — sayfayı yenileyip tekrar deneyin.",
          );
        }
      }

      // Satırlar değiştiyse denormalize sevk toplamı + durumu YENİDEN HESAPLA.
      // recomputeOrderStatusTx = Order.shippedQty + status tek yazma noktası (şema notu).
      // Satır ekleme/silme/quantity düzenlemesi sonrası çağrılmazsa Order.shippedQty
      // ve status, satırların gerçeğinden bayatlar (Σline.shippedQty ile drift).
      if (incomingLines) {
        await recomputeOrderStatusTx(tx, id);
      }

      return tx.order.findUnique({
        where: { id },
        ...(this.config.defaultInclude
          ? { include: this.config.defaultInclude as Prisma.OrderInclude }
          : {}),
      });
    });

    // "Ne değişti": başlık farkı (BaseService kalıbı, diffFields) + kalem özeti. Tx DIŞINDA.
    const oldHeader: Record<string, unknown> = {};
    for (const key of Object.keys(cleanData)) oldHeader[key] = (current as Record<string, unknown>)[key];
    const changes = diffFields(oldHeader, cleanData);
    const lineSummary = incomingLines ? summarizeLineEdit(current.lines, incomingLines) : null;
    if (lineSummary) changes.push(lineSummary);
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: oldHeader,
      newData: {
        ...cleanData,
        ...(incomingLines ? { linesCount: incomingLines.length } : {}),
        ...(targetChanges.length > 0 ? { hedefDegerleri: targetChanges } : {}),
      },
      changes,
    });

    // Müşteriye-özel ad terfisi (create ile aynı kural). Müşteri değiştiyse
    // yeni müşteri baz alınır; lines payload gelmediyse atlanır.
    if (incomingLines) {
      const finalCustomerId =
        typeof cleanData.customerId === "string"
          ? cleanData.customerId
          : current.customerId;
      await this.promoteCustomerAliases(finalCustomerId, incomingLines, userId);
    }

    return withExtraWarnings(
      this.withUnitWarnings({ success: true, data: updated, message: "Sipariş güncellendi" }),
      [...(lineCheck?.warnings ?? []), ...riskWarnings],
    );
  }

  /**
   * Soft-delete (cancel) an order.
   *
   * Business Rules (R1 — sipariş iptal çift yönlü tutarlılık):
   *   - Sipariş hiçbir WO'ya bağlı değilse sorunsuz iptal.
   *   - PLANNED durumdaki WO bağları varsa → join satırlarını otomatik kopar
   *     (WO hayatta kalır, operatör isterse STOCK_PRODUCTION'a çevirir).
   *   - IN_PROGRESS / COMPLETED durumda WO varsa → 409 conflict.
   *     Operatör önce o WO'yu iptal etmeli.
   */
  /**
   * Siparişin bağlı olduğu AKTİF (PLANNED) sevkiyatları döner.
   * İptal/manuel kapatma bu bağ varken bloklanır: aktif sevkiyat dispatch'te
   * bu siparişe tahsis+shippedQty yazacaktı; computeShipmentAllocation iptal/
   * kapalı siparişi tahsis dışı bıraksa da operatör niyeti netleşmeli — önce
   * sipariş sevkiyattan çıkarılmalı ya da sevkiyat tamamlanmalı/iptal edilmeli.
   */
  private async getActiveShipmentLinks(
    orderId: string
  ): Promise<Array<{ id: string; shipmentNo: string; status: ShipmentStatus }>> {
    return getActiveShipmentLinksImpl(orderId);
  }

  private assertNoActiveShipments(
    activeShipments: Array<{ shipmentNo: string; status: ShipmentStatus }>,
    eylem: string
  ): void {
    return assertNoActiveShipmentsImpl(activeShipments, eylem);
  }

  /**
   * Fiziksel silme YOK ("asla fiziksel DELETE" kuralı). BaseService.hardDelete
   * guard'sız prisma.delete çalıştırır ve Order→OrderLine→WorkOrderToOrderLine
   * Cascade zinciri üretimdeki WO'yu sessizce yetim bırakır, MRP talebi
   * kaybolur, SystemLog recordId'leri boşa düşer — softDelete'in 409 blokajı,
   * cancel-preview ve CONVERT_TO_STOCK akışının tamamı atlanırdı. /permanent
   * çağrısı guard'lı iptale yönlendirilir (WorkOrderService.hardDelete'in
   * arşive çevrilmesiyle aynı desen).
   */
  /**
   * SİPARİŞ KALEMİ RENGİNİ DEĞİŞTİR (2026-08-21 — "Rengi Değiştir → siparişi de
   * düzelt" seçeneği). Genel `update` iş emri bağlı siparişin kalemlerine
   * KAPALIDIR ("önce iş emrini iptal edin") ve o kural korunur; bu uç yalnız
   * RENK alanını, SEBEPLE ve audit iziyle gevşetir: müşteri telefonla rengi
   * değiştirdiğinde plan (iş emri) + sözleşme (sipariş kalemi) aynı anda
   * düzeltilebilsin, sipariş iptal edilip yeniden açılmasın.
   *
   * Kapsam BİLİNÇLİ DAR: kumaş / metraj / en DEĞİŞMEZ (metraj tahsis ve sevk
   * defterine bağlı, kumaş kimliktir). İptal edilmiş / tamamlanmış siparişte
   * çalışmaz. Kural seti WO hedef rengiyle aynı: renk aktif + müşteriye
   * atanabilir + kumaşın izinli renk listesi.
   */
  async changeLineColor(
    orderId: string,
    lineId: string,
    colorId: string | null,
    reason: string,
    userId?: string,
  ): Promise<ApiResponse<{ lineId: string; previousColorId: string | null; colorId: string | null }>> {
    return changeLineColorImpl(orderId, lineId, colorId, reason, userId);
  }

  async hardDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    return hardDeleteImpl.call(this as unknown as OrderServiceThis, id, userId);
  }

  async softDelete(
    id: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    return softDeleteImpl.call(this as unknown as OrderServiceThis, id, userId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // İptal Akışı (Preview + Per-WO Action) — R1.2
  //
  // Operatör "Sipariş Sil" derken katı 409 yerine WO başına seçim sunulur:
  //   - PLANNED WO          → otomatik UNLINK_ONLY (üretim yok, sessiz kopar)
  //   - IN_PROGRESS ya da COMPLETED + tek-sipariş WO
  //                         → UNLINK_ONLY | CONVERT_TO_STOCK | CANCEL_WO
  //                           (CANCEL_WO sadece IN_PROGRESS için)
  //   - IN_PROGRESS ya da COMPLETED + çoklu-sipariş WO
  //                         → sadece UNLINK_ONLY (diğer siparişler ayakta)
  //
  // Frontend önce `getCancelPreview` ile etkilenecek WO listesini alır,
  // operatör seçimini yapar, `cancelWithActions` ile uygular.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * İptal "dry-run" — operatöre detaylı onay göstermek için.
   * Aksiyon belirlenmemiş ham bilgi döner; karar matrisi de döner ki frontend
   * tek noktadan default'u alabilsin.
   */
  async getCancelPreview(orderId: string): Promise<ApiResponse<unknown>> {
    return getCancelPreviewImpl.call(this as unknown as OrderServiceThis, orderId);
  }

  /**
   * Planlamacı: Preview'ı görüp her WO için seçim yaptıktan sonra çağrılır.
   * `workOrderActions` boş gelirse default davranış uygulanır (preview ile
   * aynı): PLANNED → UNLINK_ONLY, IN_PROGRESS+ tek-sipariş → CONVERT_TO_STOCK,
   * çoklu-sipariş → UNLINK_ONLY.
   *
   * Sıra: önce CANCEL_WO aksiyonları (WorkOrderService.softDelete cascadeleriyle),
   * sonra tek transaction içinde join temizliği + WO type değişimi + order
   * iptal. CANCEL_WO öncesi başarılı, sonrası başarısız olursa orphan WO
   * iptal kalır — operatör tekrar denerse idempotent (zaten iptal).
   */
  async cancelWithActions(
    orderId: string,
    workOrderActions: Array<{ workOrderId: string; action: CancelAction }>,
    userId?: string,
    reason?: { reasonCode?: string | null; reasonText?: string | null }
  ): Promise<ApiResponse<unknown>> {
    this.assertNoActiveShipments(await this.getActiveShipmentLinks(orderId), "İptal");

    // SEBEP ÇÖZÜMÜ TX DIŞINDA (top iptalindeki kural): `resolveReasonCode`
    // katalog önbelleğini okur ve gerekirse tazeler — tx içinde çağrılırsa
    // kilidi ağ/DB turu kadar uzatır. Geçersiz açık kod burada 400 verir, yani
    // iptal hiç başlamadan durur.
    //
    // Metin GÖRÜNEN kayıt, kod RAPOR ANAHTARI. Serbest metin yazıldıysa kod
    // NULL kalır ve UYDURULMAZ — rapor "Diğer" kovasında değil "kodsuz"
    // kovasında gösterir.
    const { code: cancelReasonCode, text: cancelReasonText } = reason
      ? await resolveReasonCode(ReasonPresetKind.ORDER_CANCEL, reason)
      : { code: null, text: null };
    const previewRes = await this.getCancelPreview(orderId);
    const preview = previewRes.data as {
      orderId: string;
      orderNumber: string;
      affectedWorkOrders: Array<{
        id: string;
        status: string;
        isSoleOrder: boolean;
        allowedActions: CancelAction[];
        defaultAction: CancelAction;
      }>;
    };

    // Her WO için seçilen aksiyonu belirle (operatör vermediyse default).
    const actionByWO = new Map<string, CancelAction>();
    for (const wo of preview.affectedWorkOrders) {
      const provided = workOrderActions.find((a) => a.workOrderId === wo.id);
      if (provided) {
        if (!wo.allowedActions.includes(provided.action)) {
          throw AppError.badRequest(
            `WO ${wo.id} için '${provided.action}' geçersiz. İzinli: ${wo.allowedActions.join(", ")}`
          );
        }
        actionByWO.set(wo.id, provided.action);
      } else {
        // FAIL-CLOSED: varsayılan da izinli listeden geçer. `pickDefaultAction`
        // artık listeden türetiyor, yani buraya düşmek imkânsız — ama ayrışma
        // bir daha olursa SESSİZ 400 yerine sebebini söyleyen bir hata çıksın
        // (T2-005'in bedeli sessizliğiydi: operatör "Sayfayı yenileyin" görüp
        // yeniliyor ve aynı duvara çarpıyordu).
        if (!wo.allowedActions.includes(wo.defaultAction)) {
          throw AppError.badRequest(
            `${TERIM.terbiyeIsEmri.cumleBasi.yalin} ${wo.id} için varsayılan aksiyon ('${wo.defaultAction}') izinli değil ` +
              `(izinli: ${wo.allowedActions.join(", ")}). Bu bir sunucu tutarsızlığıdır — ` +
              "sipariş iptali için destek ekibine bildirin.",
          );
        }
        actionByWO.set(wo.id, wo.defaultAction);
      }
    }

    // 1) CANCEL_WO aksiyonları — WorkOrderService.softDelete cascadeleriyle.
    //    Dynamic import: workorder.service.ts → order.service.ts döngüsünden
    //    kaçınmak için.
    const cancelWoIds = preview.affectedWorkOrders
      .filter((wo) => actionByWO.get(wo.id) === "CANCEL_WO")
      .map((wo) => wo.id);
    if (cancelWoIds.length > 0) {
      const { WorkOrderService } = await import("./workorder.service");
      const woService = new WorkOrderService();
      for (const woId of cancelWoIds) {
        await woService.softDelete(woId, userId, {
          // Sebep kolonu boş kalmasın: iş emri siparişle birlikte iptal edildi.
          reason: cancelReasonText ? `Sipariş iptali: ${cancelReasonText}` : "Sipariş iptali",
          trigger: "ORDER_CANCEL",
        });
      }
    }

    // 2) Tek transaction: convert + unlink + order cancel.
    await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM (check-then-act DEĞİL): tx başında siparişi non-terminal
      // iddia et + write-kilitle. Yıkıcı işlem preview+per-record onayıyla korunuyor;
      // bu yalnız eşzamanlılık/replay sertleştirmesi (iki paralel iptal, ya da
      // sipariş bu arada COMPLETED'a geçtiyse → 409). Claim status=CANCELLED'i de set
      // ettiğinden eski sondaki koşulsuz order.update kaldırıldı.
      const cancelClaim = await tx.order.updateMany({
        where: {
          id: orderId,
          status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] },
        },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: cancelReasonText,
          cancelReasonCode,
        },
      });
      if (cancelClaim.count === 0) {
        const fresh = await tx.order.findUnique({
          where: { id: orderId },
          select: { status: true },
        });
        throw AppError.conflict(
          `Sipariş bu sırada ${
            fresh?.status === OrderStatus.COMPLETED ? "tamamlandı" : "iptal edildi"
          }, tekrar iptal edilemez. Sayfayı yenileyin.`
        );
      }
      // F145: preview↔apply arası WO status yarışını kapat. Etkilenen WO'ları
      // SIRALI kilitle (WO start/dispatch/finalize/cancel yolları da bu satırı
      // kilitler → serileşir), sonra TAZE status + TAZE sole-order oku ve her
      // non-CANCEL aksiyonu bayat preview yerine güncel duruma karşı doğrula.
      const affectedWoIds = [...new Set(preview.affectedWorkOrders.map((w) => w.id))].sort();
      for (const wid of affectedWoIds) await touchWorkOrderTx(tx, wid); // döngü — Promise.all(tx.*) YASAK
      const freshRows = await tx.workOrder.findMany({
        where: { id: { in: affectedWoIds } },
        select: { id: true, status: true },
      });
      const freshStatus = new Map(freshRows.map((r) => [r.id, r.status]));
      const otherLinks = await tx.workOrderToOrderLine.findMany({
        where: { workOrderId: { in: affectedWoIds }, orderLine: { orderId: { not: orderId } }, ...ACTIVE_ORDER_LINK },
        select: { workOrderId: true },
      });
      const hasOther = new Set(otherLinks.map((l) => l.workOrderId));
      for (const wo of preview.affectedWorkOrders) {
        const action = actionByWO.get(wo.id)!;
        if (action === "CANCEL_WO") continue; // adım 4'te kendi claim'iyle iptal edilir
        const fs = freshStatus.get(wo.id);
        if (!fs) {
          throw AppError.conflict(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bu sırada kaldırıldı, tekrar deneyin. Sayfayı yenileyin.`);
        }
        if (!computeAllowedActions(fs, !hasOther.has(wo.id)).includes(action)) {
          throw AppError.conflict(
            `${TERIM.terbiyeIsEmri.cumleBasi.yalin} durumu değişti (önizleme bayatladı). Sayfayı yenileyip iptali tekrar onaylayın.`,
          );
        }
      }
      // Önizleme sonrası bu siparişe DOĞAN yeni WO bağı → onaysız kopmayı engelle.
      const currentLinks = await tx.workOrderToOrderLine.findMany({
        where: { ...ACTIVE_ORDER_LINK, orderLine: { orderId }, workOrder: { status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] } } },
        select: { workOrderId: true },
      });
      if (currentLinks.some((l) => !affectedWoIds.includes(l.workOrderId))) {
        throw AppError.conflict(
          `Önizleme sonrası bu siparişe yeni ${TERIM.terbiyeIsEmri.tekilKucuk} bağlandı. Sayfayı yenileyip iptali tekrar onaylayın.`,
        );
      }

      for (const wo of preview.affectedWorkOrders) {
        const action = actionByWO.get(wo.id)!;
        if (action === "CONVERT_TO_STOCK") {
          const conv = await setWorkOrderTypeTx(tx, wo.id, WorkOrderType.STOCK_PRODUCTION, {
            where: { status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] } },
            ctx: { trigger: "ORDER_CANCEL", userId, refType: "ORDER", refId: orderId },
          });
          if (conv === "NO_MATCH") {
            throw AppError.conflict(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bu sırada iptal edildi, stoğa çevrilemedi. Sayfayı yenileyin.`);
          }
        }
        // UNLINK_ONLY / CONVERT_TO_STOCK / CANCEL_WO hepsi bağı KOPARIR — silmez, damgalar (③a).
        await unlinkOrderLinesTx(tx, { workOrderId: wo.id, orderId, reason: "ORDER_CANCEL", userId: userId ?? null });
        // REFAKAT KARTI BAYAT (2026-08-21): kartta SİPARİŞ bloğu + iş emri TİPİ
        // basılıdır (`buildPlan` → orderLinks). Sipariş iptali o bloğu değiştirir →
        // sahadaki kâğıt artık olmayan bir siparişi gösterir. Emsal + simetri:
        // `workorder-link.service` bağ EKLERKEN de, KALDIRIRKEN de işaretliyor.
        // CANCEL_WO dalında kart zaten VOIDED (softDelete kaskatı) → helper ACTIVE
        // olmayan kartı atlar, yani bu çağrı orada güvenli bir no-op'tur.
        await markTravelerCardDirtyTx(tx, wo.id); // döngü — Promise.all(tx.*) YASAK
        // TİP = BAĞIN AYNASI (2026-08-21): UNLINK_ONLY tek-siparişli iş emrinde
        // son bağı da siler → iş emri hiçbir siparişe bağlı kalmaz → STOK'a
        // döner (CONVERT_TO_STOCK ile aynı sonuç; fark yalnız operatörün niyet
        // etiketi). Eskiden ORDER tipli ama bağsız "Siparişe Özel" iş emri
        // kalıyordu (PLANNED'da tek izinli aksiyon buydu). Taze sayım tx içinde,
        // kilit altında; `updateMany WHERE type=ORDER` — zaten STOK'sa dokunmaz,
        // iptal/devredilmiş iş emri de (assertPlanEditable aynası) atlanır.
        if (action === "UNLINK_ONLY") {
          const remaining = await activeOrderLinkCount(tx, wo.id);
          if (remaining === 0) {
            await setWorkOrderTypeTx(tx, wo.id, WorkOrderType.STOCK_PRODUCTION, {
              where: {
                status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
                // STOK'un değişmezi: hedef kumaş dolu (unlinkOrderLine aynası).
                targetItemId: { not: null },
              },
              ctx: { trigger: "ORDER_CANCEL", userId, refType: "ORDER", refId: orderId },
            });
          }
        }
      }
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: this.config.tableName,
      recordId: orderId,
      newData: {
        status: "CANCELLED",
        actions: Array.from(actionByWO.entries()).map(([woId, a]) => ({
          workOrderId: woId,
          action: a,
        })),
      },
    });

    const updated = await prisma.order.findUnique({ where: { id: orderId } });
    return {
      success: true,
      data: updated,
      message: `Sipariş iptal edildi (${preview.affectedWorkOrders.length} ${TERIM.terbiyeIsEmri.tekilKucuk} etkilendi)`,
    };
  }

  /**
   * Planlamacı tarafından manuel tamamlama. Tölerans dışında eksik metraj
   * kabul edildiğinde, ürün üretilmeyecekse, müşteri kabul ettiğinde vb.
   *
   * - APPROVED veya PARTIAL_SHIPPED durumdaki siparişler için.
   * - PENDING (onaysız) ya da CANCELLED kapatılamaz.
   * - Zaten COMPLETED ise no-op değil hata — yanlışlıkla tetiklenmesin.
   */
  async manualComplete(
    id: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    return manualCompleteImpl.call(this as unknown as OrderServiceThis, id, reason, userId);
  }

  /**
   * Manuel kapatılmış siparişi geri açar. Recompute sonucunda statü
   * otomatik PARTIAL_SHIPPED veya APPROVED'a döner. Sadece manuel
   * kapatılmış (manualClosedById dolu) siparişler için.
   */
  async reopen(
    id: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    return reopenImpl.call(this as unknown as OrderServiceThis, id, reason, userId);
  }
}
