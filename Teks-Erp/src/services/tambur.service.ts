// =============================================================================
// TeksERP - Tambur Service
// =============================================================================
// Handles final quality decisions and roll splitting.
//
// CRITICAL BUSINESS RULES:
//   - Kurşun'da tespit edilen hatalar Tambur'da karar verme noktasına gelir.
//   - "KES" kararı verildiğinde mevcut topun metrajı azaltılmaz!
//     Yeni bir Roll kaydı (yeni barkod) oluşturulur → SCRAP veya A1.
//   - Orijinal topun currentQty'si net değere güncellenir → status WAREHOUSE,
//     currentStepId=null. Depo bir istasyon değil, saf bir statü; paketleme
//     RollMovement'i Tambur'da AÇILMAZ, tartı/paket finalize anında atomic
//     açılır + kapanır.
//   - Tambur'dan sonraki akış: Depo (WAREHOUSE) → Tartı/Paket → Sevkiyat.
// Bölme (2026-11-08, davranış aynı): bu dosya CEPHEDİR — sınıf, dışa açık adlar ve
// metot imzaları burada; gövdeler `services/tambur/` altındaki alan modüllerinde
// kelimesi kelimesine durur (cephe metodu modül fonksiyonunu `this` bağlamıyla çağırır).
// Çağıranlar yalnız bu yoldan import eder; alan modülleri cepheyi yalnız TİP olarak okur.
// =============================================================================

import { type ScanRoutedOpenCard } from "./helpers/scan-route-open-cards.helper";
import { ApiResponse } from "../types/api.types";
import {
  type RemainingAction,
} from "./helpers/quality-role.helper";
import {
  type MeterSourceInput,
} from "./helpers/meter-reading.helper";
import type { CursorPaginatedResponse } from "./base.service";
import {
  SwatchStatus,
  Roll,
  RollError,
  Swatch,
} from "@prisma/client";
// ⚠️ TEK YÖNLÜ BAĞIMLILIK: tambur.service → kursun-bypass.service.
// `kursun-bypass.service` bu dosyayı (ya da onu import eden bir modülü) ASLA
// import etmez — ortak guard'lar `helpers/kursun-bypass-guard.helper.ts`'te
// yaşar. Bu kural bozulursa statik import döngüsü doğar (lazy import gerekir).
import {
  KursunBypassService,
  type KursunBypassTamburContext,
} from "./kursun-bypass.service";
import { getPendingRolls as getPendingRollsImpl, getRollForDecision as getRollForDecisionImpl, buildBranchInfoMap as buildBranchInfoMapImpl, loadTamburRolls as loadTamburRollsImpl, enrichTamburScanError as enrichTamburScanErrorImpl, assertAtTamburWithReason as assertAtTamburWithReasonImpl, getByCardBarcode as getByCardBarcodeImpl, getStep as getStepImpl } from "./tambur/read";
import { finalize as finalizeImpl } from "./tambur/finalize";
import { listRecentOutputRolls as listRecentOutputRollsImpl } from "./tambur/output-rolls";
import { getSwatchByBarcode as getSwatchByBarcodeImpl, listSwatches as listSwatchesImpl, getSwatchStats as getSwatchStatsImpl } from "./tambur/swatch";
import { reportError as reportErrorImpl } from "./tambur/report-error";
import { listOpenCards as listOpenCardsImpl } from "./tambur/open-cards";
import { cutWarehouseRoll as cutWarehouseRollImpl, cutWarehouseRollInner as cutWarehouseRollInnerImpl } from "./tambur/warehouse-cut";
import { finalizeWarehouseCut as finalizeWarehouseCutImpl } from "./tambur/warehouse-cut-finalize";
import { cutOpenFabric as cutOpenFabricImpl, cutOpenFabricInner as cutOpenFabricInnerImpl } from "./tambur/open-fabric-cut";
import { finalizeOpenFabric as finalizeOpenFabricImpl } from "./tambur/open-fabric-finalize";
import { getTamburContext as getTamburContextImpl } from "./tambur/context";
import type { TamburRollSummary, TamburStepSummary } from "./tambur/read";
import type { CutInput, ErrorDecision } from "./tambur/finalize";
import type { SwatchStats } from "./tambur/swatch";
import type { TamburOpenCard } from "./tambur/open-cards";
import type { TamburRollErrorSummary, TamburServiceThis } from "./tambur/shared";

export type { SwatchStats } from "./tambur/swatch";
export { applyTamburCapabilitiesTx } from "./tambur/shared";


export class TamburService {
  /** Kurşun Dağıtım (bypass) okuma yolu — yalnız `getTamburContext` kullanır. */
  private readonly bypassService = new KursunBypassService();

  /**
   * Get rolls pending at Tambur station.
   *
   * Filtre kuralı: `currentStep.station.kind === TAMBUR` zorunlu. Bu sayede
   * önceki istasyonlarda (Boyahane, KK2) takılı olan ve sadece hatası olan
   * roll'lar yanlışlıkla listede çıkmıyor (BUG-36 fix).
   *
   * Hatası olsun olmasın **tüm** tambur-step roll'ları döner — operatör
   * hatasız roll'ları da sarıp `finalize` çağırmak zorunda (cumulative
   * length model ile child Roll'ları yaratır). UI hatalı/hatasız ayrımı
   * için `errors.length` üzerinden filtreleme yapabilir.
   */
  async getPendingRolls(stationId: string | null = null): Promise<ApiResponse<Roll[]>> {
    return getPendingRollsImpl(stationId);
  }

  /**
   * Get a single roll with its unprocessed errors for Tambur decision screen.
   */
  async getRollForDecision(rollId: string): Promise<ApiResponse<Roll | null>> {
    return getRollForDecisionImpl(rollId);
  }

  /**
   * batchId (parti) → { batchNumber, dispatchNo, ordinal } haritası.
   *   - batchNumber : Batch.batchNumber (P+GGAAYY+NNNN).
   *   - dispatchNo  : partinin İPTAL EDİLMEMİŞ en güncel fason sevki
   *                   (dispatchedAt desc) — hiç sevk görmemiş partide null.
   *   - ordinal     : WO'nun TÜM partileri içinde createdAt sırasına göre
   *                   1-based parti sırası — bir parti Tambur'dan çıksa bile
   *                   numarası kaymaz. Tambur listesinde partileri ayırt
   *                   etmek için kullanılır.
   */
  private async buildBranchInfoMap(
    workOrderId: string,
    batchIds: (string | null)[],
  ): Promise<
    Map<string, { batchNumber: string; dispatchNo: string | null; ordinal: number }>
  > {
    return buildBranchInfoMapImpl(workOrderId, batchIds);
  }

  /**
   * Tambur adımında bekleyen açık RollMovement'leri TamburRollSummary[]'e çevirir
   * — parti bilgisiyle (batchId/batchNumber/dispatchNo/branchOrdinal) zenginleştirilmiş.
   * getByCardBarcode + getStep ortak kullanır (önceki kopyala-yapıştır birleşti).
   */
  private async loadTamburRolls(step: {
    id: string;
    workOrderId: string;
  }): Promise<TamburRollSummary[]> {
    return loadTamburRollsImpl.call(this as unknown as TamburServiceThis, step);
  }

  /**
   * `assertWoAtStepKind(TAMBUR)` + mal kurşunda bekliyorsa SOMUT SEBEP.
   *
   * Ham 400 *"Tabletinizi yanlış istasyonda okutmuş olabilirsiniz"* diyor; mal
   * kurşun adımında beklerken operatör TAM DOĞRU istasyonda duruyor ve bu cümle
   * onu yanlış yere bakmaya gönderiyor (saha bulgusu 2026-08-06). Sebep kuralı
   * `kursun-bypass.service`'te yaşar — burada yalnız mesaja iliştirilir.
   *
   * Zenginleştirme SESSİZ başarısız olur: sebep sorgusu düşerse operatör en
   * azından eski (doğru ama eksik) mesajı görür — baskın hatayı maskelemeyiz.
   */
  private async enrichTamburScanError(
    err: unknown,
    workOrderId: string,
  ): Promise<unknown> {
    return enrichTamburScanErrorImpl.call(this as unknown as TamburServiceThis, err, workOrderId);
  }

  private async assertAtTamburWithReason(
    workOrderId: string,
  ): Promise<{ stepId: string; openRollCount: number }> {
    return assertAtTamburWithReasonImpl.call(this as unknown as TamburServiceThis, workOrderId);
  }

  /**
   * Refakat kartı barkoduyla TAMBUR adımını çöz ve o adımda şu an bekleyen
   * rolleri (stok kodu, lot/varyant kodu, en, hata özeti ile birlikte) döndür.
   *
   * Operatör tambur tabletine kartı okutur, bu metot hangi iş emrinin Tambur
   * adımında olduğumuzu ve işlenecek kumaşların listesini verir.
   */
  async getByCardBarcode(
    cardBarcode: string,
    /** K29: oturum istasyonu — yalnız okutmaya göre rota kapısı okur; null = bugünkü çözüm. */
    sessionStationId: string | null = null,
  ): Promise<ApiResponse<TamburStepSummary>> {
    return getByCardBarcodeImpl.call(this as unknown as TamburServiceThis, cardBarcode, sessionStationId);
  }

  /**
   * Finalize a roll at Tambur station.
   *
   * YENİ MODEL (cumulative length-based):
   *   - Tambur operatörü makinede kumaşı sarar; sayaç sıfırdan başlar.
   *   - Her "kes" tuşu basışında: o ana kadar sarılan uzunluk yeni bir top
   *     olur (parent'ın 0 metresinden itibaren), sayaç sıfırlanır, devam edilir.
   *   - API'de `cuts: [{ length, qualityGrade, relatedErrorIds }]` sıralı liste.
   *     Backend cumulative offset hesaplar:
   *        cut1: 0     ..  cut1.length
   *        cut2: cut1.length .. cut1.length+cut2.length
   *        ...
   *     Son cut'tan sonra kalan kısım otomatik son child top
   *     (parent.qualityGrade ile, sum(lengths) < totalQty ise).
   *   - sum(lengths) > totalQty → hata. sum(lengths) ≤ totalQty zorunlu.
   *   - cuts boş ise → tüm metraj tek child top (parent.qualityGrade).
   *
   *   Defect lifecycle:
   *   - `decisions[]` her defect için karar (CUT veya NO_CUT). CUT kararı bir
   *     `cuts[].relatedErrorIds`'da görünen defect'i ifade eder. NO_CUT defect
   *     işlenmiş ama kesilmemiş — top içinde kayıtlı kalır.
   *   - `RollError.isProcessed=true`, `actionTaken="CUT"` veya `"NO_CUT"`.
   *
   *   Parent retire: `status=TAMBUR_CONSUMED`, `currentQty=0`, `currentStepId=null`.
   *   Çocuk topların KURSUN_APPLIED ve QC2_COMPLETED RollOperation kayıtları
   *   parent'tan kopyalanır (`inheritedFromParentRollId`).
   */
  async finalize(
    data: {
      rollId: string;
      decisions: ErrorDecision[];
      cuts: CutInput[];
      /** Operatörün seçtiği kat. 2026-08-10'dan beri KATALOĞA bağlı (2-KAT /
       *  4-KAT / TÜP / fabrikanın eklediği 6-KAT…) → literal union DEĞİL.
       *  Geçerlilik `resolveFoldTypeForWrite` ile ölçülür. */
      foldType?: string | null;
      /** Çıktı topları (depoya gidenler) kartelalık işaretlensin — depoda
       *  kartela sevki için kolay bulunsun. Sevki engellemez. */
      markedForKartela?: boolean;
      /** Plan-gerçek sapma onayı (renk/en) — 409 PLAN_MISMATCH'i geçer.
       *  Sapma yokken gönderilmesi zararsız (kapı hiç açılmaz). */
      confirmMismatch?: boolean;
      /** S5: otomatik kalan kuyruk parçasının kg'ı (tartım kapısı). */
      remainingWeightKg?: number | null;
      /** Müşterinin etikete istediği parti metni — bu finalize'da doğan HER parçaya yazılır. */
      labelBatchNo?: string | null;
      labelItemName?: string | null;
      labelColorName?: string | null;
      /** Emanet top etiket alıcısı (sahibin alıcısı; boş = sahibin kendisi). */
      labelConsigneeId?: string | null;
      /** Etikette kartında ölçülen en (cm) — mirası ezer (K7). */
      widthCm?: number | null;
      /** Kalan kuyruk parçasının kg kaynağı. */
      remainingWeightSource?: "SCALE" | "MANUAL" | "SIMULATED" | null;
    },
    userId?: string,
    /** TAMBUR makine atfı — aktif çalışma oturumundan (controller çözer).
     *  TAMBUR_PROCESSED op'una + kapanan movement'a damgalanır. */
    machineId?: string | null
  ): Promise<
    ApiResponse<{
      originalRoll: Roll;
      splitRolls: Roll[];
      processedErrors: number;
      /** D4-F2: yalnız kod doğduysa (label.customerCodeAt=TAMBUR_OUTPUT + müşteri serisi). */
      customerCodes?: Array<{ rollId: string; code: string }>;
    }>
  > {
    return finalizeImpl(data, userId, machineId);
  }

  // ===========================================================================
  // SWATCH — Kartela üretimi
  // ===========================================================================
  /**
   * Kaynak rolden uzunluk*adet kadar metraj düşerek `count` adet kartela üretir.
   * Her kartela kendi barkodunu (KRT+GGAAYY+NNNN) ve kart numarasını alır.
   */
  // NOT: Kartela artık Tambur'da kesilmez. Kartela = bitmiş bir topun kartela
  // fason firmasında işlenmesiyle doğar (KartelaService.receive). Bkz.
  // docs/design/KARTELA-TASARIM.md. Eski createSwatch / nextSwatchSequence kaldırıldı.

  /**
   * Tambur'dan çıkmış son N rolü listeler — operatör etiketleri tekrar basabilsin
   * diye. Sadece split çocukları (`entrySource: TAMBUR_SPLIT`); retired parent
   * (`TAMBUR_CONSUMED`, currentQty=0) etiket basılacak fiziksel bir top değil.
   * Default 50 kayıt, createdAt DESC.
   */
  async listRecentOutputRolls(params?: {
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
    return listRecentOutputRollsImpl(params);
  }

  /**
   * Barkoddan kartela bul — TartıPaket akışında scan input'u kartela barkodunu
   * (SW- prefix) tespit ettiğinde kullanılır.
   */
  async getSwatchByBarcode(
    barcode: string
  ): Promise<ApiResponse<Swatch | null>> {
    return getSwatchByBarcodeImpl(barcode);
  }

  async listSwatches(params?: {
    workOrderId?: string;
    itemId?: string;
    limit?: number;
    /** Cursor mode aktivasyonu — verilirse pagination cursor response döner. */
    cursor?: string;
    /** `cursor=...` parametresi yokken bile cursor formatı istemek için. */
    mode?: string;
    /** Barkod / kart no / ürün adı/kodu / parti araması (cursor mode'da geçerli). */
    search?: string;
    /** Cursor mode ilk fetch'te totalEstimate doldur. */
    withTotal?: boolean;
    /** Durum süzgeci — verilmezse iptal/düşüm dışındakiler (eski varsayılan). */
    statuses?: SwatchStatus[];
  }): Promise<ApiResponse<Swatch[]> | CursorPaginatedResponse<Swatch>> {
    return listSwatchesImpl(params);
  }

  /**
   * Kartela özet istatistikleri — listenin sayfaya bağlı toplamlarını değil,
   * filtreye uyan TÜM kartelaların aggregate'ini döner. Depo panelinin
   * "Toplam Kartela / Toplam Uzunluk" bölmesi için.
   */
  async getSwatchStats(params?: {
    itemId?: string;
    search?: string;
  }): Promise<ApiResponse<SwatchStats>> {
    return getSwatchStatsImpl(params);
  }

  /**
   * Step ID ile direkt çek — mobil aksiyon sonrası refresh için.
   * `getByCardBarcode`'un step çözüm kısmını atlar; barkod kullanımını saklar.
   */
  async getStep(stepId: string): Promise<ApiResponse<TamburStepSummary>> {
    return getStepImpl.call(this as unknown as TamburServiceThis, stepId);
  }

  /**
   * Tambur'da yeni hata tespiti — Kurşun'da yakalanmamış ama Tambur'da
   * görülen hatalar bu metotla eklenir. Kayıt RollError olarak açılır,
   * `isProcessed=false` olur; aynı `finalize` akışıyla karara bağlanır
   * (Kurşun'dan gelenlerle birlikte aynı liste).
   */
  async reportError(
    data: {
      rollId: string;
      stepId: string;
      startMeter: number;
      defectTypeId: string;
    },
    userId?: string
  ): Promise<ApiResponse<RollError>> {
    return reportErrorImpl(data, userId);
  }

  /**
   * Tambur adımlarında açık top bekleyen aktif refakat kartları.
   * Mobil "kamera simülasyonu" modal'ı için.
   */
  // Rotasız satır istenmeyen çağıranlar dar tipi görür (stepId string).
  listOpenCards(stationId?: string | null, q?: string | null, scan?: null): Promise<ApiResponse<TamburOpenCard[]>>;
  listOpenCards(stationId: string | null, q: string | null, scan: { sessionStationId: string | null } | null): Promise<ApiResponse<Array<TamburOpenCard | ScanRoutedOpenCard>>>;
  async listOpenCards(stationId: string | null = null, q: string | null = null, scan: { sessionStationId: string | null } | null = null): Promise<ApiResponse<Array<TamburOpenCard | ScanRoutedOpenCard>>> {
    return listOpenCardsImpl(stationId, q, scan);
  }


  // ===========================================================================
  // WAREHOUSE ROLL CUT — Top Kesme akışı
  // ===========================================================================
  // Senaryo: depodaki barkodlu bir topun Tambur operatörü tarafından birden çok
  // parçaya kesilmesi (cutOpenFabric pattern'inin WAREHOUSE topu varyantı).
  //
  //  - Her cutWarehouseRoll çağrısı: child Roll doğar (parent özellikleri inherit),
  //    parent.currentQty düşer. Multi-cut: operatör istediği kadar çağırır.
  //  - finalizeWarehouseCut: parent TAMBUR_CONSUMED'a çekilir (arşive),
  //    kalan kumaş için karar (1.KALITE/A1/FIRE/discard).
  //
  // Farklar (vs cutOpenFabric):
  //  - Parent WAREHOUSE'da (currentStepId null), step/movement işlemi yok
  //  - producedInStepId parent'tan değil null olarak yazılır (depo topu, Tambur
  //    step'inin parçası değil)
  // ===========================================================================

  /**
   * Depo topu kesimi (R): token her kuraldan önce okunur ve kesim hangi hatayla düşerse düşsün
   * (tx öncesi aşım/tüketilmiş kuralı, token P2002) yeniden okunur — cevap token'dan gelir.
   */
  async cutWarehouseRoll(
    ...args: Parameters<TamburService["cutWarehouseRollInner"]>
  ): ReturnType<TamburService["cutWarehouseRollInner"]> {
    return cutWarehouseRollImpl.call(this as unknown as TamburServiceThis, ...args);
  }

  /** Açık kumaş kesimi (R) — `cutWarehouseRoll` ile aynı boğaz. */
  async cutOpenFabric(
    ...args: Parameters<TamburService["cutOpenFabricInner"]>
  ): ReturnType<TamburService["cutOpenFabricInner"]> {
    return cutOpenFabricImpl.call(this as unknown as TamburServiceThis, ...args);
  }

  private async cutWarehouseRollInner(
    rollId: string,
    data: {
      cutLength: number;
      qualityGrade?: string | null;
      notes?: string | null;
      /** Çıktı top kartelalık işaretlensin (depoda kartela sevki için). */
      markedForKartela?: boolean;
      /**
       * Ham (renksiz STOCK) top kesiminde çıkan parçanın hedefi:
       *   STOCK     → üretime geri döner (yeni iş emrine bağlanabilir: boyahane/KK2/tambur),
       *   WAREHOUSE → ham-bitmiş, sevke hazır (renksiz olarak depoya iner).
       * Bitmiş depo topu (WAREHOUSE parent) kesiminde YOK SAYILIR — çıktı her zaman WAREHOUSE.
       */
      rawDestination?: "STOCK" | "WAREHOUSE";
      /** Parçanın katı — verilmezse parent'tan devralınır (bu yolda WO yok). */
      foldType?: string | null;
      /** Etiket niyeti — WAREHOUSE child'ın `lastLabelSnapshot`'ına yazılır;
       *  raw→STOCK (üretime devam) child stok'a düşer. İkisi de boş = stok. */
      targetOrderLineId?: string | null;
      targetCustomerId?: string | null;
      /** Offline/ağ-retry idempotency anahtarı (UUID). Barkod sunucuda sıralı atanır;
       *  aynı token'la 2. çağrı child'ı idempotent döner (ikinci kesim/decrement YOK). */
      clientToken?: string;
      /** D4-B1: kesim metresinin ölçüm kaynağı (eski APK göndermez). */
      measure?: MeterSourceInput | null;
      /** Tamburda tartım (Gülkesim S5) — müşteri ayarı açıksa zorunlu; çocuk `weightKg`. */
      weightKg?: number | null;
      /** Müşterinin etikete istediği parti metni — çocuğa yazılır (miras yok). */
      labelBatchNo?: string | null;
      labelItemName?: string | null;
      labelColorName?: string | null;
      /** Emanet top etiket alıcısı (sahibin alıcısı; boş = sahibin kendisi). */
      labelConsigneeId?: string | null;
      /** Etikette kartında ölçülen en (cm) — mirası ezer (K7). */
      widthCm?: number | null;
      /** Kg kaynağı beyanı (SCALE | MANUAL | SIMULATED); kaynaksız kg MANUAL yazılır. */
      weightSource?: "SCALE" | "MANUAL" | "SIMULATED" | null;
    },
    userId?: string,
    /**
     * Aktif çalışma oturumunun istasyonu — çıkan parçanın GİRİŞ İSTASYONU damgası.
     *
     * Bu yolda İŞ EMRİ/ADIM YOKTUR (depo topu kesimi), dolayısıyla adım kaynağı
     * kullanılamaz ve tek doğru kaynak oturumdur. Verilmezse damga NULL kalır —
     * eski istemciler ve dahili çağrılar kırılmaz.
     */
    sessionStationId?: string | null,
    /** Kesimin yapıldığı makine — "Bu makine" süzgeci + makine raporları için.
     *  (2026-08-12: kesim çocukları createdById alıyordu ama createdMachineId
     *  ALMIYORDU → makine süzgeci kesimleri hiç göremiyordu.) */
    sessionMachineId?: string | null,
  ): Promise<ApiResponse<{ childRoll: Roll; parentRoll: Roll; parentRemainingQty: number }>> {
    return cutWarehouseRollInnerImpl(rollId, data, userId, sessionStationId, sessionMachineId);
  }

  /**
   * Top Kesme akışını bitir — parent topu TAMBUR_CONSUMED'a (arşive) çek, kalan
   * kumaş için karar uygula (1.KALITE/A1/FIRE/discard).
   *
   * `remainingAction`:
   *  - "keep_1kalite" → kalan için 1.KALITE child Roll oluştur (WAREHOUSE)
   *  - "keep_a1"      → A1 child Roll
   *  - "scrap"        → FIRE child Roll (stokta kalır)
   *  - "discard"      → kalan tamamen kayıp
   *  - remainingQty=0 → no-op
   */
  async finalizeWarehouseCut(
    rollId: string,
    data: {
      remainingAction?: RemainingAction;
      /// KALAN için AÇIK katalog seçimi (yeni tablet). Verilirse `remainingAction`
      /// rol eşlemesini EZER; verilmezse eski sözleşme aynen çalışır.
      remainingGradeId?: string | null;
      notes?: string | null;
      /// SAPMA SEBEBİ (2026-08-09) — `finalizeOpenFabric` ile aynı sözleşme.
      varianceReasonCode?: string | null;
      varianceReasonText?: string | null;
      /** S5: kalan topun kg'ı (tartım kapısı). */
      weightKg?: number | null;
      /** Kalan topun etiket parti no'su (müşteri ayarı açıksa). */
      labelBatchNo?: string | null;
      labelItemName?: string | null;
      labelColorName?: string | null;
      /** Emanet top etiket alıcısı (sahibin alıcısı; boş = sahibin kendisi). */
      labelConsigneeId?: string | null;
      /** Etikette kartında ölçülen en (cm) — mirası ezer (K7). */
      widthCm?: number | null;
      /** Kg kaynağı beyanı (SCALE | MANUAL | SIMULATED); kaynaksız kg MANUAL yazılır. */
      weightSource?: "SCALE" | "MANUAL" | "SIMULATED" | null;
    },
    userId?: string,
    /** Oturum istasyonu — KALAN parçanın giriş istasyonu damgası (cutWarehouseRoll ikizi). */
    sessionStationId?: string | null,
    /** Kesimin makinesi — kesilen parçayla AYNI damga (cutWarehouseRoll ikizi). */
    sessionMachineId?: string | null,
  ): Promise<ApiResponse<{ rollId: string; remainingChild: Roll | null; remainingQty: number }>> {
    return finalizeWarehouseCutImpl(rollId, data, userId, sessionStationId, sessionMachineId);
  }

  // ===========================================================================
  // OPEN FABRIC TAMBUR — yeni model: tek-kesim + finalize + context
  // ===========================================================================
  //
  // Senaryo: Boyahane'den dönen açık kumaş Roll'lar Kurşun/KK2'de işlendi
  // (kursun-finish), Tambur step'ine ilerletildi. Tambur operatörü sırasıyla
  // (LIFO — araba en üstten alta) kumaşları işler.
  //
  // Operatör 100. metreye gelince "kes" basar → cutOpenFabric çağrılır →
  // yeni child Roll (gerçek top, barkodlu) oluşur. Açık kumaş'ın currentQty
  // kalan metreye düşer. Operatör tekrar 100. metreye gelince yine kes basar.
  //
  // Açık kumaş bittiğinde operatör finalize çağırır → parent CONSUMED_AT_TAMBUR.

  /**
   * Tek kesim — açık kumaştan child Roll oluştur.
   * Tüm yeni rulolar WAREHOUSE statüsünde doğar; kalite ayrımı `qualityGrade`
   * alanında. Geri uyum: tablet eski `status` enum'unu (A1_STOCK/SCRAP)
   * göndermeye devam edebilir; karşılık gelen qualityGrade'e otomatik dönüşür.
   */
  private async cutOpenFabricInner(
    openFabricRollId: string,
    data: {
      lengthMeters: number;
      status: "WAREHOUSE" | "SCRAP" | "A1_STOCK";
      qualityGrade?: string | null;
      notes?: string | null;
      /** Çıktı top kartelalık işaretlensin (depoda kartela sevki için). */
      markedForKartela?: boolean;
      /** Etiket niyeti — açık kumaş child her zaman WAREHOUSE → lastLabelSnapshot.
       *  İkisi de boş = stok (müşterisiz). */
      targetOrderLineId?: string | null;
      targetCustomerId?: string | null;
      /**
       * Bu kesimde doğan ÇOCUĞUN katı (kalıcı özellik, 2026-08-04).
       * Verilmezse parent → iş emri planı sırasıyla fallback uygulanır — bu
       * MİRAS değil, alanı göndermeyen eski istemciler için geri-uyumluluktur.
       */
      foldType?: string | null;
      /** Offline/ağ-retry idempotency anahtarı (UUID) — cutWarehouseRoll ile aynı. */
      clientToken?: string;
      /** Plan-gerçek sapma onayı (renk/en) — 409 PLAN_MISMATCH'i geçer. */
      confirmMismatch?: boolean;
      /** D4-B1: kesim metresinin ölçüm kaynağı (eski APK göndermez). */
      measure?: MeterSourceInput | null;
      /** Tamburda tartım (Gülkesim S5) — müşteri ayarı açıksa zorunlu; çocuk `weightKg`. */
      weightKg?: number | null;
      /** Müşterinin etikete istediği parti metni — çocuğa yazılır (miras yok). */
      labelBatchNo?: string | null;
      labelItemName?: string | null;
      labelColorName?: string | null;
      /** Emanet top etiket alıcısı (sahibin alıcısı; boş = sahibin kendisi). */
      labelConsigneeId?: string | null;
      /** Etikette kartında ölçülen en (cm) — mirası ezer (K7). */
      widthCm?: number | null;
      /** Kg kaynağı beyanı (SCALE | MANUAL | SIMULATED); kaynaksız kg MANUAL yazılır. */
      weightSource?: "SCALE" | "MANUAL" | "SIMULATED" | null;
    },
    userId?: string,
    /** Kesimin makinesi — "Bu makine" süzgeci + makine raporları (2026-08-12). */
    sessionMachineId?: string | null,
  ): Promise<ApiResponse<{ childRoll: Roll; parentRemainingQty: number }>> {
    return cutOpenFabricInnerImpl(openFabricRollId, data, userId, sessionMachineId);
  }

  /**
   * Açık kumaşı bitir — parent CONSUMED_AT_TAMBUR'a çek, Tambur movement'ı kapat.
   *
   * `remainingAction` operatörün kalan metre (currentQty) için kararı:
   *   - "keep_1kalite" → 1.KALITE barkodlu top oluştur (status=WAREHOUSE)
   *   - "keep_a1"      → A1 barkodlu top oluştur (status=WAREHOUSE)
   *   - "scrap"        → FIRE barkodlu top oluştur (status=WAREHOUSE, fiziksel olarak fire ama stokta kalır)
   *   - "discard"      → kalan metre tamamen kayıp (eski scrapRemaining=false davranışı)
   *
   * Geri uyum: `remainingAction` verilmezse, eski `scrapRemaining` boolean'ından
   * türetir (true→"scrap", false/undefined→"discard"). Mobile yeni param'a geçince
   * scrapRemaining deprecate edilir.
   *
   * remainingQty=0 ise hiçbir child oluşmaz (action verilse bile no-op).
   */
  async finalizeOpenFabric(
    openFabricRollId: string,
    data: {
      remainingAction?: RemainingAction;
      /// KALAN için AÇIK katalog seçimi (yeni tablet). Verilirse `remainingAction`
      /// rol eşlemesini EZER; verilmezse eski sözleşme aynen çalışır.
      remainingGradeId?: string | null;
      scrapRemaining?: boolean;
      notes?: string | null;
      /// Tambur kararı — WO.foldType (planlama) override. Verilmezse planlanan
      /// kullanılır (WO.foldType). Bu değer audit/RollOperation metadata'ya yazılır.
      foldType?: string | null;
      /// SAPMA SEBEBİ (2026-08-09) — yalnız `scrap` / `discard` aksiyonlarında
      /// anlamlı. Gönderilmezse satır `BELIRTILMEDI` ile yazılır (eski istemci);
      /// bkz. `constants/variance-reasons.LEGACY_REASON_CODE`.
      varianceReasonCode?: string | null;
      varianceReasonText?: string | null;
      /** Plan-gerçek sapma onayı (renk/en) — 409 PLAN_MISMATCH'i geçer. */
      confirmMismatch?: boolean;
      /** S5: kalan topun kg'ı (tartım kapısı). */
      weightKg?: number | null;
      /** Kalan topun etiket parti no'su (müşteri ayarı açıksa). */
      labelBatchNo?: string | null;
      labelItemName?: string | null;
      labelColorName?: string | null;
      /** Emanet top etiket alıcısı (sahibin alıcısı; boş = sahibin kendisi). */
      labelConsigneeId?: string | null;
      /** Etikette kartında ölçülen en (cm) — mirası ezer (K7). */
      widthCm?: number | null;
      /** Kg kaynağı beyanı (SCALE | MANUAL | SIMULATED); kaynaksız kg MANUAL yazılır. */
      weightSource?: "SCALE" | "MANUAL" | "SIMULATED" | null;
    },
    userId?: string,
    /** TAMBUR makine atfı — aktif çalışma oturumundan (controller çözer). */
    machineId?: string | null,
  ): Promise<ApiResponse<{ rollId: string; remainingChildId: string | null; remainingQty: number }>> {
    return finalizeOpenFabricImpl(openFabricRollId, data, userId, machineId);
  }

  /**
   * Tambur ekran context — refakat kartı barkoduyla:
   *   - WO bilgisi
   *   - WO'ya bağlı orderlar + her order için shippedQty / orderedQty progress
   *   - Tambur step'indeki açık kumaş Roll'ları LIFO sıralı + RollError'lar
   *   - KURŞUN BYPASS: iş emri Kurşun Dağıtım'a verilmişse `bypassPending`
   *     (önizleme + onay verisi) — bkz. aşağıdaki blok.
   */
  async getTamburContext(
    cardBarcode: string,
    /**
     * `allowEmptyStep`: Tambur adımında açık top olmasa da kartı AÇ (boş bağlam).
     * Yalnız saha düzeltmesi yetkisi olan operatör için controller true geçer —
     * "Topu Buraya Al / Manuel Top Ekle" gerektiği anda ulaşılabilir olsun diye.
     * Yetkisiz operatörde false → davranış eskisi gibi (hata).
     */
    opts?: { allowEmptyStep?: boolean },
  ): Promise<
    ApiResponse<{
      workOrderId: string;
      batchNumber: string | null;
      stepId: string;
      stationName: string;
      /// Tambur planlama bilgisi — operatöre ekranda gösterilir, override edilebilir.
      plannedFoldType: string | null;
      /// Tambur adımına yazılan not (WorkOrderStep.notes) — operatöre gösterilir.
      stepNote: string | null;
      orders: Array<{
        orderId: string;
        orderNumber: string;
        customerId: string;
        customerName: string;
        lines: Array<{
          lineId: string;
          itemId: string;
          itemCode: string;
          itemName: string;
          colorCode: string | null;
          colorName: string | null;
          orderedQty: number;
          /// Sipariş satırı kesim notu + eşit-parça önerisi (Tambur talimatı).
          cutNote: string | null;
          pieceLengthM: number | null;
        }>;
      }>;
      openFabricRolls: Array<{
        rollId: string;
        /** Barkodlu top adıma alınmışsa dolu (2026-07-27); açık kumaşta null. */
        barcode: string | null;
        currentQty: number;
        initialQty: number;
        receiptNo: string | null;
        colorCode: string | null;
        colorName: string | null;
        kursunFinishedAt: string | null;
        errors: TamburRollErrorSummary[];
      }>;
      /**
       * Bu iş emrinde bekleyen KURŞUN DAĞITIM (bypass) işi. Non-null ise Tambur
       * ekranı "Kurşun adımını tamamla" önizlemesi + onayı gösterir ve
       * `POST /api/tambur/bypass-complete` ile kapatır. null = normal akış.
       *
       * Payload `kursun-bypass.service.findPendingForTambur`'un dönüşüdür ve
       * OLDUĞU GİBİ iletilir (burada yeniden şekillendirme YOK — alan eklemek
       * gerekirse tek kaynak orasıdır). Operatöre gösterilecek yer bilgisi
       * `machineName`'dir (atanan fiziksel kurşun makinesi); `stationName` tek
       * PROCESS_QC istasyonunun adıdır ve bağlam olarak taşınır — ekranda
       * "hangi makinede yapıldı" sorusunu YANITLAMAZ.
       */
      bypassPending?: KursunBypassTamburContext | null;
      /**
       * Adımda AÇIK TOP YOK ama kart yetkili operatör için yine de açıldı.
       * Ekran bunu görünce "bekleyen top yok" bandı basıp yalnız saha
       * düzeltmesini sunar (kesim/finalize aksiyonları anlamsızdır).
       */
      emptyStep?: boolean;
    }>
  > {
    return getTamburContextImpl.call(this as unknown as TamburServiceThis, cardBarcode, opts);
  }

}
