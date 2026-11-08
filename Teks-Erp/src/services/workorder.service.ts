// =============================================================================
// TeksERP - WorkOrder (Parti) Service
// =============================================================================
// Handles Work Order creation, roll attachment, and document generation.
// Business Rules:
//   - A Work Order CAN exist without linked orders (producing for stock).
//   - A Work Order CAN be linked to multiple orders.
//   - WorkOrderSteps are auto-generated from the provided route stations.
//   - Rolls attached to a WO change status from STOCK → IN_PRODUCTION.
// Bölme (2026-11-08, davranış aynı): bu dosya CEPHEDİR — sınıf, dışa açık adlar ve
// metot imzaları burada; gövdeler `services/workorder/*.ts` alan modüllerinde
// kelimesi kelimesine durur (cephe metodu modül fonksiyonunu `this` bağlamıyla çağırır).
// Çağıranlar yalnız bu yoldan import eder; alan modülleri cepheyi yalnız TİP olarak okur.
// =============================================================================
/* eslint-disable max-lines -- cephe: imzalar + JSDoc devralındı; ailenin max-lines katkısı bölme öncesi gibi TEK (workorder/replace.ts sayılır) */

import prisma from "../lib/prisma";
import { ApiResponse, PaginatedResponse, QueryParams } from "../types/api.types";
import type { CursorPaginatedResponse } from "./base.service";
import { Request } from "express";
import {
  WorkOrder,
  Prisma,
} from "@prisma/client";
import {
  type WorkOrderPlaceOptions,
} from "./helpers/workorder-place-filter.helper";
import { WorkOrderSplitService } from "./workorder-split.service";
import { WorkOrderManualMoveService, type PartyMode } from "./workorder-manual-move.service";
import {
  workOrderBatchDropService,
  type BatchDropInput,
} from "./workorder-batch-drop.service";
import { generateWorkOrderNumber as generateWorkOrderNumberImpl, assertWorkOrderNumberUnique as assertWorkOrderNumberUniqueImpl, checkWorkOrderNumber as checkWorkOrderNumberImpl, create as createImpl, createFresh as createFreshImpl, prepareCreate as prepareCreateImpl, insertPreparedTx as insertPreparedTxImpl, finishCreate as finishCreateImpl, woReplay as woReplayImpl } from "./workorder/create";
import { quickStartReplay as quickStartReplayImpl, quickStart as quickStartImpl, quickStartFresh as quickStartFreshImpl } from "./workorder/quick-start";
import { buildListWhere as buildListWhereImpl, whereOptions as whereOptionsImpl, findAll as findAllImpl, withProductionMeters as withProductionMetersImpl } from "./workorder/list";
import { findById as findByIdImpl } from "./workorder/detail";
import { getBranches as getBranchesImpl, getBatchTimeline as getBatchTimelineImpl } from "./workorder/branches";
import { getCancelImpact as getCancelImpactImpl, prepareFasonCancelDecision as prepareFasonCancelDecisionImpl } from "./workorder/cancel-impact";
import { returnRawRollsOnCancelTx as returnRawRollsOnCancelTxImpl, softDelete as softDeleteImpl, cancelWorkOrderTx as cancelWorkOrderTxImpl } from "./workorder/cancel";
import { getCompletePreview as getCompletePreviewImpl, completeWorkOrder as completeWorkOrderImpl, transferRollsToNewWorkOrderTx as transferRollsToNewWorkOrderTxImpl } from "./workorder/complete";
import { hardDelete as hardDeleteImpl, attachRolls as attachRollsImpl } from "./workorder/attach-hard-delete";
import { update as updateImpl } from "./workorder/update";
import { replace as replaceImpl } from "./workorder/replace";
import { updateTargetProperties as updateTargetPropertiesImpl, getTargetPropertyChangeImpact as getTargetPropertyChangeImpactImpl, updateStepPlanning as updateStepPlanningImpl, lockWorkOrder as lockWorkOrderImpl } from "./workorder/target-planning";
import { getDocuments as getDocumentsImpl, getAttachedRolls as getAttachedRollsImpl, getTravelCard as getTravelCardImpl, computeLiveManifest as computeLiveManifestImpl, getManifest as getManifestImpl, createManifest as createManifestImpl, listManifests as listManifestsImpl, getManifestById as getManifestByIdImpl } from "./workorder/documents";
import type { PreparedWorkOrder } from "./workorder/create";
import type { CancelWorkOrderTxInput } from "./workorder/cancel";
import type { CompleteWorkOrderInput } from "./workorder/complete";
import type { CancelWorkOrderInput, WorkOrderCreateInput, WorkOrderServiceThis } from "./workorder/shared";

export { WO_LIST_CUSTOMER_LINKS } from "./workorder/list";
export type { CancelWorkOrderTxInput } from "./workorder/cancel";
export type { CloseDisposition, CloseDispositionInput, CompleteWorkOrderInput } from "./workorder/complete";
export { assertRouteRefsActive } from "./workorder/shared";
export type { CancelDisposition, CancelWorkOrderInput, WorkOrderCreateInput } from "./workorder/shared";


const workOrderSplitService = new WorkOrderSplitService();
const workOrderManualMoveService = new WorkOrderManualMoveService();

export class WorkOrderService {
  /**
   * Auto-generate an iş emri numarası (workOrderNumber): "IE" + GGAAYY + NNNN
   * (örn IE1207260001). Günlük sıra work_orders'taki mevcut maksimum +1.
   * (Parti no P… AYRI kimliktir — `batch.service.generateBatchNumberTx` üretir.)
   */
  async generateWorkOrderNumber(db: Pick<typeof prisma, "workOrder"> = prisma): Promise<string> {
    return generateWorkOrderNumberImpl(db);
  }

  /**
   * Kullanıcının verdiği iş emri numarası (workOrderNumber) benzersiz mi? Değilse net
   * Türkçe hata fırlatır. excludeId verilirse o iş emrini hariç tutar (güncelleme).
   * DB @unique kısıtı backstop'tur; bu ön-kontrol generic P2002 yerine anlaşılır
   * mesaj verir (auto modda withBarcodeRetry'ın yanıltıcı "Barkod..." hatasını da önler).
   */
  private async assertWorkOrderNumberUnique(
    workOrderNumber: string,
    excludeId?: string,
  ): Promise<void> {
    return assertWorkOrderNumberUniqueImpl(workOrderNumber, excludeId);
  }

  /**
   * Verilen iş emri numarası (workOrderNumber) kullanılabilir mi? Form alanı blur'unda
   * canlı kontrol için — kaydetmeden önce "bu numara daha önce verilmiş mi"
   * uyarısı. excludeId verilirse o iş emrini hariç tutar (düzenleme modu kendi
   * kodunu çakışma saymaz). Boş kod = kullanılabilir (otomatik üretilecek).
   */
  async checkWorkOrderNumber(
    workOrderNumber: string,
    excludeId?: string,
  ): Promise<{ workOrderNumber: string; available: boolean }> {
    return checkWorkOrderNumberImpl(workOrderNumber, excludeId);
  }

  /**
   * Create a new Work Order.
   *
   * Kurallar:
   *   - routeTemplateId verilirse RouteStep'ler WorkOrderStep'e kopyalanır (copy-on-write snapshot).
   *     Bu durumda `steps` verilmemelidir; verilirse reddedilir.
   *   - routeTemplateId verilmezse `steps` zorunlu.
   *   - sipariş bağı (orderLineIds/orderLineAllocations) link-only; metraj taşımaz.
   *   - type=ORDER_PRODUCTION ise en az bir sipariş bağı zorunlu.
   *   - batchNumber (Parti Kodu) verilmezse otomatik üretilir (P+GGAAYY+NNNN);
   *     verilirse benzersizliği doğrulanır.
   */
  /** İş emri oluştur (R): token her kuraldan önce okunur, oluşturma hangi hatayla düşerse düşsün yeniden okunur. */
  async create(
    ...args: Parameters<WorkOrderService["createFresh"]>
  ): ReturnType<WorkOrderService["createFresh"]> {
    return createImpl.call(this as unknown as WorkOrderServiceThis, ...args);
  }

  private async createFresh(
    data: WorkOrderCreateInput,
    userId?: string,
    /**
     * ELDEKİ MAL — iş emrine bağlanacak topların HÂLİHAZIRDA taşıdığı nitelikler.
     *
     * Yalnız `quickStart` doldurur (tek yol: top okutarak açılan iş emri). Rota
     * kapsaması kontrolünü DARALTMAK için kullanılır — bkz. `assertRouteCoversTargets`
     * çağrısındaki gerekçe. Verilmezse davranış eskisiyle birebir aynı (F221 deseni:
     * alan yoksa muafiyet yok).
     */
    goods?: { colorIds: (string | null)[]; propertyIdSets: string[][] },
  ): Promise<ApiResponse<WorkOrder> & { idempotentReplay?: boolean }> {
    return createFreshImpl.call(this as unknown as WorkOrderServiceThis, data, userId, goods);
  }

  /** Tx ÖNCESİ doğrulama + normalizasyon (SY-M1: üretim önerisi aynı çekirdeği kendi tx'inde çağırır; ikinci yaratma yolu yok). */
  async prepareCreate(data: WorkOrderCreateInput, goods?: { colorIds: (string | null)[]; propertyIdSets: string[][] }) {
    return prepareCreateImpl.call(this as unknown as WorkOrderServiceThis, data, goods);
  }

  /** Tx gövdesi — `numberDb` verilmezse numara bugünkü gibi tx DIŞINDAN okunur; çok kayıtlı tx kendi tx'ini verir (kendi satırını görsün). */
  async insertPreparedTx(tx: Prisma.TransactionClient, prep: PreparedWorkOrder, userId?: string, numberDb: Pick<typeof prisma, "workOrder"> = prisma) {
    return insertPreparedTxImpl.call(this as unknown as WorkOrderServiceThis, tx, prep, userId, numberDb);
  }

  /** Tx SONRASI: audit + karar uyarıları (commit'ten sonra okunur). */
  async finishCreate(workOrder: Awaited<ReturnType<WorkOrderService["insertPreparedTx"]>>, prep: PreparedWorkOrder, userId?: string) {
    return finishCreateImpl(workOrder, prep, userId);
  }

  /**
   * create() replay'i: iptal/arşivlenmiş iş emri 409 `WORK_ORDER_CANCELLED`; kimlik YALNIZ gövdede verilen alanlar —
   * sipariş satırı kümesi (her zaman), hedef kumaş ve tip (verildiyse). Türetilmiş tip kimlik olmaz: `WorkOrder.type`
   * bağın aynasıdır. İlk commit refakat kartı dahil her şeyi yazdı; audit yalnız gerçek create yolunda.
   */
  woReplay(data: WorkOrderCreateInput) {
    return woReplayImpl(data);
  }

  /**
   * quickStart replay'i: kimlik hedef kumaş (verildiyse o, yoksa okutulan topların tek kumaşı) + sipariş satırları.
   * ⚠️ TOP KÜMESİ BİLEREK YOK: hızlı iş emri kısmi bağlayabilir (bağlanamayan toplar `errors`ta) — küme eşitliği
   * meşru zaman aşımı tekrarını sahte 409'a düşürürdü.
   */
  private quickStartReplay(data: WorkOrderCreateInput, barcodes: string[]) {
    return quickStartReplayImpl(data, barcodes);
  }

  /**
   * Mobil "Hızlı İş Emri" — okutulan stok toplarından tek istekte WO başlatır.
   *
   * Akış:
   *   1) Barkodları ön-doğrula: hepsi var + STOCK + aynı ürün (kural: tek WO = tek
   *      kumaş). targetItemId verilmemişse topların ürününden türetilir (basit mod).
   *   2) create() ile WO oluştur (kendi tx'i + refakat kartı).
   *   3) attachRolls() ile bağla (kendi tx'i; STOCK → IN_PRODUCTION, ilk adım).
   *   4) Hiç top bağlanamazsa (örn. yarış koşulu) WO'yu arşivle — yetim WO bırakma.
   *
   * create/attachRolls kendi transaction'larını sahiplenir; aralarındaki pencere
   * aynı request içinde milisaniyeler olduğundan ön-doğrulama + telafi yaklaşımı,
   * iki metodu tek tx'e zorlayan riskli refactor'a tercih edildi.
   */
  /** Hızlı iş emri (R): create'in boğazı içeride de koşar; dıştaki boğaz ön-doğrulama hatalarını da kapsar. */
  async quickStart(
    ...args: Parameters<WorkOrderService["quickStartFresh"]>
  ): ReturnType<WorkOrderService["quickStartFresh"]> {
    return quickStartImpl.call(this as unknown as WorkOrderServiceThis, ...args);
  }

  private async quickStartFresh(
    data: WorkOrderCreateInput & { rollBarcodes: string[]; dispatchFirstStep?: boolean; sourceNoteId?: string | null; /** S1 çok parti: belgenin bu partisinin no'su (nottaki ourBatchNo yerine). */ sourceBatchNo?: string | null },
    userId?: string,
  ): Promise<
    ApiResponse<{
      workOrder: WorkOrder;
      attached: number;
      errors: string[];
      dispatch: { id: string; dispatchNo: string } | null;
      /** Topların bağlandığı PARTİ — İş Emri No ile AYRI kavram. Çözülemezse null. */
      batch: { id: string; batchNumber: string } | null;
    }>
  > {
    return quickStartFreshImpl.call(this as unknown as WorkOrderServiceThis, data, userId);
  }

  /**
   * Liste where'i — TEK KAYNAK: `findAll` (liste + cursor + sayım) ve `whereOptions`
   * (faceted seçenek sayımı) buradan kurar. `params.filters` TÜKETİLİR (okunan
   * anahtarlar silinir); her kurulum taze `parseQueryParams` ister.
   */
  async buildListWhere(req: Request, params: QueryParams): Promise<Prisma.WorkOrderWhereInput> {
    return buildListWhereImpl(req, params);
  }

  /**
   * "Şu an hangi fasonda" seçenekleri listenin O ANKİ süzgeçleri içinde (faceted):
   * firma sayısı = liste süzgeçleri − `fasonFirma` + o firma → seçilince liste toplamı.
   * Tanınmayan süzgeç değeri listeyle aynı 400 (aynı kurucu).
   */
  async whereOptions(req: Request): Promise<WorkOrderPlaceOptions> {
    return whereOptionsImpl.call(this as unknown as WorkOrderServiceThis, req);
  }

  /**
   * List work orders with dynamic filtering, sorting, pagination.
   *
   * Query param: `?withOrderDetail=true`
   *   - orderLinks → orderLine + order + customer + item + variant açar
   *   - targetItem (renk/özellikler dahil) join'lenir
   *   - Her WO'ya `dispatchedTotalQty` (iptal edilmemiş fason sevklerinin toplamı) eklenir
   *   - Mobil "Fason Sevk" iş emri picker'ı için tasarlanmıştır; web admin liste hala
   *     hafif projeksiyonla çalışır (geri uyumluluk).
   */
  async findAll(
    req: Request
  ): Promise<PaginatedResponse<unknown> | CursorPaginatedResponse<unknown>> {
    return findAllImpl.call(this as unknown as WorkOrderServiceThis, req);
  }

  /**
   * Liste WO'larına ÜRETİLEN METRAJI ekler (ilerleme kolonu için). Detay
   * sayfasının `producedRolls.totalMeters` tanımıyla aynı küme
   * (`producedOutputWhere`); YALNIZ fire (katalogda `targetStatus=SCRAP`) olan
   * rulolar dışlanır — A1 (2. kalite) SATILABİLİR olduğu için SAYILIR; initialQty
   * toplamı. Tek groupBy ile sayfa başına 1 sorgu. Ayrıca üretime GİREN ham
   * metrajı ve bağlı SİPARİŞ TOPLAMINI (talep) ekler. Patron bulutu projeksiyonu
   * (`cloud-sync` · iş emri) aynı sayıları buradan okur — liste ile bulut ayrışmasın.
   */
  async withProductionMeters<
    T extends {
      id: string;
      // `station` ve `orderLinks` OPSİYONEL: liste select'i ikisini de getirir ve
      // aşağıdaki rollup geçişleri onları BELLEKTEN okur (aynı satırı ikinci kez
      // sorgulamamak için). Gelmezlerse geçişler DB turuna düşer — davranış aynı.
      steps: { id: string; stepSequence: number; station?: { name: string } | null }[];
      orderLinks?: { orderLineId: string; orderLine?: { order?: { customer?: { id: string; name: string } | null } | null } | null }[];
      /** Fason (müşteri malı) İE'nin kendi müşterisi — varsa rollup'ın önüne geçer. */
      customer?: { id: string; name: string } | null;
    },
  >(
    wos: T[]
  ): Promise<
    (T & {
      producedMeters: number;
      inputMeters: number;
      orderedMeters: number;
      /** Bağlı siparişlerin DISTINCT müşterileri (bağlanma sırası, ≤5) + toplam; bağsız İE'de top sahipleri — liste "Müşteri" kolonu. */
      customers: { id: string; name: string }[];
      customerCount: number;
      /** Şu an mal tutulan fason istasyon adları (genelde tek) — liste rozeti. */
      currentFasonStations: string[];
      /**
       * Bu iş emrinin GEÇMİŞTE VE ŞU AN gittiği fason firmalar (2026-08-17, madde 14).
       * `currentFasonStations` yalnız "şu an dışarıda mal var mı" sorusunu
       * cevaplıyordu; adım geçildiğinde firma bilgisi listede kayboluyordu.
       * Planlamacının sorusu ise "bu işi kim yaptı" — o yüzden İPTAL EDİLMEMİŞ
       * tüm sevkler okunur ve `current` ile ayrıca işaretlenir.
       */
      fasonFirms: { name: string; current: boolean }[];
    })[]
  > {
    return withProductionMetersImpl(wos);
  }

  /**
   * Get single work order by ID.
   */
  async findById(id: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    return findByIdImpl(id);
  }

  /**
   * Bir iş emrinin PARTİLERİ (Batch lane'leri) — "Dallar" panelinin yeni kaynağı.
   *
   * Her parti (Batch) bir lane'dir: üyesi topların ŞU ANKİ konum dağılımı (istasyon
   * adı / statü etiketi), aktif refakat kartı, fason sevk durumu (K10: bir sevk =
   * bir parti) ve soy bağı (splitFrom / splitChildren) tek bakışta görünür — "1.
   * parti Kurşun'da, 2. parti hâlâ boyahanede". Kilit TÜRETİLMİŞ (K14): fasonda
   * (AT_SUB) topu VEYA outstanding açık sevki olan parti kilitlidir; mal dönünce
   * kendiliğinden açılır. (Route uyumu için metod adı `getBranches` kaldı;
   * Electron `/branches` ucu Faz 6'da `/batches`'e döner — bkz. plan Faz 6.3.)
   */
  async getBranches(workOrderId: string): Promise<ApiResponse<unknown>> {
    return getBranchesImpl(workOrderId);
  }

  /**
   * Parti rota-zaman çizelgesi (birleşik geçmiş) — partinin TÜM toplarının hareket
   * (RollMovement: adım giriş/çıkış) ve operasyon (RollOperation: kurşun/QC2/tambur/
   * fason) log'unu ADIMA göre toplar. Performans: per-top `/rolls/:id/history` yerine
   * TEK istek + toplu (in-list) sorgu (1 round-trip). Tambur-split kopya operasyonları
   * (inheritedFromParentRollId) hariç → çift sayım yok.
   */
  async getBatchTimeline(workOrderId: string, batchId: string): Promise<ApiResponse<unknown>> {
    return getBatchTimelineImpl(workOrderId, batchId);
  }

  // ===========================================================================
  // PARTİYİ AYIR (redye üç yolu) — workorder-split.service.ts'e delege.
  // REDYE_SAME_COLOR uygulandı; NEW_COLOR/UNDYED_MOVE (WO klonlu) sonraki iterasyon.
  // ===========================================================================

  /** Parti ayırma ÖNİZLEMESİ (izinli modlar + taşınacak toplar). */
  async getSplitPreview(
    workOrderId: string,
    batchId: string,
  ): Promise<ApiResponse<unknown>> {
    return workOrderSplitService.getSplitPreview(workOrderId, batchId);
  }

  /** Partiyi ayır: REDYE_SAME_COLOR (aynı renk yeniden boyama) / NEW_COLOR / UNDYED_MOVE. */
  async splitBranch(
    workOrderId: string,
    data: {
      batchId: string;
      mode: "REDYE_SAME_COLOR" | "NEW_COLOR" | "UNDYED_MOVE";
      newColorId?: string | null;
      orderMode?: "stock" | "keep";
      rollIds?: string[];
      /**
       * Tebdil sebebi (opsiyonel) — audit'e/parti kaydına yazılır.
       * Bu ince cephe (facade) tipi `reason`'ı TAŞIMIYORDU: hem controller'ın Zod
       * şeması hem de asıl `workOrderSplitService.splitBranch` onu kabul edip
       * DB'ye yazdığı için HTTP yolu doğru çalışıyor, yalnız doğrudan TS
       * çağrıcıları (testler) "fazla alan" hatası alıyordu. Tip driftiydi.
       */
      reason?: string;
    },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return workOrderSplitService.splitBranch(workOrderId, data, userId);
  }

  /** Manuel konum düzeltme önizlemesi (süpervizör override) — hiçbir şeyi değiştirmez. */
  async getManualMovePreview(
    workOrderId: string,
    input: { batchId?: string; rollIds?: string[]; targetStepId: string },
  ): Promise<ApiResponse<unknown>> {
    return workOrderManualMoveService.getManualMovePreview(workOrderId, input);
  }

  /** Parti/top bazında rotada manuel taşıma (süpervizör override). */
  async manualMove(
    workOrderId: string,
    input: {
      batchId?: string;
      rollIds?: string[];
      targetStepId: string;
      partyMode?: PartyMode;
      joinBatchId?: string;
      reason: string;
    },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return workOrderManualMoveService.manualMove(workOrderId, input, userId);
  }

  /** Parti düşürme önizlemesi — bkz. `workorder-batch-drop.service.ts`. */
  async getBatchDropPreview(workOrderId: string, batchId: string) {
    return workOrderBatchDropService.getDropPreview(workOrderId, batchId);
  }

  /** Partiyi iş emrinden düşür — iş emri diğer partileriyle DEVAM eder. */
  async dropBatch(
    workOrderId: string,
    batchId: string,
    input: BatchDropInput,
    userId?: string,
  ) {
    return workOrderBatchDropService.dropBatch(workOrderId, batchId, input, userId);
  }

  /**
   * İptal etkisini ÖNİZLER (yıkıcı işlem onayı için). Hiçbir şeyi değiştirmez.
   * Döner: STOCK'a çekilecek toplar + VOID olacak ACTIVE refakat kartı sayısı.
   */
  async getCancelImpact(id: string): Promise<ApiResponse<unknown>> {
    return getCancelImpactImpl(id);
  }

  /**
   * Soft-delete: sets status = CANCELLED (WorkOrder has no isActive field).
   * Veritabanı mantığı:
   * 0. GUARD: Fasonda (boyahanede) işlem gören/görmüş in-flight top varsa iptal
   *    REDDEDİLİR — fason malı ham stoğa dönemez, sipariş kopsa bile stok için
   *    üretilmeye devam eder. (AT_SUBCONTRACTOR, RETURNED_FROM_SUBCONTRACTOR,
   *    veya boyanmış-dönmüş IN_PRODUCTION açık kumaş = SUBCONTRACTOR_RETURN.)
   * 1. İş Emri iptal edilir.
   * 2. Yalnız GERÇEKTEN HAM (entrySource ≠ SUBCONTRACTOR_RETURN), halen üretimdeki
   *    (currentStepId + IN_PRODUCTION) toplar geri döner — üretime alma satırı varsa
   *    alındıkları yere (bağlı tersle), yoksa STOCK'a; producedInStepId
   *    (üretim izi) KORUNUR. Bitmiş depo malları (WAREHOUSE/
   *    TAMBUR_CONSUMED) dokunulmaz.
   * 3. ACTIVE refakat kartları VOIDED'a düşer.
   * Tüm bu işlemler güvenli bir transaction bloğunda gerçekleşir.
   *
   * KARAR VEREREK İPTAL (2026-08-06): üçüncü parametre ile istasyonda kalan topların
   * bir kısmı `STOCK` yerine `SCRAP` (fire) ya da `CANCELLED` (hatalı kayıt) olarak
   * çözülebilir. Parametre VERİLMEZSE davranış bire bir eskisidir — `DELETE /:id`
   * (eski mobil APK, gövdesiz) tam olarak bu yoldan geçer, yani geriye uyum
   * ispatlanacak bir şey değil YAPISAL bir sonuçtur.
   */
  /**
   * İptal öncesi fason kararını uygular ve FİRE yazılacak top id'lerini döner.
   *
   * Neden `softDelete` içinde değil de ayrı: burada BAŞKA BİR SERVİSİN tx'i
   * çağrılıyor (`subcontractorService.cancelBulk`). İç içe tx açmak pg
   * adapter'ında tek bağlantıyı kilitler; ayrıca sevk iptali kendi başına
   * anlamlı ve geri alınabilir bir işlemdir — iptal yarıda kalsa bile mal
   * kayden içeri girmiş olur (fiziksel gerçeğe daha yakın son durum).
   */
  // eslint-disable-next-line max-params -- cephe delegasyonu; özgün imza (5 parametre) aynen korunur, kural gövdede (workorder/cancel-impact.ts) sayılır
  private async prepareFasonCancelDecision(
    workOrderId: string,
    stepIds: string[],
    input: CancelWorkOrderInput,
    userId: string | undefined,
    reason: string,
  ): Promise<{ scrapRollIds: string[]; residualRollIds: string[]; remainderClosed: boolean }> {
    return prepareFasonCancelDecisionImpl(workOrderId, stepIds, input, userId, reason);
  }

  /**
   * İptalde üretimdeki ham toplar geri döner. Üretime alma satırı olan top GELDİĞİ YERE
   * (depo/durum) döner ve satır bağlı tersle kapanır — Top Çıkar (D6) ile aynı hareket.
   * Satırı olmayan top (defter ufku öncesi bağlanmış ya da üretimde doğmuş) bugünkü gibi STOCK.
   */
  private async returnRawRollsOnCancelTx(
    tx: Prisma.TransactionClient,
    args: { hamTopWhere: Prisma.RollWhereInput; stepIds: string[]; workOrderNumber: string; userId?: string },
  ): Promise<void> {
    return returnRawRollsOnCancelTxImpl(tx, args);
  }

  async softDelete(
    id: string,
    userId?: string,
    input: CancelWorkOrderInput = {},
  ): Promise<ApiResponse<WorkOrder>> {
    return softDeleteImpl.call(this as unknown as WorkOrderServiceThis, id, userId, input);
  }

  /**
   * İş emri iptalinin TX GÖVDESİ — tek yazar: `softDelete` ve gelen belge iptali (K15, başlamamış iş emri aynı tx'te)
   * buradan geçer. Fason kararı, sebep çözümü ve audit ÇAĞIRANINDIR (tx dışı).
   */
  async cancelWorkOrderTx(tx: Prisma.TransactionClient, c: CancelWorkOrderTxInput) {
    return cancelWorkOrderTxImpl.call(this as unknown as WorkOrderServiceThis, tx, c);
  }

  /**
   * MANUEL KAPATMA ÖNİZLEMESİ (read-only): kalan (atlanacak) adımlar + in-flight
   * topların DİSPOZİSYON listesi. In-flight toplar iki kümeye ayrılır:
   *   - `dispositionRolls` → içeride (IN_PRODUCTION, açık fason sevki yok): kapatan
   *     kişi her biri için karar verir (ham stok / depo / 2. kalite / fire / hatalı
   *     kayıt / devir).
   *   - `blockedRolls`     → fasonda ya da açık fason sevkinde: KARAR VERİLEMEZ,
   *     kapatma bloklanır (mal fiziksel olarak dışarıda).
   * `canComplete` artık "WIP var" diye false OLMAZ — yalnız blocked küme (ya da WO'nun
   * kendi durumu) engeller.
   */
  async getCompletePreview(id: string) {
    return getCompletePreviewImpl(id);
  }

  /**
   * MANUEL KAPATMA + KAPANIŞ DİSPOZİSYONU: IN_PROGRESS bir iş emrini elle COMPLETED'a
   * çeker. İstasyonda kalan (IN_PRODUCTION) her top için ÇAĞIRAN karar verir
   * (`data.dispositions`) — kapatma artık "işlemde top var" diye reddedilmez; karar
   * kapanışın parçasıdır ve sebebiyle audit'e yazılır. Hâlâ hard-block olan tek şey
   * FASON: mal fiziksel olarak dışarıdaysa ofis kararı onu geri getirmez.
   *
   * Kalan PENDING/ACTIVE adımlar SKIPPED(MANUAL_COMPLETE), açık movement'lar kapatılır,
   * ACTIVE refakat kartları COMPLETED olur. Atomik claim + guard'lar tx-içinde
   * (eşzamanlı finalize/iptal ile yarış güvenli — cancel deseninin aynısı).
   */
  async completeWorkOrder(
    id: string,
    data: CompleteWorkOrderInput = {},
    userId?: string,
  ): Promise<ApiResponse<WorkOrder>> {
    return completeWorkOrderImpl.call(this as unknown as WorkOrderServiceThis, id, data, userId);
  }

  /**
   * DEVİR (dispozisyon: TRANSFER) — kapanan WO'da işlemi bitmemiş topları YENİ bir
   * (devam) iş emrine taşır. Şablon: workorder-split `undyedMove` (klon + repoint).
   * Toplar `IN_PRODUCTION` KALIR, barkod/kalite değişmez — üretim sürüyor.
   *
   * `reEntryStepSequence` = taşınan topların EN KÜÇÜK adım sırası; klon o adımdan
   * başlar ve sonrasını içerir, böylece her top `oldToNew` ile kendi adımına oturur.
   *
   * `supersedeEmptiedSourceWorkOrderTx` BİLİNÇLİ olarak çağrılmaz: kaynak WO bu
   * çağrıda COMPLETED'a claim edildi; SUPERSEDED'e çekmek claim'i bozar ve "malzemesi
   * devredildi" yanlış anlamını verir (burada malzemenin bir kısmı devrediliyor).
   *
   * Döner: yeni iş emri numarası + taşınan açık kurşun bypass ataması adedi.
   */
  private async transferRollsToNewWorkOrderTx(
    tx: Prisma.TransactionClient,
    params: {
      sourceWorkOrderId: string;
      rolls: Array<{
        id: string;
        currentStepId: string | null;
        currentQty: Prisma.Decimal | null;
        batchId: string | null;
      }>;
      stepSeqById: Map<string, number>;
      orderMode: "stock" | "keep";
      userId?: string;
    },
  ): Promise<{ workOrderNumber: string; bypassRepointed: number }> {
    return transferRollsToNewWorkOrderTxImpl(tx, params);
  }

  /**
   * Soft-delete: arşivler — `isActive=false` yapar.
   *
   * Geçmiş (RollOperation, RollMovement, TravelerCard + scan, Manifest, Swatch,
   * SubcontractorDispatch/Receipt, WorkOrderStep, WorkOrderToOrderLine)
   * silinmez — izlenebilirlik ve audit için saklanır. Listeler arşivli WO'yu
   * gizler; detay endpoint (findById) hala görüntüler.
   *
   * Roll kurtarma: bu WO'nun adımlarına bağlı (currentStepId) topları STOCK'a
   * geri çeker ki yeni üretimde tekrar kullanılabilsin. `producedInStepId`
   * lineage olarak korunur (FK hala valid — step silinmedi).
   */
  async hardDelete(id: string, userId?: string, opts: { releaseToken?: boolean } = {}): Promise<ApiResponse<WorkOrder>> {
    return hardDeleteImpl(id, userId, opts);
  }

  /**
   * Barkodla top bağlar — Parti Ekle boğazının (`addBatchToWorkOrderTx`) HOŞGÖRÜLÜ kipi:
   * uygun olmayan barkod ret listesine düşer, kalanlar YENİ parti olarak ilk adıma girer.
   * Yalnız quickStart (iş emrinin ilk partisi) ve bekçi fikstürleri çağırır; yeni parti ucu `addBatch`.
   */
  async attachRolls(
    workOrderId: string,
    rawBarcodes: string[],
    userId?: string,
    opts: { sourceNoteId?: string | null; sourceBatchNo?: string | null } = {},
  ): Promise<ApiResponse<{ attached: number; errors: string[]; batch: { id: string; batchNumber: string } | null }>> {
    return attachRollsImpl(workOrderId, rawBarcodes, userId, opts);
  }

  /**
   * İş emrinin temel alanlarını günceller. Planlamacının kontrolünde — üretim
   * sırasında değişikliklere izin verilir (örn. boyahane mavi yerine kırmızı
   * boyasın denildi → targetColorId değişir; henüz colorId almamış rulolar
   * Fason Kabul'de yeni rengi otomatik alır). Sadece COMPLETED/CANCELLED
   * iş emirlerinde değişiklik yapılamaz (geriye dönük tutarlılık).
   *
   * Steps/orderLinks/targetProperties gibi koleksiyonlar bu endpoint'in
   * scope'unda DEĞİL — onlar için `replace`/`updateStepPlanning`/
   * `updateTargetProperties` kullan.
   */
  async update(
    id: string,
    data: {
      batchNumber?: string;
      width?: number | null;
      targetQuantity?: number | null;
      targetWeight?: number | null;
      plannedStartDate?: string | null;
      plannedEndDate?: string | null;
      targetItemId?: string | null;
      targetColorId?: string | null;
      foldType?: string | null;
    },
    userId?: string,
    /** Renk değişikliğinde kısmi-boya onayı (409 `COLOR_PARTIAL_CONFIRM` sonrası tekrar). */
    opts: { confirmPartial?: boolean } = {},
  ): Promise<ApiResponse<unknown>> {
    return updateImpl(id, data, userId, opts);
  }

  /**
   * İş emrini tüm ilişkileri ile birlikte yeniden yazar. Planlamacının
   * kontrolünde — üretim sırasında değişikliklere izin verilir. Sadece
   * COMPLETED/CANCELLED iş emirlerinde yapılamaz.
   *
   * Smart merge stratejisi (rota için):
   * - `steps[i].id` mevcut step'i işaret ediyorsa → güncellenir (notes,
   *   stationId, sequence, requiredCategoryId, plannedSubcontractorId).
   * - `steps[i].id` boşsa → yeni step eklenir.
   * - Mevcut listede olup yeni listede olmayan step → status=PENDING ve
   *   hiçbir bağlı kayıt (rulo, movement, dispatch, vb.) yoksa silinir;
   *   aksi halde "tamamlanmış/aktif/bağlı adım silinemez" hatası.
   *
   * orderLinks ve targetProperties drop-and-recreate.
   */
  async replace(
    id: string,
    data: WorkOrderCreateInput,
    userId?: string,
  ): Promise<ApiResponse<WorkOrder>> {
    return replaceImpl(id, data, userId);
  }

  /**
   * WO targetProperties güncelle. Bağlı tüm Roll'ların properties'i
   * senkronize edilir. Fiziksel taahhüt kilitleri replace() ile AYNI:
   * istasyonu adımını tamamlamış (fiilen uygulanmış) özellik kaldırılamaz,
   * eklenen özelliği uygulayabilecek açık istasyon rotada olmalı.
   *
   * Frontend bu çağrıdan ÖNCE getRollImpact ile etkilenecek rulo sayısını
   * göstermeli ve onay almalıdır.
   */
  async updateTargetProperties(
    id: string,
    propertyIds: string[],
    userId?: string,
  ): Promise<ApiResponse<{ workOrderId: string; affectedRollCount: number }>> {
    return updateTargetPropertiesImpl(id, propertyIds, userId);
  }

  /**
   * Frontend "değişiklik X rulo etkileyecek, devam mı?" uyarısı için.
   * WO'ya bağlı + henüz Tambur'dan geçmemiş ve geçmiş rulo sayılarını döner.
   */
  async getTargetPropertyChangeImpact(
    id: string,
  ): Promise<ApiResponse<{ tamburPassedCount: number; inProductionCount: number }>> {
    return getTargetPropertyChangeImpactImpl(id);
  }

  /**
   * EXTERNAL adım planlaması — gerekli kategori ve planlanan firma seçimi.
   * Adım hangi durumda olursa olsun (PENDING/ACTIVE/COMPLETED/SKIPPED/CANCELLED)
   * planlamacı kategori veya firma değiştirebilir. Tek istisna: WO COMPLETED
   * veya CANCELLED ise hiçbir değişiklik yapılamaz.
   *
   * Subcontractor seçilirse kategoriye uygun olmalıdır.
   */
  async updateStepPlanning(
    workOrderId: string,
    stepId: string,
    data: {
      requiredCategoryId?: string | null;
      plannedSubcontractorId?: string | null;
      /** 2026-08-17 — adım fasona renksiz gitsin ("ekru" kuralı). */
      dispatchWithoutColor?: boolean;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    return updateStepPlanningImpl(workOrderId, stepId, data, userId);
  }

  /**
   * İş Emrini Kilitle (Üretime Al)
   * Sepetteki (PLANNED) siparişi onaylayıp IN_PROGRESS durumuna sokar, top eklemeye/çıkarmaya kapatır.
   */
  async lockWorkOrder(workOrderId: string, userId?: string): Promise<ApiResponse<WorkOrder>> {
    return lockWorkOrderImpl(workOrderId, userId);
  }

  /**
   * BİR İŞ EMRİNİN TÜM BELGELERİ — tek liste, tek sözleşme.
   *
   * Neden ayrı uç: belgeler dört ayrı kaynakta yaşıyor (TravelerCard + üç
   * PrintedDocument tipi) ve `findById` yalnız `steps[].dispatches`'i taşıyor.
   * Sonuç: fason **kabul makbuzu** ve **fasondan doğrudan sevk irsaliyesi** iki
   * istemcide de iş emrinden ULAŞILAMIYORDU — belge vardı, kapısı yoktu.
   * İstemciler artık bu listeyi basar; yeni bir belge tipi eklendiğinde tek yer
   * güncellenir (aksi halde her istemci kendi listesini kurar ve ayrışırlar).
   *
   * ⚠️ İPTAL EDİLMİŞ belgeler LİSTEDE KALIR (`cancelled: true`). Donmuş belge
   * silinmez, VOIDED'e çekilir ve baskıda İPTAL filigranı alır — dosyaya bakan
   * kişi onu yeniden basabilmeli. İstemci rozetle ayırır. (Electron'un eski
   * Belgeler diyaloğu iptalleri gizliyor; bu uca geçtiğinde davranış birleşir.)
   *
   * Sıralama: kart önce (iş emri belgesi), sonra fason belgeleri TARİH DESC —
   * sahada en çok aranan "en son basılan"dır.
   */
  async getDocuments(workOrderId: string): Promise<ApiResponse<unknown>> {
    return getDocumentsImpl(workOrderId);
  }

  /**
   * Sepetteki (Bağlanmış) Topları Getir
   */
  async getAttachedRolls(workOrderId: string): Promise<ApiResponse<unknown[]>> {
    return getAttachedRollsImpl(workOrderId);
  }

  /**
   * Generate Traveler Card (Refakat Kartı) data for a work order.
   * Contains work order info, route steps, and linked order info.
   */
  async getTravelCard(workOrderId: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    return getTravelCardImpl(workOrderId);
  }

  /**
   * Canlı önizleme — snapshot'a bakmaz, mevcut roll durumunu hesaplar.
   * `createManifest` (yeni belge basma) ve henüz Manifest kaydı bulunmayan
   * `getManifest` çağrıları bu yardımcıyı kullanır.
   */
  private async computeLiveManifest(
    workOrderId: string
  ): Promise<Record<string, unknown> | null> {
    return computeLiveManifestImpl(workOrderId);
  }

  /**
   * Generate Manifest / Çeki Listesi data.
   *
   * Davranış:
   *   - Eğer bu WO için daha önce Manifest basılmışsa, SON snapshot döner
   *     (dondurulmuş belge — Tambur'da kesilen çocuk toplar vs. artık listeyi
   *     değiştiremez). Frontend `isSnapshot: true` ile bunu ayırt edebilir.
   *   - Snapshot yoksa canlı önizleme döner; ama sadece orijinal (split olmayan)
   *     toplar listeye girer — SCRAP/A1_STOCK çocukları hariç.
   *   - Listeyi değiştirmek isteyen operatör yeni bir `createManifest` çağrısı
   *     yapmalı (reprint = yeni belge).
   */
  async getManifest(workOrderId: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    return getManifestImpl.call(this as unknown as WorkOrderServiceThis, workOrderId);
  }

  /**
   * 3.5 — Çeki Listesi kalıcı belge (Manifest) oluştur.
   * Mevcut WO'nun anlık durumunu snapshot'layıp Manifest tablosuna yazar.
   * Aynı WO için birden fazla manifest basılabilir (reprint mantığı — eski belgeler korunur).
   */
  async createManifest(
    workOrderId: string,
    userId?: string,
    notes?: string
  ): Promise<ApiResponse<Record<string, unknown> | null>> {
    return createManifestImpl.call(this as unknown as WorkOrderServiceThis, workOrderId, userId, notes);
  }

  /**
   * 3.5 — İş emrinin geçmiş tüm manifest belgeleri.
   */
  async listManifests(workOrderId: string): Promise<ApiResponse<unknown>> {
    return listManifestsImpl(workOrderId);
  }

  /**
   * Tek bir manifest'i ID ile getir — kayıtlı snapshot'ı döner (yeniden hesaplama yok).
   * Liste endpoint'i snapshot'ı çekmiyor (over-fetch); print/detail için bu kullanılır.
   */
  async getManifestById(manifestId: string): Promise<ApiResponse<unknown>> {
    return getManifestByIdImpl(manifestId);
  }
}
