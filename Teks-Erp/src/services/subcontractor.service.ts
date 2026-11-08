// =============================================================================
// TeksERP - Subcontractor (Fason) Service
// =============================================================================
// İş Kuralı:
//   - EXTERNAL station step'lerinde toplar operator tarafından START/FINISH
//     yapılamaz. Yerine şu iki uç nokta kullanılır:
//       * dispatch(): Seçilen toplar fasona sevk edilir. Step ACTIVE olur.
//                     Roll.status → AT_SUBCONTRACTOR. Refakat kartı DEPARTURE.
//       * receive() : Fasondan gelen fiziksel toplar irsaliye+göz kontrolü ile
//                     yeni barkodlarla sisteme alınır. Eski dispatch'e giren
//                     toplar RETURNED_FROM_SUBCONTRACTOR'a çekilir ve kapanır.
//                     Yeni toplar sonraki step'e taşınır, fire/çekme hesaplanır.
//                     Step COMPLETED olur. Refakat kartı ARRIVAL.
// Bölme (2026-11-08, davranış aynı): bu dosya CEPHEDİR — sınıf, dışa açık adlar ve
// metot imzaları burada; gövdeler `services/subcontractor/*.ts` alan modüllerinde
// kelimesi kelimesine durur (cephe metodu modül fonksiyonunu `this` bağlamıyla çağırır).
// Çağıranlar yalnız bu yoldan import eder; alan modülleri cepheyi yalnız TİP olarak okur.
// =============================================================================

import prisma from "../lib/prisma";
import { ApiResponse } from "../types/api.types";
import { Prisma, RollStatus } from "@prisma/client";
import { type YarnDispatchLineInput } from "./subcontractor-yarn.service";
import { listPendingReturns as listPendingReturnsImpl, getPendingReturnGroupDetail as getPendingReturnGroupDetailImpl } from "./subcontractor/pending-returns";
import { findClosedRemainderItems as findClosedRemainderItemsImpl, getCancelPreview as getCancelPreviewImpl, cancelReceipt as cancelReceiptImpl } from "./subcontractor/receipt-cancel";
import type { BornRollPreviewItem, ReceiptBatchMismatchItem } from "./subcontractor/receipt-cancel";
import { dispatch as dispatchImpl, bulkDispatchStep as bulkDispatchStepImpl, transferToNextFason as transferToNextFasonImpl, previewDownstreamFasonCeki as previewDownstreamFasonCekiImpl, updateInstruction as updateInstructionImpl } from "./subcontractor/dispatch";
import { cancel as cancelImpl, cancelBulk as cancelBulkImpl, getUndoTransferPreview as getUndoTransferPreviewImpl, undoTransfer as undoTransferImpl } from "./subcontractor/dispatch-cancel";
import { receive as receiveImpl, receiveInner as receiveInnerImpl } from "./subcontractor/receive";
import { reopenRemainder as reopenRemainderImpl, closeRemainder as closeRemainderImpl } from "./subcontractor/remainder";
import { listDispatches as listDispatchesImpl, getDispatch as getDispatchImpl, listReceipts as listReceiptsImpl, getReceipt as getReceiptImpl, getDispatchDyeOverlay as getDispatchDyeOverlayImpl, getReceiptPrintSnapshot as getReceiptPrintSnapshotImpl } from "./subcontractor/read";
import { previewDirectShip as previewDirectShipImpl, executeDirectShip as executeDirectShipImpl } from "./subcontractor/direct-ship";
import type { SubcontractorServiceThis } from "./subcontractor/shared";
// Resmi belge builder kayıtları modül yüklenince bir kez koşar (eskiden bu dosyanın sonundaydı).
import "./subcontractor/printed-docs";

export { nextSubcontractorDocNoTx } from "./subcontractor/shared";
export type { BornRollPreviewItem } from "./subcontractor/receipt-cancel";
export type { ReceiptBatchMismatchItem } from "./subcontractor/receipt-cancel";

export class SubcontractorService {
  // ===========================================================================
  // DISPATCH — Fasona sevk
  // ===========================================================================
  async dispatch(
    data: {
      workOrderId: string;
      stepId: string;
      subcontractorId: string;
      rollIds: string[];
      plateNumber?: string;
      driverName?: string;
      notes?: string;
      /** Fason talimatı — genel sevk notundan (notes) ayrı. Boşsa adımın notu kullanılır. */
      instruction?: string;
      /**
       * Operatör WO ürünü ile uyuşmayan top sevkini bilinçli olarak onayladı.
       * Frontend mismatch modal'ında onayladıktan sonra true gönderir.
       * Bu durumda mismatch warning audit'e ITEM_MISMATCH_OVERRIDE olarak
       * yazılır, sevk normal işler.
       */
      allowItemOverride?: boolean;
      /**
       * Operatör rota sırasını atlayan sevki (ör. zımpara atlanıp doğrudan
       * boyahaneye) bilinçli onayladı. Frontend ROUTE_SKIP uyarı modalında
       * onaylayınca true gönderir; audit'e routeSkipOverride yazılır.
       */
      allowRouteSkip?: boolean;
      /**
       * K11: seçilen toplar 2+ partiye yayılıyorsa çözüm stratejisi. 'MERGE' = en eski
       * partide birleştir (diğer kartlar VOID); 'SEPARATE' = parti başına ayrı sevk, HEPSİ
       * TEK tx'te (ya hep ya hiç, D8 R5a); verilmezse 409 MULTI_BATCH (eski istemci aynı yanıtı alır).
       */
      multiBatchStrategy?: "MERGE" | "SEPARATE";
      /**
       * F1: fasona verilen LEVENTLER (kalem `kind=WARP_BEAM`, `SHIP_OUT` aynı tx). Top listesinden
       * bağımsız — levent-yalnız sevk meşrudur (parti boş doğar). Kapı: devere kapalıysa controller 403.
       */
      warpBeamIds?: string[];
      /**
       * G1: fasona verilen İPLİK satırları (kalem `kind=YARN`, `SUBCONTRACT_OUT` aynı tx). Top ve leventten
       * bağımsız — iplik-yalnız sevk meşrudur. Kapı: iplik kapalıysa controller 403 + tek yazıcı 403.
       */
      yarnLines?: YarnDispatchLineInput[];
    },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return dispatchImpl(data, userId);
  }

  // ===========================================================================
  // BULK DISPATCH — Masaüstü "adımı toplu fasona sevk et" (top okutmadan)
  // ===========================================================================
  //
  // Planlama ekranı için: bir EXTERNAL adımda BEKLEYEN (currentStepId=stepId,
  // status IN_PRODUCTION|STOCK) tüm topları planlanan/seçilen firmaya tek tıkla
  // sevk eder. Top-top okutma yok — saha mobil dispatch()'in masaüstü muadili.
  // GERÇEK dispatch()'e delege eder: irsaliye (PrintedDocument) + AT_SUBCONTRACTOR
  // + atomik claim + audit hepsi oradan gelir (tek kaynak; mobil sevkle aynı yol).
  // (workorder.service quickStart `dispatchFirstStep`'in genelleştirilmiş hali.)
  async bulkDispatchStep(
    data: {
      workOrderId: string;
      stepId: string;
      /** Yoksa adımın plannedSubcontractorId'si kullanılır. */
      subcontractorId?: string;
      /** Verilirse yalnız bu toplar sevk edilir (alt-küme seçimi); yoksa adımdaki
       *  bekleyen TÜM toplar. */
      rollIds?: string[];
      /** dispatch()'e iletilir — rota-atlama uyarısını bilinçli geçmek için. */
      allowRouteSkip?: boolean;
      instruction?: string;
      plateNumber?: string;
      driverName?: string;
      /** K11 çok-parti çözümü. MERGE → dispatch()'e iletilir (en eskide birleşir);
       *  SEPARATE → burada parti başına AYRI sevk döngüsü. */
      multiBatchStrategy?: "MERGE" | "SEPARATE";
    },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return bulkDispatchStepImpl.call(this as unknown as SubcontractorServiceThis, data, userId);
  }

  // ===========================================================================
  // TRANSFER TO NEXT FASON — Fasondan fasona doğrudan aktarım (zımpara→boyahane)
  // ===========================================================================
  //
  // Mal fabrikaya UĞRAMADAN bir fasondan diğerine gidiyor. Tek tıkla içerideki
  // "önceki fasondan kabul + sonraki fasona sevk" zincirini yapar:
  //   1) receive(mevcut adım) → orijinaller SUBCONTRACTOR_CONSUMED, born açık-kumaş
  //      toplar bir SONRAKİ adıma IN_PRODUCTION doğar (metraj 1:1 taşınır —
  //      zımparada kesim/çekme yok; kesin ölçüm boyahane DÖNÜŞÜNDE damgalanır).
  //   2) bulkDispatchStep(sonraki adım) → born toplar boyahaneye sevk edilir.
  // Her iki çağrı AYRI tx (dispatchFirstStep kısmi-başarı emsali): 2. patlarsa
  // toplar boyahane adımında bekler, planlamacı "Sevk Et" ile tamamlar.
  async transferToNextFason(
    data: {
      workOrderId: string;
      stepId: string; // mevcut (kaynak) fason adım
      /** Yoksa sonraki adımın plannedSubcontractorId'si kullanılır. */
      nextSubcontractorId?: string;
      /** Verilirse yalnız bu (AT_SUBCONTRACTOR) toplar aktarılır; yoksa hepsi. */
      rollIds?: string[];
      instruction?: string;
    },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return transferToNextFasonImpl.call(this as unknown as SubcontractorServiceThis, data, userId);
  }

  // ===========================================================================
  // ERKEN TASLAK ÇEKİ — sevkten ÖNCE bir sonraki fason adımının çekisini üret
  // ===========================================================================
  //
  // Mal zımpara→boyahane fabrikaya UĞRAMADAN gidebildiği için, planlamacı zımparaya
  // sevk yapar yapmaz boyahane çekisini de basıp mal ile göndermek istiyor. Ama
  // gerçek boyahane sevki (=durum değişikliği: zımpara COMPLETED, born toplar) henüz
  // yapılmamalı. Bu metod HİÇBİR kayıt değiştirmez — sadece bir sonraki fason adımı
  // için, önceki fasonda (AT_SUBCONTRACTOR) bekleyen TOPLARI projekte ederek
  // TASLAK filigranlı çeki HTML'i döndürür (tek-kaynak renderFasonCekiHtml).
  async previewDownstreamFasonCeki(
    workOrderId: string,
    stepId: string
  ): Promise<ApiResponse<{ html: string }>> {
    return previewDownstreamFasonCekiImpl(workOrderId, stepId);
  }

  // ===========================================================================
  // CANCEL — Sevk iptali (soft cancel)
  // ===========================================================================
  //
  // Kural:
  //   - Dispatch silinmez; cancelledAt/cancelledById/cancelReason set edilir.
  //   - Toplar STOCK'a geri döner ve currentStepId temizlenir (serbest stoğa iner).
  //     Parti üyeliği (batchId) KORUNUR — üyelik attach'te doğar, iptal bozamaz.
  //   - Açık RollMovement varsa "CANCEL:dispatchNo" notuyla kapatılır.
  //   - SUBCONTRACTOR_SENT operation log'u silinir (idempotent).
  //   - Step'te başka aktif sevk/dispatch yoksa PENDING'e döner.
  //   - Mal kabul yapılmış sevk iptal EDİLEMEZ (önce kabul iptal endpoint'i
  //     gerekir — şu an o yok, dolayısıyla blok).
  //   - Refakat kartına CANCEL log'u düşülür.
  //
  async cancel(
    dispatchId: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    return cancelImpl(dispatchId, reason, userId);
  }

  /**
   * ÇOK SEVKİ tek çağrıda iptal eder → toplar depoya döner.
   *
   * Neden var: bir iş emrinin fason çıkışı K10 gereği parti başına AYRI sevktir
   * (`SubcontractorDispatch.batchId` NOT NULL). Malı içeri almak isteyen kişi
   * bugün parti parti gezip her sevki tek tek iptal ediyor — iş emrini iptal
   * etmenin ön koşulu tam olarak bu. Uç, o gezinmeyi tek onaya indirir.
   *
   * ⚠️ SONUÇ PARÇALIDIR ve bu BİLİNÇLİDİR (`kursun-bypass.cancelBulk` sözleşmesi):
   * her sevk KENDİ tx'inde iptal edilir. Tek tx yanlış olurdu — (a) `cancel()`
   * her sevkte WO satırını kilitler, onlarca sevki tek tx'te tutmak deadlock
   * riskidir; (b) hepsi-ya-hiç semantiği burada zararlıdır: aralarından biri bu
   * arada mal kabul görmüşse diğerlerinin iptalini geri almak kullanıcının
   * niyetine aykırıdır. Karşılığında atlanan her sevk SOMUT sebebiyle döner —
   * "5 sevk iptal edildi" deyip 2'sinin neden atlandığını yutmak en kötüsüdür.
   */
  async cancelBulk(
    input: { dispatchIds: string[]; reason: string },
    userId?: string
  ): Promise<
    ApiResponse<{
      cancelled: number;
      cancelledNos: string[];
      failed: Array<{ dispatchId: string; dispatchNo: string | null; message: string }>;
    }>
  > {
    return cancelBulkImpl.call(this as unknown as SubcontractorServiceThis, input, userId);
  }

  // ===========================================================================
  // RECEIVE — Fason mal kabul (etiket basmaz, ölçüm yapmaz)
  // ===========================================================================
  //
  // YENİ MODEL (boyahane gibi açık kumaş döndüren fason):
  //   - Orijinal Roll'lar TERMINAL'e çekilir (status=SUBCONTRACTOR_CONSUMED).
  //     Fiziksel olarak top kaybolmuştur (boyahane top açıp birleştirmiş).
  //   - Yeni Roll BURADA AÇILMAZ. Yeni "açık kumaş" Roll'ları Kurşun/KK2 istasyonu
  //     operatörü tarafından (`POST /api/rolls/open-fabric`) açılır; receipt'ten
  //     colorId + propertyIds inherit edilir.
  //   - Receipt'e appliedColorId + appliedPropertyIds yazılır (renk veren
  //     kategoriden gelmişse WO.targetColor/Properties'tan otomatik kopyalanır;
  //     UI override gönderebilir).
  //   - Bu step'in tüm outstanding'i consumed olunca step COMPLETED.
  //   - Sonraki step PENDING kalır (Roll yok); operatör Kurşun/KK2'de ilk
  //     açık kumaş Roll'u oluşturduğunda step ACTIVE olur.
  //
  /**
   * Fason mal kabulü — dış kapı.
   *
   * ⚠️ TOKEN KİMLİĞİYLE İDEMPOTENT KURTARMA (BULGU-T1-005). Aynı fişin ikinci
   * kopyası (çevrimdışı kuyruk replay'i / çift dokunuş) yarışı KAYBETTİĞİNDE üç
   * ayrı noktada düşebilir ve üçü de farklı hata verir:
   *   • tx ÖNCESİ iş kuralı  — "toplar bu adımda fasona gönderilmemiş veya zaten dönmüş"
   *   • tx İÇİNDE claim      — top artık AT_SUBCONTRACTOR değil
   *   • `receipt.create`     — `clientToken` P2002
   * Operatör için üçü de aynı şeydir: "kabul zaten yapıldı". Bu yüzden kurtarma
   * hata TÜRÜNE değil KİMLİĞE bakar: o token'la kaydedilmiş bir makbuz varsa
   * denemenin işi ZATEN yapılmıştır ve doğru cevap odur.
   *
   * Eskiden kaybeden istek yanıltıcı bir 409 alıyordu ("Barkod üretimi 5 denemede
   * başarısız oldu" — predicate'siz retry) ve operatör kabulü ELLE yeniden
   * giriyordu; yeni token hiçbir guard'a takılmadığı için teslimat İKİ KEZ
   * düşülüyordu (ölçüm: 300 m'lik topta 300 → 60, 2 aktif makbuz).
   */
  async receive(
    data: Parameters<SubcontractorService["receiveInner"]>[0],
    userId?: string,
  ): ReturnType<SubcontractorService["receiveInner"]> {
    return receiveImpl.call(this as unknown as SubcontractorServiceThis, data, userId);
  }

  /**
   * Kabulün ASIL gövdesi. Dışarıya `receive()` sarmalayıcısı açılır — token
   * kimliğiyle idempotent kurtarma orada yapılır (BULGU-T1-005).
   */
  private async receiveInner(
    data: {
      workOrderId: string;
      stepId: string;
      subcontractorId: string;
      /** Doğan topların partisi — kabulün açık sevklerinden biri olmalı; yoksa en eski açık sevkin partisi (D8 R5b). */
      batchId?: string | null;
      manifestNo?: string | null; // Opsiyonel — fason her zaman irsaliye vermeyebilir
      returns: Array<{
        rollId: string;         // Orijinal fasona gönderilmiş top
        notes?: string | null;  // Bu topa dair kabul notu (opsiyonel)
        /// KISMİ KABUL (2026-08-19): bu teslimatta bu toptan gelen metraj.
        /// Verilmez ya da kalanı aşar/eşitler → TAM kabul (top tüketilir; eski
        /// APK'ların davranışı birebir korunur). Kalanın altındaysa → top
        /// AT_SUBCONTRACTOR kalır, currentQty atomik decrement ile kalana iner;
        /// kalan ikinci bir teslimatla (yeni makbuz) ya da "kalan gelmeyecek"
        /// kapamasıyla (closeRemainder) kapanır. Kısmi sevkin (satır ~530) aynası.
        receivedQty?: number | null;
      }>;
      notes?: string;
      /// İdempotency anahtarı — kısmi teslimatta replay'in TEK kimliği (aşağıda).
      clientToken?: string | null;
      /// Override — fason kategorisi appliesColor=true ise WO.targetColorId
      /// otomatik kullanılır; UI farklı renk seçtiyse buradan gönderilir.
      appliedColorId?: string | null;
      /// Tabletin kabul ekranını açarken gördüğü iş emri hedef rengi (null =
      /// hedefsiz). Kilit altında taze hedefle karşılaştırılır; farklıysa 409
      /// `TARGET_COLOR_CHANGED`. `undefined` = kontrol yok (eski APK).
      expectedTargetColorId?: string | null;
      /// Plandan FARKLI renk kabul edilirken operatörün kararı (2026-08-21):
      /// APPLY_TO_PLAN → kabul sonrası iş emri hedef rengi de bu renge çekilir
      /// (tx DIŞI, best-effort; tek bekçi reddederse yanıt `warnings`);
      /// ROLLS_ONLY → sapma KABULDE deftere düşer, Tambur aynı topa tekrar sormaz.
      /// undefined = eski davranış.
      planColorAction?: "APPLY_TO_PLAN" | "ROLLS_ONLY";
      /// Override — fason kategorisi appliesProperty=true ise WO.targetProperties
      /// otomatik kullanılır; UI farklı liste verirse buradan gönderilir (replace).
      appliedPropertyIds?: string[];
      /// Bu kabulde ÖLÇÜLEN en (cm) — doğan TÜM parçalara uygulanır ve makbuza yazılır.
      /// Renkten farkı: renk yalnız "renk veren" kategoride sorulur, en HER fason
      /// dönüşünde sorulur (topun enini ilk kez burada öğreniyoruz — ham girişte en
      /// tasarım gereği yazılmıyor). Zorunluluk ARAYÜZDE; burada opsiyonel kalması
      /// zorunludur, yoksa alanı göndermeyen eski APK'ların her kabulü 400 alır.
      appliedWidth?: number | null;
      /// Fasondan gelen açık kumaş parçaları — verilirse Receipt anında yeni
      /// "open-fabric" Roll'lar otomatik doğar ve rotadaki bir sonraki adıma
      /// bağlanır. Verilmezse mevcut akış: Kurşun/KK2 operatörü
      /// `POST /api/rolls/open-fabric` ile manuel açar.
      newRolls?: Array<{
        qty: number;
        weightKg?: number | null;
        notes?: string | null;
      }>;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    return receiveInnerImpl(data, userId);
  }

  // ===========================================================================
  // KALAN KAPAMA — "kalan gelmeyecek" (fasonda zayi)
  // ===========================================================================
  //
  // Kısmi teslimat sonrası fasonda bekleyen kalan (ya da hiç dönmemiş top) fire
  // kararıyla kapatılır: top SUBCONTRACTOR_CONSUMED'a çekilir, kalan metraj
  // SAPMA DEFTERİNE yazılır (RollVariance SCRAP, source=SUBCONTRACTOR_REMAINDER,
  // sebep ReasonPreset fire kataloğundan) ve açık sevk kalemi `remainderClosedAt`
  // ile damgalanır — damgasız kalem outstanding filtrelerinde sonsuza dek açık
  // görünür, parti kilidi (isBatchLockedTx b) hiç açılmazdı. Fason karnesi bu
  // kalemi "kapandı" sayar ve fark otomatik FİRE çıkar.
  //
  // Kapama ELLE yapılır ve sebep zorunludur (kullanıcı kararı 2026-08-19);
  // otomatik zaman aşımı YOK — yaş göstergesi bekleyen listesinde amber bant.
  /**
   * "Kalan gelmeyecek" kararını GERİ AL (BULGU-T3-017).
   *
   * ⚠️ NEDEN VAR: `closeRemainder` topu `SUBCONTRACTOR_CONSUMED` yapar ve o andan
   * sonra o kabulün iptali 409 verir. Geri alma yolu OLMADIĞI için yanlış girilen
   * bir metraj KALICI oluyordu: defterde "51 m kabul + 49 m fire", gerçekte
   * "15 m kabul + 85 m fasonda"; fason karnesinde sahte fire, üretim rakamında
   * sahte üretim. Düzeltmenin tek yolu DB müdahalesiydi.
   *
   * Kural (denetimin değişmezi): geri ALINAMAZ her karar için bir geri alma yolu
   * bulunmalı — yoksa yanlış giriş kalıcı olur.
   *
   * ⚠️ SAPMA SATIRI SİLİNMEZ, `reversedAt` ile İŞARETLENİR (append-only defter;
   * `cancelReceipt`in emsali). Fire raporu geçmişi kaybetmez, yalnız satırın
   * tersine çevrildiğini bilir.
   * ⚠️ Yeni migration ve YENİ İZİN KODU GEREKMEZ — `RollVariance.reversedAt`
   * şemada zaten var; uç `subcontractor:write` ∨ `roll:manual-adjust` ile açılır.
   */
  async reopenRemainder(
    data: { stepId: string; rollId: string },
    userId?: string,
  ): Promise<ApiResponse<{ rollId: string; restoredQty: number }>> {
    return reopenRemainderImpl(data, userId);
  }

  async closeRemainder(
    data: {
      stepId: string;
      rollId: string;
      reasonCode: string;
      reasonText?: string | null;
    },
    userId?: string,
  ): Promise<ApiResponse<{ rollId: string; closedQty: number }>> {
    return closeRemainderImpl(data, userId);
  }

  // ===========================================================================
  // LIST & QUERIES
  // ===========================================================================

  async listPendingReturns(params?: {
    workOrderId?: string;
  }): Promise<ApiResponse<unknown>> {
    return listPendingReturnsImpl(params);
  }

  /** GET /api/subcontractor/pending-returns/step/:stepId — seçim anında rolls lazy-load */
  async getPendingReturnGroupDetail(stepId: string): Promise<ApiResponse<unknown>> {
    return getPendingReturnGroupDetailImpl(stepId);
  }

  async listDispatches(params?: {
    workOrderId?: string;
    subcontractorId?: string;
    /** 'all' (varsayılan) · 'active' = iptal edilmemiş · 'cancelled' = iptal edilmiş. */
    status?: "all" | "active" | "cancelled";
    /** sevk no / fason firma adı / parti kodu (case-insensitive). */
    search?: string;
    dateFrom?: Date;
    dateTo?: Date;
    // offset (eski FasonSevk modal davranışı + geriye uyum)
    page?: number;
    pageSize?: number;
    // cursor (yeni Fason Sevk Geçmişi sayfası — keyset, derin sayfalama hızlı)
    cursor?: string;
    mode?: string;
    limit?: number;
    withTotal?: boolean;
  }): Promise<{
    success: true;
    data: unknown[];
    pagination: {
      page?: number;
      pageSize?: number;
      total?: number;
      totalPages?: number;
      nextCursor?: string | null;
      hasMore?: boolean;
      limit?: number;
      totalEstimate?: number;
    };
  }> {
    return listDispatchesImpl(params);
  }

  /**
   * Sevk detayı. F1: levent kalemi OPT-IN (`includeBeams`) — varsayılan yanıt yalnız TOP kalemlerini
   * döner (eski istemci `item.roll` bekler); açıkken kalem `kind` + `warpBeam{beamNo, status}` taşır,
   * `beamItemCount` her iki halde de yazılır (yeni istemci gizli kalemi sayıdan görür).
   */
  async getDispatch(id: string, opts?: { includeBeams?: boolean }): Promise<ApiResponse<unknown>> {
    return getDispatchImpl(id, opts);
  }

  async listReceipts(params?: {
    workOrderId?: string;
    subcontractorId?: string;
    page?: number;
    pageSize?: number;
    /** Cursor mode (DEFAULT — Geçmiş Kabuller sonsuz akışı): keyset by receivedAt. */
    mode?: string;
    limit?: number;
    cursor?: string;
    /** İlk sayfada yaklaşık toplam için (cursor mode'da count opt-in). */
    withTotal?: boolean;
    /**
     * İptal edilebilirlik filtresi — mobil "İptal Edilebilirler" vs "Geçmiş
     * Kabuller" sekmelerini ayırır. Mantık: bir receipt iptal edilebilir <=>
     * tüm bornRoll'ları "güvenli durumda" (üzerinde işlem yok, sonraki adıma
     * geçmemiş, bölünmemiş, başka sevkte değil, status STOCK/IN_PRODUCTION).
     *   - 'yes' → tüm bornRoll'ları güvenli
     *   - 'no'  → en az bir bornRoll bloklu (settled)
     *   - undefined → her ikisi (varsayılan, eski davranış)
     * BornRoll'sız receipt'ler her zaman cancellable sayılır (none: vacuously true).
     */
    cancellable?: "yes" | "no";
  }): Promise<{
    success: true;
    data: unknown[];
    pagination:
      | { page: number; pageSize: number; total: number; totalPages: number }
      | { nextCursor: string | null; hasMore: boolean; limit: number; totalEstimate?: number };
  }> {
    return listReceiptsImpl(params);
  }

  async getReceipt(id: string): Promise<ApiResponse<unknown>> {
    return getReceiptImpl(id);
  }

  // ===========================================================================
  // DISPATCH BOYA OVERLAY — fason sevk irsaliyesinin CANLI talimat alanları
  // ===========================================================================
  // Donmuş içerik (toplar/totaller/fasoncu/adım) artık PrintedDocument'te. Burada
  // yalnız KASTEN canlı tutulan talimat alanları döner: istenen renk (WO hedef
  // rengi — fason sonrası değişebilir; fasoncuya hangi renge boyanacağını söyler)
  // + fason talimatı (sevk sonrası düzenlenebilir; kabul/iptalde kilitlenir). Talimat
  // boşsa default kaynağı sevk edilen adımın notu (stepNote) → çeki listesine basılır.
  async getDispatchDyeOverlay(id: string): Promise<ApiResponse<unknown>> {
    return getDispatchDyeOverlayImpl(id);
  }

  // ===========================================================================
  // UPDATE INSTRUCTION — Fason talimatını sevk sonrası düzenle (Electron)
  // ===========================================================================
  // Sevk notu (notes) snapshot'a dondurulduğu için değişmez; fason talimatı ise
  // canlı kolon — planlamacı sevk fişini açıp talimatı sonradan ekleyebilir/
  // düzeltebilir. İptal edilmiş sevkte düzenlemeye izin verilmez.
  async updateInstruction(
    id: string,
    instruction: string | null,
    userId?: string
  ): Promise<ApiResponse<{ id: string; dispatchNo: string; instruction: string | null }>> {
    return updateInstructionImpl(id, instruction, userId);
  }

  // ===========================================================================
  // CANCEL RECEIPT — Fason kabulün iptali (operatör hatası geri alma)
  // ===========================================================================
  //
  // Kural:
  //   - Receipt soft-cancel edilir (cancelledAt/By/Reason).
  //   - Receipt'teki rulalar AT_SUBCONTRACTOR'a geri çekilir, currentStepId
  //     bu fason adımına döner.
  //   - Receipt seviyesindeki appliedColor / appliedProperty kayıtları silinir
  //     ("renk veren" ya da "özellik veren" kategori bu adımdaydı diye).
  //   - Sonraki adımda her rulo için: kapalı movement, RollOperation veya
  //     yeni dispatch varsa REDDET ("önce o işlemi geri al"). Aksi halde
  //     sonraki adımdaki açık movement geri alınır (silinmez, damgalanır).
  //   - Bu adımdaki SUBCONTRACTOR_RETURNED operation log'ları geri alınır (damga).
  //   - Step status recompute (genelde COMPLETED → ACTIVE'e döner).
  //   - WO COMPLETED iken iptal yasak.
  //
  /**
   * Receipt iptal preview — bornRoll'ları ve her birinin downstream durumunu
   * döner. Frontend bunu kullanarak operatöre "şu açık kumaş roll'ları da
   * iptal edilecek" onayı sunar. allSafe=false ise iptal disabled olmalı.
   */
  /**
   * KISMİ kabulün kaynak topları hâlâ fasonda mı? (BULGU-T3-017)
   *
   * Kısmi kabulde top TÜKETİLMEZ — `AT_SUBCONTRACTOR` kalır ve iptal, kabul
   * edilen metrajı ona geri ekler. Ama "kalan gelmeyecek" (`closeRemainder`)
   * kararı topu `SUBCONTRACTOR_CONSUMED` yapar; o andan sonra iptalin geri
   * ekleyeceği bir top kalmaz ve uç 409 verir.
   *
   * ⚠️ ESKİDEN ÖNİZLEME BUNU GÖRMÜYORDU: `allSafe:true` diyor, operatör "İptal
   * Et"e basıyor, 409 yiyordu — ve kapamanın geri alma yolu olmadığı için makbuz
   * BİR DAHA iptal edilemiyordu. Defter kalıcı olarak yanlış kalıyordu (51 m
   * kabul + 49 m sahte fire; gerçek 15 m kabul + 85 m fasonda).
   *
   * ⚠️ TEK KAYNAK: önizleme ve tx-içi guard AYNI yüklemden beslenir
   * (`computeReceiptBatchMismatches` deseni). Ayrışırlarsa önizlemenin "güvenli"
   * demesi ile ucun reddetmesi yine ayrı düşer.
   */
  private async findClosedRemainderItems(
    db: Prisma.TransactionClient | typeof prisma,
    receiptId: string,
  ): Promise<Array<{ barcode: string | null; status: RollStatus }>> {
    return findClosedRemainderItemsImpl(db, receiptId);
  }

  async getCancelPreview(receiptId: string): Promise<
    ApiResponse<{
      receiptNo: string;
      receivedAt: Date;
      bornRolls: BornRollPreviewItem[];
      /**
       * K14 parti-tutarlılık engeli — `cancelReceipt`'in tx-içi guard'ıyla AYNI
       * yardımcıdan gelir. Eskiden önizleme bunu hiç sormuyordu: operatör
       * `allSafe: true` görüp butona basıyor, sonra 409 yiyordu.
       */
      batchMismatch: {
        blocked: boolean;
        items: ReceiptBatchMismatchItem[];
        /** Guard'ın basacağı metnin birebir aynısı (null = engel yok). */
        message: string | null;
      };
      /** LIFO engeli (kısmi teslimat): aynı topa dokunan daha yeni aktif makbuzlar. */
      laterReceipts: string[];
      /**
       * ÜÇÜNCÜ ENGEL (BULGU-T3-017): kısmi kabulün kaynak topunun kalanı
       * "gelmeyecek" olarak kapatılmışsa top artık fasonda DEĞİLDİR ve iptalin
       * geri ekleyeceği bir şey kalmaz — uç 409 verir. Önizleme bunu önceden
       * söylemeli; `cancelReceipt`in guard'ıyla AYNI yardımcıdan gelir.
       */
      remainderClosed: {
        blocked: boolean;
        rolls: string[];
        message: string | null;
      };
      allSafe: boolean;
      totalBornRolls: number;
    }>
  > {
    return getCancelPreviewImpl.call(this as unknown as SubcontractorServiceThis, receiptId);
  }

  async cancelReceipt(
    receiptId: string,
    reason: string,
    userId?: string,
    cascadeRollIds: string[] = [],
  ): Promise<ApiResponse<{ receiptNo: string; revertedRollCount: number; cascadedRollCount: number }>> {
    return cancelReceiptImpl(receiptId, reason, userId, cascadeRollIds);
  }

  // ===========================================================================
  // UNDO TRANSFER — "Aktarımı Geri Al" (fason→fason yanlış aktarımı geri sar)
  // ===========================================================================
  //
  // Senaryo: planlamacı malı yanlışlıkla sonraki fasona aktardı (zımpara→boyahane,
  // "Sonraki Fasona Aktar"). Boyahane henüz kabul/işlem YAPMADIYSA tek tıkla geri
  // alınabilmeli — mal kaynak fasona (zımpara) AT_SUBCONTRACTOR olarak geri döner.
  //
  // NEDEN ADANMIŞ TX (cancel()+cancelReceipt() zinciri DEĞİL): aktarım çıktısı born
  // toplar boyahanede AT_SUBCONTRACTOR + kendi boyahane SUBCONTRACTOR_SENT op'una
  // sahip. Naif cancelReceipt() bunu computeBornRollBlockingReasons'da "üzerinde
  // işlem yapılmış" / "başka sevkte" sayıp reddeder; cancel() de born topun
  // movement'ını "geçmiş" damgalar. Bu yüzden undo'ya özel, born topun KENDİ
  // boyahane sevkini meşru kabul eden tek atomik tx yazıyoruz.
  //
  // Şablon: dispatch.cancel() (boyahane sevki) ∪ receipt.cancelReceipt() (kaynak
  // kabul) — ikisi tek tx'te, undo-farkında guard'la.

  /** Salt-okunur önizleme — geri alınacak born toplar + kaynak kabuller + güvenlik. */
  async getUndoTransferPreview(dispatchId: string): Promise<ApiResponse<unknown>> {
    return getUndoTransferPreviewImpl(dispatchId);
  }

  /**
   * "Aktarımı Geri Al" — adanmış atomik tx: boyahane sevkini iptal et + born
   * topları CANCELLED'a çek + kaynak kabul(ler)i iptal et → orijinaller
   * AT_SUBCONTRACTOR olarak kaynak fasona (batchId korunur) geri döner.
   */
  async undoTransfer(
    dispatchId: string,
    reason: string,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; dispatchNo: string }>> {
    return undoTransferImpl(dispatchId, reason, userId);
  }

  // ===========================================================================
  // RECEIPT PRINT SNAPSHOT
  // ===========================================================================
  async getReceiptPrintSnapshot(id: string): Promise<ApiResponse<unknown>> {
    return getReceiptPrintSnapshotImpl(id);
  }

  // ===========================================================================
  // DIRECT SHIP — Fasondan doğrudan sevk (fason fiilen son durak)
  // ===========================================================================
  //
  // Nadir senaryo: mal fasondan bize dönmeden DOĞRUDAN müşteriye sevk edilir.
  // receive() çağrılmadığından toplar sonsuza dek AT_SUBCONTRACTOR'da, dispatch
  // açık, WO hiç COMPLETED olmazdı. Bu manuel müdahale (ofis/yönetim) sevki
  // "doğrudan sevk edildi" diye kapatır: topları tüketir, fason adımını ve
  // (varsa) sonraki planlı adımları kapatır, WO'yu tamamlar; istenirse hangi
  // siparişe gittiği karşılanmaya işlenir; donmuş resmi belge üretir.
  // Şablon: receive() (tüket + WO complete) + cancel() (guard/claim/scan/doc).
  //
  /** Salt-okunur önizleme — etkilenecek toplar/adımlar + aday sipariş satırları. */
  async previewDirectShip(dispatchId: string): Promise<ApiResponse<unknown>> {
    return previewDirectShipImpl(dispatchId);
  }

  /** Doğrudan sevki yürüt — atomik: tüket + adım/WO kapat + (ops.) karşılanma + belge. */
  async executeDirectShip(
    data: {
      dispatchId: string;
      reason: string;
      /** Sevk edilecek topların alt-kümesi (yok/boş = sevkin TÜMÜ). Seçilmeyenler
       *  AT_SUBCONTRACTOR kalır → normal fason kabulüyle fabrikaya döner. */
      rollIds?: string[];
      /** Kısmi metraj: topId → sevk metre. Topun kalanından azsa top bölünür
       *  (çocuk = sevk edilen, orijinal = kalan, fasonda AT_SUBCONTRACTOR kalır). */
      rollShipQtys?: Record<string, number>;
      /** Mal KİME gitti — DirectShipment kaydı + irsaliye için ZORUNLU. */
      customerId?: string;
      branchId?: string;
      /** true → fason fiilen son durak: kalan adımlar SKIPPED + WO COMPLETED.
       *  false (default) → sadece toplar sevk edilir, WO açık kalır (kalan üretim devam). */
      completeWorkOrder?: boolean;
      orderLineAllocations?: Array<{ orderLineId: string; qty: number }>;
      /** "Bu mal bilerek siparişsiz gidiyor" beyanı — `shipping.orderRequirement`
       *  `block` rejiminin KAÇIŞ KAPISI. Fason doğrudan sevk çoğu zaman son
       *  duraktır (numune / kalan mal) ve kapı kaçışsız kalırsa o akış tamamen
       *  kilitlenirdi. Kural "sipariş seç" değil "ne yaptığını söyle"dir. */
      orderless?: boolean;
    },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return executeDirectShipImpl(data, userId);
  }
}
