// =============================================================================
// TeksERP - Inventory Service
// =============================================================================
// Handles initial goods receipt (Ham Mal Girişi / QC1) and inventory queries.
// Business Rule: Rolls default to STOCK status. IN_PRODUCTION rolls
// are excluded from inventory queries unless explicitly filtered.
// Bölme (2026-11-08, davranış aynı): bu dosya CEPHEDİR — sınıf, dışa açık adlar ve
// metot imzaları burada; gövdeler `services/inventory/*.ts` alan modüllerinde
// kelimesi kelimesine durur (cephe metodu modül fonksiyonunu `this` bağlamıyla çağırır).
// Çağıranlar yalnız bu yoldan import eder; alan modülleri cepheyi yalnız TİP olarak okur.
// =============================================================================

import { type Kk1BirthInput } from "./helpers/kk1-roll-birth.helper";
import { type ItemUsage } from "./helpers/item-usage.helper";
import { ApiResponse, PaginatedResponse, QueryParams } from "../types/api.types";
import type { CursorPaginatedResponse } from "./base.service";
import { Request } from "express";
import {
  Prisma,
  Roll,
  RollStatus,
  RollEntrySource,
  RollStage,
} from "@prisma/client";
import {
  type PropertySelection,
} from "./helpers/station-capability-transfer.helper";
import {
  type BirthInspectionInput,
} from "./helpers/inspection-on-birth.helper";
import { createInitialEntry as createInitialEntryImpl, initialEntryReplay as initialEntryReplayImpl, createInitialEntryFresh as createInitialEntryFreshImpl } from "./inventory/initial-entry";
import { buildRollWhere as buildRollWhereImpl, findAllRolls as findAllRollsImpl, getRollStats as getRollStatsImpl, getRollStatsBatch as getRollStatsBatchImpl, getWarehouseScope as getWarehouseScopeImpl } from "./inventory/list";
import { getProductionFlow as getProductionFlowImpl, listEntryUsers as listEntryUsersImpl, listEntryStations as listEntryStationsImpl } from "./inventory/production-flow";
import { getRollSubcontractorSummary as getRollSubcontractorSummaryImpl } from "./inventory/subcontractor-summary";
import { readManualEntryReason as readManualEntryReasonImpl, findRollById as findRollByIdImpl, buildCancelDiagnostics as buildCancelDiagnosticsImpl, findRollByBarcode as findRollByBarcodeImpl } from "./inventory/detail";
import { getRelabelContext as getRelabelContextImpl } from "./inventory/relabel";
import { getRollHistory as getRollHistoryImpl } from "./inventory/history";
import { getCancelPreview as getCancelPreviewImpl, softDelete as softDeleteImpl } from "./inventory/cancel";
import { restoreCancelledRoll as restoreCancelledRollImpl, hardDelete as hardDeleteImpl } from "./inventory/restore";
import { applyManualProperties as applyManualPropertiesImpl } from "./inventory/manual-properties";
import { fixRollLabelTexts as fixRollLabelTextsImpl, type LabelTextsFixInput, type LabelTextsFixResult } from "./inventory/label-texts";
import { adjustRollQty as adjustRollQtyImpl, prepareRawForSale as prepareRawForSaleImpl } from "./inventory/qty-adjust";
import { createOpenFabric as createOpenFabricImpl, openFabricReplay as openFabricReplayImpl, createOpenFabricFresh as createOpenFabricFreshImpl } from "./inventory/open-fabric";
import { getRescuePreview as getRescuePreviewImpl, rescueStuckRoll as rescueStuckRollImpl } from "./inventory/rescue";
import { kursunFinish as kursunFinishImpl } from "./inventory/kursun";
import type { InitialEntryResult } from "./inventory/initial-entry";
import type { RollStats } from "./inventory/list";
import type { ProductionFlowData } from "./inventory/production-flow";
import type { RollSubcontractorSummary } from "./inventory/subcontractor-summary";
import type { RelabelContext } from "./inventory/relabel";
import type { RollHistoryPayload } from "./inventory/history";
import type { RollCancelPreview } from "./inventory/cancel";
import type { RescuePreview } from "./inventory/rescue";
import type { InventoryServiceThis } from "./inventory/shared";

export type { BirthInspectionSummary, InitialEntryResult } from "./inventory/initial-entry";
export type { RollStats } from "./inventory/list";
export type { ProductionFlowQueueCard, ProductionFlowSackCard, ProductionFlowData } from "./inventory/production-flow";
export type { RollSubcontractorSummary } from "./inventory/subcontractor-summary";
export type { RelabelCandidateCustomer, RelabelContext } from "./inventory/relabel";
export type { RollHistoryEventKind, RollHistoryEvent, RollHistoryPayload } from "./inventory/history";
export { cancelRollRecordTx } from "./inventory/cancel";
export type { RollCancelPreview, RollCancelTxInput } from "./inventory/cancel";
export type { RescuePreview } from "./inventory/rescue";


export class InventoryService {
  /**
   * Initial goods receipt — creates a new Roll in STOCK status.
   *
   * Fabrikaya gelen ham kumaş girişi: barkod + temel meta veri. Top hep STOCK'a
   * düşer; iş emrine bağlama daha sonra `attach-rolls` ile yapılır.
   *
   * ⚠️ Bu metot iki farklı niyete hizmet eder ve ayrım 5. parametre (`opts`)
   * ile YAPILIR, renkle DEĞİL — bkz. `opts.forcedStatus` gerekçesi.
   */
  /**
   * Top doğumu — token replay'i tek boğazdan (R): ön-okuma kg/ürün/renk/kalite kapılarından ÖNCE (kapılar sonradan
   * değişse de tekrarın cevabı token'dan). Gövde `createInitialEntryFresh`.
   */
  async createInitialEntry(...args: Parameters<InventoryService["createInitialEntryFresh"]>): Promise<InitialEntryResult> {
    return createInitialEntryImpl.call(this as unknown as InventoryServiceThis, ...args);
  }

  /**
   * Top doğumu replay'i. Kimlik: ürün · renk · metre + BAĞLAM (mal kabul fişi · fason makbuzu · indirme verildiyse — başka
   * fişin satır token'ı o fişin topunu döndürmesin). 4. durum: iptal/fire → `ENTRY_CANCELLED`. Yanıt `idempotent: true`
   * taşır (mal kabul sayımı buna bakar); çakışma ayrıntısında `barcode` (KK1 okur).
   */
  private initialEntryReplay(
    data: { itemId: string; colorId?: string | null; initialQty: number },
    opts?: { goodsReceiptId?: string | null; parentReceiptId?: string | null; doffEventId?: string | null; kk1Birth?: Kk1BirthInput | null; inspection?: unknown },
  ) {
    return initialEntryReplayImpl(data, opts);
  }

  private async createInitialEntryFresh(
    data: {
      itemId: string;
      colorId?: string | null;
      initialQty: number;
      weightKg?: number;
      qualityGrade?: string;
      width?: number | null;  // En (cm) — opsiyonel, ölçülmediyse null
      propertyIds?: string[];
      /**
       * Opsiyonel idempotency anahtarı (UUID) — offline KK1 / ağ-retry için mobil
       * üretir. Barkod artık SUNUCU'da sıralı atandığından (T+GGAAYY+H/F+NNNN)
       * dedup barkodla değil bu token'la yapılır: Roll.clientToken @unique → aynı
       * token'la 2. çağrı cached Roll döner. Verilmezse (backend-içi çağrı) dedup yok.
       */
      clientToken?: string;
      /**
       * İstemcinin BEYAN ETTİĞİ giriş anı — operatörün "Kaydet"e bastığı an.
       * Mükerrer tuzağının penceresi bununla ölçülür (sunucu `createdAt`'i offline
       * flush'ta girişin anı DEĞİLDİR — bkz. `Roll.clientEnteredAt` şema notu).
       * Verilmezse / makul aralık dışındaysa sunucu saatine düşülür.
       */
      clientEnteredAt?: Date | null;
    },
    userId?: string,
    /** KK1 makine atfı — aktif çalışma oturumundan (controller çözer). KK1 girişi
     *  RollOperation üretmediği için atıf Roll.createdMachineId üstünde kapanır. */
    machineId?: string | null,
    /** İsteğin kaynağı — eşleşmiş mobil cihazdan mı (KK1 istasyon taraması) geldi,
     *  yoksa Electron admin panelinden mi ("Manuel Top Ekle")? entrySource bunu
     *  ayırt eder (controller `Boolean(req.device)` ile çözer — Electron ASLA
     *  x-device-id göndermez). */
    isMobileOrigin?: boolean,
    /**
     * KK1-DIŞI (bitmiş ürün) çağrılarının açık niyeti. Verilmezse metot bugünkü
     * KK1 davranışını BİREBİR korur — üç alanın hiçbiri KK1 create payload'ına
     * girmez (spread ile koşullu eklenir).
     */
    opts?: {
      /**
       * Topun doğacağı statü — **renk sezgisini BYPASS eder**.
       *
       * KK1 yolunda statü renkten çıkarılır (`colorId != null ? WAREHOUSE : STOCK`)
       * ve orada DOĞRUDUR: renksiz kumaş ham demektir, üretime girecektir. Ama
       * "bitmiş ürünü acilen depoya al" niyetinde bu sezgi SESSİZCE YANLIŞTIR —
       * renksiz (ham beyaz) bitmiş bir top Ham Stok'a düşer, operatör onu Bitmiş
       * Depo'da arar ve bulamaz. Bu yüzden bitmiş-ürün çağrıları statüyü AÇIKÇA
       * söyler; sezgi yalnız söylenmediğinde çalışır.
       *
       * Barkod tip damgası (H/F) da bu statüden türer (`finalBarcodeType`) —
       * renkten değil; renksiz bitmiş top "H" (ham) damgalı barkod ALMAZ.
       */
      forcedStatus?: RollStatus;
      /** Kartelalık işareti — yalnız WAREHOUSE'a doğan topta anlamlı (Tambur emsali). */
      markedForKartela?: boolean;
      /**
       * Topun GİRİŞ YERİ — `isMobileOrigin` sezgisini BYPASS eder.
       *
       * Sezgi iki kapı bilir: eşleşmiş mobil cihaz = KK1 istasyon taraması
       * (`SUPPLIER_RECEIPT`), cihazsız istek = Electron admin paneli
       * (`MANUAL_ENTRY`). Tambur'un "Manuel Ekle" modu bu ikisine de UYMAZ —
       * istek mobilden gelir ama KK1 taraması DEĞİLDİR; sezgiye bırakılırsa
       * kartsız üretilen bitmiş top envanterde ham tedarikçi girişi gibi görünür
       * ve topun detay panelindeki "giriş yeri" YANLIŞ olur. O yüzden o yol
       * kendi değerini (`TAMBUR_MANUAL`) AÇIKÇA söyler; sezgi yalnız
       * söylenmediğinde çalışır.
       */
      forcedEntrySource?: RollEntrySource;
      /** Doğuş aşaması (açık değer kazanır; yoksa `birthStageForEntry` giriş kaynağı + statüden türetir). */
      stage?: RollStage;
      /**
       * BU TOP HANGİ İNDİRMEDEN (dokuma P3/§3.8b) — yalnız `forcedEntrySource: WEAVING`
       * ile anlamlı; verilmezse NULL kalır ("atanmamış", tahmin edilmez). Bağ tx
       * içinde doff satırı KİLİTLENEREK kurulur (`claimDoffForRollTx`).
       */
      doffEventId?: string | null;
      /**
       * S1 — TOP KK1'DE DOĞAR (`dokuma.rollBirth` KK1_*): tezgah etiketi (`machineCode`) ya da iş emri
       * (`weavingOrderId`); indirme bu tx'te SUNUCUDA doğar (`resolveKk1BirthTx` → `createDoffTx`), sonra
       * mevcut bağ + levent zinciri aynen. `doffEventId` ile birlikte VERİLMEZ (controller zod'u ayırır).
       * Kapılar (modül, mod) controller'da — burası çağıranın beyanına güvenir (dahili çağıran vermez).
       */
      kk1Birth?: Kk1BirthInput | null;
      /**
       * K4P-KK1 — doğuşta muayene: yalnız HTTP doğuş yolu verir. Kapı (modül + `inspection:write`) burada
       * `resolveInspectionOnBirth`; yazım topla AYNI tx'te `createInspectionTx` (tek yazar), istasyon `entryStationId`.
       */
      inspection?: (BirthInspectionInput & { permissions: readonly string[]; deviceId?: string | null }) | null;
      /**
       * Elle eklenen topun SEBEBİ — kalıcı kolona (`Roll.entryReason`) yazılır.
       * Zincire dayanan yollar (KK1 / kesim / fason) bunu VERMEZ; onların sebebi
       * belgesidir ve alan NULL kalır. Audit kaydı ayrıca yazılmaya devam eder
       * (bağlamıyla birlikte) — kolon görünen/raporlanan kaynaktır.
       */
      entryReason?: string | null;
      /**
       * Ekleme sebebinin KATALOG KODU (`Roll.entryReasonCode`, 2026-08-21) — rapor
       * anahtarı. Çağıran `resolveReasonCode(ROLL_MANUAL_ENTRY, …)` ile tx DIŞINDA
       * çözer (açık kod doğrulanır, yoksa metinden türetilir); burada TÜRETİLMEZ —
       * bu metot tx açar ve katalog okuması tx'e girmemeli. NULL = serbest metin.
       */
      entryReasonCode?: string | null;
      /**
       * Kaç kat sarıldığı ("2-KAT" | "4-KAT"). MİRAS ALINMAZ: çağıran o an
       * geçerli olan değeri AÇIKÇA verir; verilmezse NULL ("bilinmiyor").
       */
      foldType?: string | null;
      /**
       * GİRİŞ İSTASYONU — topun doğduğu istasyon (Roll.entryStationId).
       *
       * ⚠️ Bu metot içinde TÜRETİLMEZ. `machineId` elde olsa bile ondan
       * `Machine.stationId`e gitmek YANLIŞTIR: makine sonradan taşınırsa
       * geçmiş toplar başka istasyonda doğmuş görünür (kolonun var olma
       * sebebi tam da bu). Ayrıca bu TEK create noktası ÜÇ farklı mantıksal
       * yolu besliyor (KK1 ham giriş / Electron manuel / Tambur manuel) ve
       * üçünün doğru cevabı farklı — sezgi burada sessizce yanlış olur.
       * Çağıran `resolveEntryStationId` ile çözer ve AÇIKÇA verir
       * (`forcedEntrySource` emsali).
       */
      entryStationId?: string | null;
      /**
       * Topun gireceği DEPO (ticaret paketi, 2026-08-13).
       *
       * VERİLMEZSE varsayılan depoya düşer — fabrika akışlarının (KK1 ham giriş,
       * Tambur manuel) hiçbiri bunu göndermez ve davranışları güncelleme
       * öncesiyle bayt-bayt aynı kalır. Yalnız Mal Kabul fişi açıkça verir.
       * Doğrulama (var mı/aktif mi) `resolveTargetWarehouseId`'de.
       */
      warehouseId?: string | null;
      /**
       * Satın alma birim fiyatı (mal kabul yolu) — topun kalıcı alış bedeli.
       *
       * ⚠️ Tip `Prisma.Decimal.Value` (number | string | Decimal), düz `number`
       * DEĞİL: kalem kartından çözülen fiyat (D2 `resolveItemPrice`) bir
       * `Decimal`dır ve `number`a çevirmek Decimal kolonuna JS float sokmak
       * demekti (CLAUDE.md perf/doğruluk kuralı). Prisma `Decimal.Value`u
       * doğrudan kabul eder.
       */
      purchasePrice?: Prisma.Decimal.Value | null;
      /** Topu doğuran mal kabul fişi (yalnız `GoodsReceipt` yolu doldurur). */
      goodsReceiptId?: string | null;
      /**
       * Topu doğuran FASON DOKUMA makbuzu (G2, 2026-09-14) — yalnız
       * `forcedEntrySource: WEAVING` ile ve yalnız `subcontractor-weaving.service`
       * doldurur; top↔dokuma işi bağı buradan türer (`weavingOrderOfRoll`).
       */
      parentReceiptId?: string | null;
      /**
       * G3 EMANET — topun SAHİBİ olan müşteri (doğum niteliği; PATCH yolu yok). KK1 seçicisi ya da fason dokuma
       * makbuzunda leventlerden kalıtım (`resolveOwnerFromBeamsTx`) verir; `emanet.enabled` kapalıyken 403.
       */
      ownerCustomerId?: string | null;
      /**
       * Topun KARŞILADIĞI alış siparişi kalemi (J2, 2026-08-15) — yalnız
       * `GoodsReceipt` yolu doldurur, orada da yalnız fiş bir siparişe bağlıysa.
       *
       * ⚠️ BURADA TÜRETİLMEZ (`entryStationId` / `forcedEntrySource` emsali):
       * kalem seçimi FIFO kapasite defterine bakar ve o defter fiş boyunca
       * yaşar (satırlar ayrı tx'lerde doğuyor) — tek satırlık bu create
       * noktasından görülemez. Çağıran çözer, AÇIKÇA verir.
       *
       * ⚠️ İZ BİLGİLENDİRİCİDİR, KARŞILANMA HESABI DEĞİL: `receivedQty`nin tek
       * kaynağı `purchase-order.service` rollup zinciridir (şema yorumu).
       */
      purchaseOrderLineId?: string | null;
      /**
       * Kartın KULLANIM SINIFI (URUN-YASAM-DONGUSU.md §4). Verilmezse belge bağından
       * türer: doff ya da alış satırı = açık belgeyi tamamlayan giriş (C′), değilse
       * belgesiz yeni stok (C — "Tükenene kadar" kartta kapalı, fail-closed).
       * Mevcut malı yürüten dahili yollar (tambur) `EXISTING_GOODS` verir.
       */
      itemUsage?: Extract<ItemUsage, "NEW_STOCK" | "DOC_COMPLETION" | "EXISTING_GOODS">;
      /**
       * KK1 AĞIRLIK POLİTİKASINDAN MUAFİYET (saha planı A1, 2026-08-15).
       *
       * `kk1.weightEntryEnabled` bir KK1 İSTASYON politikasıdır: o istasyonda
       * kantar yoksa/kapalıysa operatörün elle kg girmesi engellenir. Mal Kabul
       * ise bir DEPO GİRİŞİDİR — perde/tekstil ticaretinde kumaş kg+metre çift
       * birimle alınır ve kg girişi standarttır. Muafiyet verilmeden önce bu
       * bayrak KAPALI kurulumlarda mal kabulün kg'li HER satırı "Ağırlık (kg)
       * girişi bu istasyonda kapalı" ile reddediliyordu (saha vakası: 10 satır).
       *
       * F221 deseni: alan verilmezse politika AYNEN uygulanır (KK1 + tambur
       * yolları davranış değiştirmez); yalnız Mal Kabul yolu bilerek geçer.
       */
      skipKk1WeightPolicy?: boolean;
      /**
       * D4-I1 cari kilidi (INTAKE): sahibin carisi kilitliyse doğum tx'inde 409 `CARI_HOLD`. Yalnız gelen belge onayı
       * verir (yeni iş kabulü); KK1/fason/bölme doğumları davranış değiştirmez.
       */
      cariHoldIntakeGate?: boolean;
      /**
       * `lastLabelSnapshot`'a yazılacak minimal etiket NİYETİ
       * (`{orderLineId}` | `{customerId}` | `{stock:true}`). Çözümü ÇAĞIRAN yapar
       * (`helpers/label-intent.helper`) — burada DB okuması yok.
       */
      labelIntentSnapshot?: Prisma.InputJsonValue;
      /**
       * MÜKERRER TOP TUZAĞI — **yalnız HTTP yolu geçer** (controller doldurur).
       *
       * F221 deseni: alan verilmezse enforcement ATLANIR. Bu bilinçlidir —
       * `createInitialEntry`'nin dahili çağıranları var (`tambur-manual.service`
       * ×2) ve onlar programatik olarak arka arkaya birebir aynı topu
       * üretebilir (eşit parçaya bölme); koşulsuz bir tuzak o akışları kırardı.
       *
       * `confirmed: true` = operatör "evet, bu gerçekten ayrı bir top" dedi →
       * kontrol atlanır. Tuzak ayrıca `kk1.duplicateGuardEnabled` bayrağına
       * bağlıdır (default KAPALI — bkz. system-setting.service).
       */
      duplicateGuard?: { confirmed: boolean };
      /**
       * KALİTE ZORUNLULUĞU (D6, 2026-09-03) — **yalnız HTTP yolu geçer**.
       *
       * F221 deseni (`duplicateGuard` ikizi): alan verilmezse enforcement
       * ATLANIR. Bu bilinçlidir — dahili çağıranlar (`tambur-manual.service`
       * ×2, `goods-receipt.service`, `warehouse-transfer.service`) kaliteyi
       * kendi bağlamlarından çözer ya da bilerek NULL bırakır; koşulsuz bir
       * kural mal kabulü ve elle top eklemeyi de kilitlerdi.
       *
       * Kural ayrıca `quality.gradeRequiredEnabled` bayrağına bağlıdır
       * (default KAPALI). ⚠️ Bayrak açılmadan önce sahadaki tabletler kalite
       * alanı gönderen APK'ya güncellenmiş olmalı: çevrimdışı kuyruktaki
       * kalitesiz kayıtlar flush'ta 400 alır ve `entryAttempt` 400'ü "kesin
       * hata" saydığı için tekrar denemez (kayıt toast bırakıp kaybolur).
       */
      gradeRequired?: boolean;
      /**
       * TX KAPISI (Sınıf 4 — I1, 2026-08-14): top'u yazan transaction'ın İLK
       * ifadesi olarak çağrılır. Mal Kabul yolu buradan fişi
       * `updateMany WHERE status=ACTIVE` ile kilitler (satır doğumu ile fiş
       * iptali AYNI satır kilidinde serileşir); kapı throw ederse tx geri
       * sarılır — top hiç doğmaz, barkod sayacı da artmaz (kilit barkod
       * üretiminden ÖNCE olduğu için boşluk oluşmaz).
       *
       * F221 deseni: verilmezse TEK ifade bile eklenmez — KK1 ham giriş /
       * Tambur manuel yolları bayt-bayt aynı kalır. Kilit sırası notu: kapı
       * (goods_receipts satır kilidi) mükerrer tuzağının advisory kilidinden
       * (8021) ÖNCE koşar; iki kilidi birden alan başka yazar yok (KK1
       * fiş satırına, `cancel` 8021'e hiç dokunmaz) → ABBA imkânsız. Mal Kabul
       * yolu `duplicateGuard` da geçirmediği için bugün ikisi aynı tx'te
       * zaten buluşmuyor.
       */
      txGate?: (tx: Prisma.TransactionClient) => Promise<void>;
    },
  ): Promise<InitialEntryResult> {
    return createInitialEntryFreshImpl(data, userId, machineId, isMobileOrigin, opts);
  }

  /**
   * Roll listesi + istatistiklerin paylaştığı tek filtre kaynağı.
   * findAllRolls (liste) ve getRollStats (özet) bu metodu çağırır —
   * filtre eşleşmediğinde istatistik listeden sapar.
   *
   * `fireCodes` DIŞARIDAN geçilir (metot SENKRON kalır): kova sorusu katalogdan
   * çözülür ama `getRollStatsBatch` bu metodu N kez çağırır — içeride
   * yükleseydik istek başına N katalog sorgusu olurdu. Üç çağıran da kümeyi bir
   * kez çözüp aynı değeri geçer, "tek where" kuralı korunur.
   */
  private buildRollWhere(
    params: QueryParams,
    fireCodes: readonly string[],
    // Aramanın müşteri koduyla eşleştiği toplar (D4-F1b; `customerCodeSearchRollIds`, async → dışarıda çözülür).
    customerCodeRollIds: readonly string[] = [],
  ): Record<string, unknown> {
    return buildRollWhereImpl(params, fireCodes, customerCodeRollIds);
  }

  /**
   * List rolls with dynamic filtering, sorting, pagination.
   * Business Rule: By default only STOCK rolls are returned.
   * Other statuses must be explicitly requested via filter[status].
   *
   * İki mod (geri uyumlu):
   *   - Offset: ?page=1&pageSize=50 — eski sayfalama, küçük tablo gibi.
   *   - Cursor: ?mode=cursor&limit=50 — büyük tablo (30k+) için sabit hız.
   */
  async findAllRolls(
    req: Request
  ): Promise<PaginatedResponse<Roll> | CursorPaginatedResponse<Roll>> {
    return findAllRollsImpl.call(this as unknown as InventoryServiceThis, req);
  }

  /**
   * ÜRETİM AKIŞI (Kanban) panosu — Envanter ekranındaki salt-okunur pano. TEK
   * HTTP isteğiyle 6 kolon: her kolon en fazla 10 önizleme kaydı + gerçek toplam
   * sayaç. Eskiden frontend 6 AYRI istek atıyordu; kuyruk kolonları (Kurşun/Tambur)
   * ~500 satırı nested payload'la çekip 12'ye kırpıyor, Sevk'in gerçek toplamı hiç
   * yoktu. Tek uç + kolon başına `take:10 + count()` ile hem round-trip hem payload
   * küçüldü, tüm kolonlar doğru toplam gösterir.
   *
   * Sıra kolon-doğal: rulo kolonları createdAt DESC (en güncel), Kurşun öncelik
   * kuyruğu (kursun-qc.listQueue ile aynı), Tambur updatedAt DESC, Sevk board sırası
   * (createdAt ASC). Sayaç/preview sorguları tx-DIŞI `prisma.*` → Promise.all serbest
   * (pool max 30; kural yalnız tx.* için).
   *
   * RBAC: uç `roll:read` ile korunur (Envanter sayfasının izni). Kolon-bazlı ince
   * yetki controller'da hesaplanır — `quality:read` yoksa Kurşun/Tambur, `shipping:read`
   * yoksa Sevk boş (total 0) döner (eski davranışın 403-toast gürültüsü olmadan hâli).
   */
  async getProductionFlow(opts: {
    includeQueues: boolean;
    includeSevk: boolean;
  }): Promise<ApiResponse<ProductionFlowData>> {
    return getProductionFlowImpl(opts);
  }

  /**
   * Roll özet istatistikleri — listenin SAYFAYA bağlı toplamlarını değil,
   * filtreye uyan TÜM rolların aggregate'ini döner. Depo/dashboard kartlarının
   * "Toplam metre / Toplam kg / Statü dağılımı / Kalite dağılımı" gibi
   * panelleri için. Filtre seti findAllRolls ile aynı (buildRollWhere paylaşılır).
   */
  /**
   * GİRİŞ FİLTRESİ LOOKUP'LARI (2026-08-12) — "Ekleyen" / "Giriş İstasyonu"
   * filtre seçenekleri. Kullanıcı/istasyon kataloğunun TAMAMI değil, gerçekten
   * top girmiş olanlar döner: (a) "Ekleyen" seçeneği için `admin:users` iznine
   * gerek kalmaz (o uç kullanıcı YÖNETİMİdir; buradaki ad zaten roll:read'in
   * gördüğü satırlarda basılıyor — yeni bilgi sızmaz), (b) hiç giriş yapmamış
   * hesap/istasyon listeyi şişirmez. Kaynak sorgu indeksli tekil kolonlardır
   * (`@@index([createdById])` / `@@index([entryStationId])`) — 300k satırda da
   * index-only scan.
   */
  async listEntryUsers(): Promise<ApiResponse<{ id: string; name: string; code: string | null }[]>> {
    return listEntryUsersImpl();
  }

  async listEntryStations(): Promise<ApiResponse<{ id: string; name: string; code: string | null }[]>> {
    return listEntryStationsImpl();
  }

  async getRollStats(req: Request): Promise<ApiResponse<RollStats>> {
    return getRollStatsImpl.call(this as unknown as InventoryServiceThis, req);
  }

  /**
   * Envanter özeti — N kategori filtresinin her biri için TEK istekte count + metre.
   * Frontend her kategoriyi kendi filtresiyle (buildRollForceFilters) gönderir; 8 ayrı
   * HTTP + 8 auth/parse yerine tek çağrı, içeride Promise.all ile paralel aggregate
   * (getWarehouseScope ile aynı desen). Kategori tanımı tek yerde (frontend) kalır;
   * backend generic sayım motoru. buildRollWhere liste/özet ile aynı → sapma olmaz.
   */
  async getRollStatsBatch(
    items: Array<{ key: string; filters?: Record<string, unknown> }>,
  ): Promise<ApiResponse<Array<{ key: string; totalCount: number; totalQty: number }>>> {
    return getRollStatsBatchImpl.call(this as unknown as InventoryServiceThis, items);
  }

  /**
   * Depo kapsam sayaçları — WAREHOUSE topları fiziksel yere göre ayır (ÇUVAL DEPO MODELİ):
   *  - serbest:    shipmentId null + sackId null (satılabilir/okutulabilir gerçek serbest stok)
   *  - çuval depo: shipmentId null + sackId dolu (çuvala konmuş, sevk edilmemiş)
   *  - planlı:     shipment.status PLANNED (onay bekleyen sevkiyata atandı, henüz sevk edilmedi)
   * Hepsi hâlâ binada (WAREHOUSE) ama yalnız "serbest" satılabilir stoktur. SHIPPED hariç.
   * `filter[mulkiyet]` (T3, tablet Depo şeridi) listeyle aynı helper'dan AND'lenir; boş = bugünkü sayılar.
   */
  async getWarehouseScope(rawOwnership?: unknown): Promise<
    ApiResponse<{
      free: { count: number; qty: number };
      pool: { count: number; qty: number };
      planned: { count: number; qty: number };
    }>
  > {
    return getWarehouseScopeImpl(rawOwnership);
  }

  /**
   * Fasonda özet şeridi — AT_SUBCONTRACTOR topların firma + işlem (kategori)
   * bazlı dağılımı, TEK istekte iki dizi + toplam. Açık-kalem tanımı F85 ile
   * birebir (reports/subcontract getOpenDispatches): iptalsiz + doğrudan-sevksiz
   * sevkin, aktif (iptalsiz) receipt-item'ı OLMAYAN kalemi. base ROLL-driven
   * (1 satır/top) + DISTINCT ON en güncel açık kalemi seçer → fason→fason
   * transferde/anomalide çift sayım İMKANSIZ; açık kalemi bulunamayan top null
   * gruba düşer ("Bilinmiyor"). Evren varsayılan FIRE-hariç (liste default'uyla
   * hizalı: qualityGrade IS NULL OR <> 'FIRE'); includeFire=true iken FIRE toplar
   * da dahil → "Fire kaliteyi de göster" toggle'ı açıkken şerit sayıları tablo/
   * Top-Metre ile birebir tutar. LIMIT bilinçli YOK: grup sayısı master tablo
   * kardinalitesiyle sınırlı, sevk hacmiyle büyümez.
   */
  async getRollSubcontractorSummary(
    includeFire = false,
  ): Promise<ApiResponse<RollSubcontractorSummary>> {
    return getRollSubcontractorSummaryImpl(includeFire);
  }

  /**
   * Get a single roll by ID with all relations.
   */
  /**
   * ELLE EKLENEN TOPUN SEBEBİ — YALNIZ kolondan (`Roll.entryReason`, migration
   * `20260804210000`). Audit OKUNMAZ: yalnız ayak izidir ve 6 ayda arşivlenir
   * (test_audit_okuma_kaynagi). Kolondan önce doğmuş toplar yayın günü
   * `scripts/backfill_roll_fold_and_reason.ts` ile bir kez doldurulur.
   *
   * Yalnız elle doğan iki kaynakta sorgulanır — diğer toplarda ek sorgu KOŞMAZ.
   */
  private async readManualEntryReason(
    rollId: string,
    entrySource: RollEntrySource,
  ): Promise<string | null> {
    return readManualEntryReasonImpl(rollId, entrySource);
  }

  async findRollById(id: string): Promise<ApiResponse<Roll | null>> {
    return findRollByIdImpl.call(this as unknown as InventoryServiceThis, id);
  }

  /**
   * İPTAL TEŞHİSİ — "bu barkod neden kabul edilmedi, ne yapmalıyım".
   *
   * Okutma yüzeyleri eskiden yalnız `status`'ü görüyordu ve ekranda "stokta değil
   * (İptal)" yazıp SUSUYORDU. Operatörün elinde fiziksel bir top, önünde akan bir
   * vardiya varken bu sessizlik doğaçlamaya davettir — 2026-08-05'te tam olarak
   * öyle oldu (kayıt öldü, mal gitmek zorundaydı, ikinci bir barkod basıldı).
   *
   * ⚠️ Yalnız `CANCELLED` topta koşar. Beş sayım sorgusu barkod okutmanın SICAK
   * yolunda; her okutmada koşturmak o yolu bedelsiz yere yavaşlatırdı ve iptal
   * edilmiş top okutma vakalarının çok küçük bir azınlığıdır.
   */

  private async buildCancelDiagnostics(
    roll: { id: string; status: RollStatus; preCancelStatus: RollStatus | null; batchId: string | null; sackId: string | null; shipmentId: string | null; currentStepId: string | null; cancelReasonCode: string | null },
  ): Promise<{ canRestore: boolean; restoreBlockReason: string | null } | null> {
    return buildCancelDiagnosticsImpl(roll);
  }

  /**
   * Get a roll by its barcode.
   */
  async findRollByBarcode(barcode: string): Promise<ApiResponse<Roll | null>> {
    return findRollByBarcodeImpl.call(this as unknown as InventoryServiceThis, barcode);
  }

  /**
   * Yeniden-Etiketleme istasyonu için zengin bağlam — barkod okutunca topun tüm
   * spec'i (renk/kalite/en/özellik), konumu/guard'ı (sevkiyat/çuval), son basıldığı
   * yer (`lastLabelSnapshot` = "A") ve "B" müşteri adayları (topu üreten WO'nun
   * bağlı siparişlerinden) döner. Salt-okunur — relabel'in kendisi mevcut
   * `applyManualProperties` (spec) + label.service (bas) uçlarıyla yapılır.
   *
   * `findRollByBarcode`'tan AYRI tutulur: o lean lookup (depo/Tambur okutması, hot
   * path); bu method üretim-zinciri include'larını yalnız relabel istasyonu için taşır.
   */
  /**
   * Barkod VEYA rollId ile çözülür. rollId yolu şart: barkodsuz açık kumaş
   * (fason dönüşü / istasyonda bekleyen top) barkodla bulunamaz ama tek "Düzelt"
   * diyaloğu onu da açmak zorunda (eski ManualAttributesDialog'un tek üstünlüğü buydu).
   */
  async getRelabelContext(
    ref: { barcode: string } | { rollId: string },
  ): Promise<ApiResponse<RelabelContext | null>> {
    return getRelabelContextImpl(ref);
  }

  /**
   * Get a roll's full lifecycle history — station movements, discrete operations,
   * subcontractor dispatches/receipts — merged into one chronological timeline.
   */
  async getRollHistory(id: string): Promise<ApiResponse<RollHistoryPayload | null>> {
    return getRollHistoryImpl.call(this as unknown as InventoryServiceThis, id);
  }

  /**
   * Soft-delete (Operatör İptali / Yanlış Giriş): topu CANCELLED'a çeker.
   * Bu fire (SCRAP) DEĞİL — sadece operatör kaydı geri alıyor. Gerçek fire
   * (kalite reddi vb.) için Tambur akışı SCRAP set eder.
   *
   * **İzin verilen statüler:** STOCK, IN_PRODUCTION,
   * A1_STOCK, WAREHOUSE, RETURNED_FROM_SUBCONTRACTOR.
   *
   * **Blok:**
   * - SCRAP / CANCELLED — zaten kapalı (idempotent başarı döner)
   * - AT_SUBCONTRACTOR — fasonda; önce mal kabul yapılmalı
   * - Açık bir SubcontractorDispatch'e bağlı top
   *
   * Yan etkiler:
   * - Açık RollMovement'lar kapatılır (qtyOut=0, not "CANCELLED")
   * - currentStepId temizlenir
   * - Etkilenen step'lerin status'u recompute edilir
   */
  /**
   * Top iptal önizlemesi (GET /rolls/:id/cancel-preview). Salt-okunur.
   * Operatör KK1'de "Sil"e basınca çağrılır → modalda somut etki gösterilir.
   * Sıcak liste yoluna (rolls listesi) DOKUNMAZ — yalnız bu talep-anında
   * endpoint join taşır, böylece liste sorgusu hafif kalır.
   */
  async getCancelPreview(id: string): Promise<ApiResponse<RollCancelPreview>> {
    return getCancelPreviewImpl(id);
  }

  async softDelete(
    id: string,
    userId?: string,
    opts?: {
      confirmActive?: boolean;
      /**
       * Etiketi basılmış topu iptal etmek için BİLİNÇLİ onay. Olmadan 409
       * `LABEL_PRINTED` — bkz. aşağıdaki guard'ın gerekçesi.
       */
      confirmLabelPrinted?: boolean;
      /**
       * İptal gerekçesi — OPSİYONEL (2026-08-06 kullanıcı kararı; öncesinde
       * etiketli topta zorunluydu). Verilmezse `cancelReason` NULL kalır ve
       * yüzeyler bunu "Seçilmedi" diye gösterir. 3 karakterden kısa değer
       * saklanmaz: "a"/"." gibi doldurma, boş bırakmaktan kötüdür (denetimde
       * cevap varmış gibi görünür, hiçbir şey söylemez).
       */
      reason?: string;
      /**
       * Sebebin KATALOG KODU (`ReasonPreset.code`, kind ROLL_CANCEL) — OPSİYONEL.
       * Verilirse katalogda doğrulanır (bilinmeyen → 400 `REASON_CODE_INVALID`);
       * verilmezse sunucu `reason` metnini kataloğun label/fullText'iyle eşleyip
       * kodu kendisi türetir (mobil bugün yalnız metin gönderiyor). Serbest metin → NULL.
       */
      reasonCode?: string;
      /**
       * STOKTAN ÇIKARMANIN İKİ ANLAMI (2026-08-25 kullanıcı kararı):
       *   • `CANCEL` (varsayılan) — "bu kayıt hiç olmamalıydı": yanlış/mükerrer
       *     giriş, yanlış metraj. Mal FİZİKSEL OLARAK YOKTU → stok düşmez
       *     (hiç girmemişti), hareket kapanışı storno (`qtyOut = 0`), fire
       *     raporuna GİRMEZ.
       *   • `SCRAP` — "mal vardı, artık yok": yandı, kirlendi, numune gitti.
       *     Stok gerçekten düşer, hareket kapanışı `qtyOut = qtyIn` (istasyon iş
       *     hacmi korunur — mal oradan geçti), fire raporuna GİRER.
       *
       * ⚠️ İKİSİNİ BİRLEŞTİRME. Sahada ölçüldü (2026-08-25): 230 iptale karşı
       * 1 fire, ve sebep yazılmış 24 iptalin HEPSİ kayıt hatası. Veri düzeltmesini
       * fireye yazmak fabrikanın fire oranını doğrudan yalanlar.
       */
      mode?: "CANCEL" | "SCRAP";
    },
  ): Promise<ApiResponse<Roll>> {
    return softDeleteImpl(id, userId, opts);
  }

  /**
   * Bir topun iptalini GERİ AL — `CANCELLED` → iptalden önceki raf.
   *
   * NEDEN VAR: iptalin geri dönüşü olmadığı sürece tek çare "yeniden giriş"tir ve
   * yeniden giriş aynı fiziksel top için İKİNCİ bir barkod doğurur. 2026-08-05
   * sahasında tam bu oldu — T050826H0033 iptal edildi, mal kapıdaydı, operatör
   * doğaçlama yaptı, top T050826H0072 olarak gitti ve üstünde iki etiket kaldı.
   * Buradaki tek amaç o ikinci barkodun HİÇ doğmaması.
   *
   * Kapsam ve gerekçeleri `helpers/roll-cancel-restore.helper` içinde (saf yüklem,
   * ekran ve uç aynı fonksiyonu çağırır). İzin `softDelete` ile AYNI kümedir:
   * iptali yapan kişi geri de alabilmeli, yoksa hata yapan operatör vardiya
   * ortasında birini beklemek zorunda kalır — ve beklemez, doğaçlar (elle eklenen
   * topun geri alınmasında verilen kararın aynısı).
   *
   * ⚠️ `hardDelete` ("Arşivle") ile karışabilir: o da topu `CANCELLED` yapar ama
   * `preCancelStatus` yazmaz → burada `STOCK`'a düşer. Kabul edilebilir: arşivleme
   * zaten yalnız `STOCK` topa uygulanıyor.
   *
   * ⚠️⚠️ ADIM DURUMU BURADA YENİDEN HESAPLANMAZ — ve bu bir EKSİK DEĞİL, kapsam
   * guard'ının sonucudur (2026-08-15 denetimi). `resolveRollRestoreBlockReason`
   * `movementCount > 0` (geri alınmamış AÇIK + KAPALI tüm hareketler) olan topu reddediyor;
   * hareketi olmayan top ise `recomputeStepStatus`'un hiçbir sayacına girmez
   * (üç sayacın üçü de "bu iş emrinde hareketi olan top" üzerinden çalışır) →
   * geri alınabilen bir topun geri alınması hiçbir adımın türetilen değerini
   * değiştiremez. Yani `softDelete`/`hardDelete`'teki boşluğun ikizi burada YOK.
   *
   * ⚠️ KIRILGAN: guard gevşetilirse ("süpervizör hareketli topu da geri alsın")
   * aynı boşluk SIFIR kodla açılır — bu fonksiyonda ne recompute çağrısı vardır
   * ne de transaction. O gün yapılacak iş: gövdeyi `prisma.$transaction`'a al,
   * `collectRollStepScopeTx(tx, [id], [existing.currentStepId])` ile kapsamı çöz,
   * `touchWorkOrderTx` + `recomputeStepStatus` uygula (aynı sıra: claim SONRASI).
   * Aynı uyarı `helpers/roll-cancel-restore.helper.ts` başında da duruyor.
   */
  async restoreCancelledRoll(
    id: string,
    userId?: string,
    opts?: { reason?: string },
  ): Promise<ApiResponse<Roll>> {
    return restoreCancelledRollImpl(id, userId, opts);
  }

  /**
   * Arşivle: STOCK durumundaki bir topu CANCELLED'a çeker. RollError ve
   * RollMovement / RollOperation kayıtları KORUNUR — izlenebilirlik ve
   * audit için. Zaten SCRAP veya CANCELLED ise idempotent (no-op).
   *
   * NOT: Eski "hardDelete" davranışı (fiziksel DELETE + RollError purge)
   * kaldırıldı — CLAUDE.md'deki "asla fiziksel DELETE" kuralı gereği.
   * Method adı route uyumluluğu için korundu; semantik = soft archive.
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<Roll>> {
    return hardDeleteImpl(id, userId);
  }

  /**
   * Manuel renk + özellik override — operatör fason kabul sonrası bir rulonun
   * rengini/özelliklerini elle düzeltebilir. Senaryolar:
   *   - Boyahane mavi vermesi gereken 10 ruloda 2'si yanmazlık tutmamış →
   *     o 2 ruloya yanmazlık atanmaz (manuel kaldır).
   *   - Bir rulo bonus olarak ekstra özellik kazandı → operatör manuel ekler.
   *
   * Replace semantics: gönderilen colorId + propertyIds yeni TAM listedir.
   * Item DEĞİŞMEZ (artık ürün kimliği renk içermiyor).
   */
  async applyManualProperties(
    rollId: string,
    data: {
      colorId: string | null;
      /**
       * BAYRAK (FLAG) kümesi — `undefined` DOKUNMA, dizi = TAM liste (replace).
       * Faz 0 (OZELLIK-PIVOT-SURUMLEME-PLAN §9, 2026-09-14): alanı yollamayan
       * istemci (tablet Çuval Düzelt yalnız renk/en yollar) eskiden `?? []` ile
       * "hiç özellik" demiş sayılıyor ve her düzeltme topun BÜTÜN bayraklarını
       * siliyordu. `undefined` iken özellik bloğu ve `propsChanged` hiç koşmaz.
       */
      propertyIds?: string[];
      width?: number | null;
      qualityGrade?: string;
      currentQty?: number;
      /**
       * KAT — `undefined` DOKUNMA, `null` TEMİZLE, kod YAZ (foldTypeSchema sözleşmesi).
       *
       * Kat bir SEÇİM (CHOICE) karakteristiğidir ama `RollProperty` pivotunda değil
       * `Roll.foldType` KOLONUNDA yaşar (filtrelenip sıralandığı için) — bu yüzden
       * yukarıdaki "CHOICE satırları bu uçtan yönetilmez" kuralının DIŞINDADIR ve
       * panelden düzeltilebilir. Kesim sırasında istemci alanı düşürdüğü için
       * (2026-08-13) katsız doğmuş topların tek düzeltme yolu burasıdır.
       */
      foldType?: string | null;
      /** Etiket parti no — `undefined` DOKUNMA, null/"" TEMİZLE, metin YAZ (kırpılır). */
      labelBatchNo?: string | null;
      reason?: string;
    },
    userId?: string,
    /** F221 deseni: sağlanırsa süpervizör kapsamı için `roll:manual-adjust` ENFORCE
     *  edilir. Controller `req.user.permissions`'ı HER ZAMAN geçirir; omit =
     *  güvenilen dahili çağrı (test/servis-içi) → kontrol atlanır. */
    opts?: { permissions?: readonly string[] },
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return applyManualPropertiesImpl(rollId, data, userId, opts);
  }

  /** Etiket ad/renk/parti no düzeltmesi (sevk edilene kadar) — `PATCH /api/rolls/:id/label-texts`. */
  async fixLabelTexts(rollId: string, data: LabelTextsFixInput, userId?: string): Promise<ApiResponse<LabelTextsFixResult>> {
    return fixRollLabelTextsImpl(rollId, data, userId);
  }

  /**
   * G4 (2026-08-14, ticaret paketi) — SAYIM METRAJ DÜZELTMESİ.
   * `PATCH /api/rolls/:id/qty` · izin `roll:manual-adjust` · sebep ZORUNLU (min 3).
   *
   * `applyManualProperties`'in metraj dalıyla KARIŞTIRMA — iki ayrı iş:
   *   • Orası ÖLÇÜM düzeltmesidir: yalnız BÜTÜN topta (initialQty == currentQty)
   *     çalışır ve initialQty'yi de yeniden yazar ("giriş ölçümü baştan yanlıştı").
   *   • Burası SAYIM gerçeğidir: kayıtlı 500 m'lik top rafta 480 m çıktı. YALNIZ
   *     `currentQty` değişir — `initialQty` tarihsel giriş kaydıdır, DOKUNULMAZ;
   *     fark zaten `initialQty - currentQty` olarak okunur (detay panelindeki
   *     "Başlangıç: N m" satırı). Kısmen tüketilmiş topta da çalışır.
   *
   * KAPSAM DAR — yalnız FREE_STOCK (STOCK/WAREHOUSE/A1_STOCK) + çuvalsız/sevksiz/
   * adımsız; gerisi ANLAMLI 409: üretimdeki topun metrajını istasyon akışı
   * (kurşun/tambur ölçümü) belirler, sevk edilmişin kaydına dokunulmaz (brüt
   * kuralı), fasondaki mal fiziksel olarak dışarıda, arşiv statüde canlı stok yok.
   *
   * İZ — RollVariance sapma defterine satır (yön → tür). Yeni `RollVarianceKind`
   * değeri EKLENMEDİ (enum değişikliği = migration; bu iş migration'sız) — iki
   * mevcut tür zaten tam bu iki soruyu yanıtlıyor:
   *   • sayım DÜŞÜK  → `RECORD_CORRECTION` ("mal hiç yoktu / kayıt yanlıştı").
   *     FIRE DEĞİL: fire "mal vardı, çöpe gitti" kararıdır ve Tambur/WO-kapanış
   *     dispozisyonunun işidir; sayım farkını SCRAP'a yazmak fire oranını
   *     sistematik şişirirdi (RollVarianceKind şema notu).
   *   • sayım YÜKSEK → `OVERAGE` ("kayıtlıdan fazla çıktı") — tambur aşımının
   *     depo ikizi.
   *
   * Stok defterine (`WarehouseMovement`) ADJUST satırı da yazılır (hüküm 2026-09-13):
   * defter 2026-09-13'ten beri MİKTAR defteridir (Σ = durum) ve elle düzeltme
   * miktarı yerinde değiştiren tek kapısız yoldu — sapma satırı `rollVarianceId`
   * ile bağlanır (aynı kararın iki defteri). Geri alma yok: ters yönde ikinci
   * düzeltme yeni olgudur (`KARSI_OLAY = MANUAL_ADJUST`).
   */
  async adjustRollQty(
    rollId: string,
    data: { newQty: number; reason: string },
    userId?: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return adjustRollQtyImpl(rollId, data, userId);
  }

  /**
   * Saha #10: ham/stok kumaşı doğrudan satışa hazırla — STOCK topu WAREHOUSE'a
   * geçirir (sevke hazır). Fabrika işlemeden gelen ham kumaş bu yolla sevk akışına
   * girer (kapsama renk-null spec eşleşmesiyle çalışır). Guard: top serbest olmalı
   * — bir WO adımında/sevkiyatta/fasonda DEĞİL. Sadece STOCK → WAREHOUSE.
   */
  async prepareRawForSale(rollId: string, userId?: string): Promise<ApiResponse<Record<string, unknown>>> {
    return prepareRawForSaleImpl(rollId, userId);
  }

  // ===========================================================================
  // OPEN FABRIC — Kurşun/KK2'de açık kumaş Roll oluştur
  // ===========================================================================
  //
  // Senaryo: Boyahaneden açık kumaş döndü; SubcontractorReceipt oluşturuldu;
  // orijinal Roll'lar SUBCONTRACTOR_CONSUMED'a çekildi. Şimdi Kurşun/KK2
  // operatörü "yeni kumaş aç" der → bu endpoint çağrılır.
  //
  // Yeni Roll:
  //   - barcode: NULL (etiket basılmaz, fiziksel takip arabada)
  //   - colorId / properties: receipt'ten inherit
  //   - itemId: WO.targetItemId
  //   - currentStepId / producedInStepId: Kurşun/KK2 step (PROCESS_QC)
  //   - parentReceiptId: kaynak receipt referansı (lineage)
  //   - initialQty / currentQty: 0 (ölçüm kursun-finish'te yapılır)
  //
  /** Açık kumaş — token replay'i tek boğazdan (R + K′ iş emri satır kilidinin arkasında). Gövde `createOpenFabricFresh`. */
  async createOpenFabric(...args: Parameters<InventoryService["createOpenFabricFresh"]>): Promise<ApiResponse<Roll>> {
    return createOpenFabricImpl.call(this as unknown as InventoryServiceThis, ...args);
  }

  /**
   * Açık kumaş replay'i. Kimlik: makbuz · DOĞUŞ adımı (`producedInStepId`; `currentStepId` top ilerleyince değişir ve
   * meşru tekrarı sahte 409'a düşürürdü). 4. durum: iptal/fire → `ENTRY_CANCELLED`.
   */
  private openFabricReplay(data: { receiptId: string; stepId: string }) {
    return openFabricReplayImpl(data);
  }

  private async createOpenFabricFresh(
    data: {
      receiptId: string;
      stepId: string; // Kurşun/KK2 (PROCESS_QC) step
      notes?: string | null;
      /** İdempotency anahtarı — çift çağrı (retry) ikinci hayalet açık-kumaş
       *  doğurmasın (Roll.clientToken @unique; createInitialEntry emsali). */
      clientToken?: string | null;
    },
    userId?: string,
  ): Promise<ApiResponse<Roll>> {
    return createOpenFabricFreshImpl.call(this as unknown as InventoryServiceThis, data, userId);
  }

  // ===========================================================================
  // KURTARMA — İstasyonda takılı (IN_PRODUCTION) topu depoya al ("İstasyondan Kurtar")
  // ===========================================================================
  //
  // Senaryo: Bir top makinede/istasyonda IN_PRODUCTION olarak takılı kaldı
  // (operatör bitiremedi, süreç yarıda kesildi). Süpervizör topu istasyondan
  // kurtarır: açık hareketler FİZİKSEL çıkışla kapatılır (top metresiyle çıktı —
  // softDelete'in "hiç olmadı" semantiği DEĞİL), top WAREHOUSE'a alınır ve
  // barkodsuzsa "her kumaşa etiket" (F4) gereği final barkod üretilir.

  /**
   * İstasyonda takılı (IN_PRODUCTION) top için kurtarma önizlemesi — salt-okunur.
   * eligible yalnız IN_PRODUCTION topta true; açık fason sevki engel olarak raporlanır.
   */
  async getRescuePreview(rollId: string): Promise<ApiResponse<RescuePreview>> {
    return getRescuePreviewImpl(rollId);
  }

  /**
   * İstasyonda takılı (IN_PRODUCTION) topu kurtarır → WAREHOUSE. Açık hareketler
   * fiziksel çıkışla kapatılır (qtyOut/weightOut = topun mevcut ölçüsü; top
   * metresiyle istasyondan ayrıldı — softDelete "hiç olmadı" DEĞİL). Barkodsuzsa
   * final barkod üretilir (F4).
   *
   * Recompute semantiği: kapanan movement "geçti" sayılır → adım/WO oto-COMPLETE
   * olabilir; dokunulmamış PENDING adımlar WO'yu bloklar (operatör WO'yu ayrıca iptal eder).
   */
  async rescueStuckRoll(
    rollId: string,
    data: { reason: string },
    userId?: string,
  ): Promise<ApiResponse<Roll>> {
    return rescueStuckRollImpl(rollId, data, userId);
  }

  // ===========================================================================
  // KURSUN-FINISH — Kurşun/KK2 sonu: metraj + hata + Tambur'a ilerlet
  // ===========================================================================
  //
  // Açık kumaş Roll'unun ölçümü tamamlanır:
  //   - currentQty / initialQty = totalMeters (cihazda gözüken)
  //   - RollError'lar toplu insert (sadece startMeter zorunlu)
  //   - RollOperation: QC2_COMPLETED her zaman, KURSUN_APPLIED istasyonun
  //     KURSUN yeteneği varsa
  //   - İstasyonun propertyCapabilities listesi Roll'a RollProperty olarak kopyalanır
  //   - Kurşun/KK2 movement'ı kapatılır (qtyOut=totalMeters, exitedAt=now)
  //   - Sonraki step (Tambur) için RollMovement açılır + Roll.currentStepId güncellenir
  //
  async kursunFinish(
    rollId: string,
    data: {
      /**
       * Opsiyonel. Yeni model: açık kumaş Roll fason kabulden zaten metrajlı
       * doğar (irsaliye değeri). KK2'de ölçüm yapılmadığı için `totalMeters`
       * verilmezse mevcut `currentQty` kullanılır. Boya'da fire/çekme varsa
       * operatör bunu manuel girebilir.
       */
      totalMeters?: number;
      /**
       * Opsiyonel batch hata kaydı. Yeni akışta operatör hataları KK2 ekranında
       * "Hata Ekle" ile tek tek girer (reportError endpoint'i); burası genelde
       * boş gönderilir. Verilirse RollError olarak eklenir.
       */
      errors?: Array<{
        startMeter: number;
        defectTypeId?: string | null;
      }>;
      notes?: string | null;
      /**
       * Operatörün cevapları (2026-08-10 mod + 2026-08-11 değer sözleşmesi).
       * AUTO satırlar gönderilmese de yazılır; eski APK bu alanı hiç göndermez
       * → yalnız AUTO uygulanır (bugünkü sonuç). SEÇİM tipli özellikte
       * `valueCode` ZORUNLUDUR.
       *
       * Sözleşme `kursun-qc.completeQc2` ile BİREBİR — iki tablet yolu aynı
       * özelliği farklı kurallarla uygularsa aynı top iki yoldan iki farklı
       * özellik kümesi kazanır.
       */
      properties?: PropertySelection[] | null;
      /** D4-E2a ölçülen en (cm) — completeQc2 ile BİREBİR; yalnız `Station.capturesWidth` istasyonunda. */
      measuredWidthCm?: number | null;
    },
    userId?: string,
    /** PROCESS_QC makine atfı — aktif çalışma oturumundan (controller çözer).
     *  QC2/KURSUN op'larına + kapanan movement'a damgalanır. */
    machineId?: string | null,
  ): Promise<ApiResponse<{ rollId: string; totalMeters: number; nextStepId: string | null }>> {
    return kursunFinishImpl(rollId, data, userId, machineId);
  }
}
