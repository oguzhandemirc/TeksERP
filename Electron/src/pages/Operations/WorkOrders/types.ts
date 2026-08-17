import type {
  RollStatus,
  StepStatus,
  WorkOrderStatus,
  WorkOrderType,
} from "@/types/enums";
import type { TravelerCardConfig } from "@/services/featureFlagService";

/** findById response'unda her adım için anlık rulo özeti. List view'de boş gelir. */
export interface StepRollSummary {
  count: number;
  totalMeters: number;
  rawCount: number;
  rawMeters: number;
  dyedCount: number;
  dyedMeters: number;
  openFabricCount: number;
  openFabricMeters: number;
  /** Bu adımda fiziksel BEKLEYEN (sevke hazır) top sayısı/metrajı — fason aksiyonu
   *  gating'i: > 0 ise "{istasyon}'a Sevk Et". EXTERNAL adımda AT_SUBCONTRACTOR
   *  toplar da currentStepId taşıdığı için `count`'tan ayrılır. */
  waitingCount: number;
  waitingMeters: number;
  /** Bu adımda FASONDA (dışarıda) top sayısı/metrajı — > 0 ve sonraki adım fason
   *  ise "Sonraki Fasona Aktar" aksiyonu açılır. */
  atSubcontractorCount: number;
  atSubcontractorMeters: number;
}

/** findById response'unda step başına bekleyen rulolar listesi (detay paneli için). */
export interface StepRollItem {
  id: string;
  barcode: string | null;
  /** Anlık durum — AT_SUBCONTRACTOR (fasonda) vs bekliyor ayrımı (seçim modalı). */
  status: RollStatus;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  kind: "raw" | "dyed" | "open";
  item: { id: string; code: string; name: string } | null;
  color: { id: string; code: string; name: string; hex: string | null } | null;
  /** Hangi partiye üye — "hangi top hangi partide" sorusu için. */
  batchNumber: string | null;
}

/** Bir fason sevkinde BİRLİKTE giden tek bir top (sevk kalemi). */
export interface StepDispatchRoll {
  id: string;
  barcode: string | null;
  dispatchedQty: number;
  item: { name: string } | null;
  color: { name: string; hex: string | null } | null;
}

/** findById response'unda step başına aktif fason sevkler (plaka / sürücü / not). */
export interface StepDispatch {
  id: string;
  dispatchNo: string;
  dispatchedAt: string;
  totalQty: number;
  plateNumber: string | null;
  driverName: string | null;
  notes: string | null;
  /** Fason talimatı — sevkin kendi notu (override); boşsa adım notuna düşülür. */
  instruction: string | null;
  /** Sevkin adımının notu (default) — sevkin kendi talimatı boşsa buna düşülür. */
  stepNote: string | null;
  subcontractor: { id: string; name: string };
  dispatchedBy: { id: string; fullName: string | null; username: string } | null;
  /** Bir sevk = bir parti (K10) — bu sevkte hangi partinin topları gitti. */
  batchNumber: string | null;
  /** Bu sevkte BİRLİKTE giden toplar — "hangi toplar birlikte o fasona gitti". */
  rolls: StepDispatchRoll[];
}

export interface WorkOrderStepLite {
  id: string;
  stepSequence: number;
  status: StepStatus;
  station?: { id: string; code: string; name: string; type?: string; kind?: string };
  /** findById include eder; list view'de yok. */
  notes?: string | null;
  requiredCategoryId?: string | null;
  plannedSubcontractorId?: string | null;
  /** Fasona renksiz git (2026-08-17 "ekru" kuralı) — çekide renk satırı basılmaz. */
  dispatchWithoutColor?: boolean;
  /** Sadece findById response'unda — şu an bu adımda bekleyen rulolar (özet). */
  currentRolls?: StepRollSummary;
  /** Sadece findById response'unda — bekleyen rullaların tek tek listesi. */
  currentRollList?: StepRollItem[];
  /** Sadece findById response'unda — bu fason adımındaki aktif sevkler. */
  dispatches?: StepDispatch[];
  /** Adım acil işaretli mi (refakat kartında ACİL bayrağı için). */
  isUrgent?: boolean;
  /** Planlanan fason firma — fason adımının altında kartta gösterilir. */
  plannedSubcontractor?: { id: string; name: string } | null;
}

export interface WorkOrderTargetItem {
  id: string;
  code: string;
  name: string;
}

export interface WorkOrderTargetColor {
  id: string;
  code: string;
  name: string;
  hex: string | null;
}

export interface WorkOrderTargetPropertyLink {
  propertyId: string;
  property: { id: string; code: string; name: string };
}

export interface WorkOrder {
  id: string;
  /** İş Emri No (İE + GGAAYY + NNNN). Parti (P…) AYRI nesnedir — bkz. Batch/BatchLane. */
  workOrderNumber: string;
  type: WorkOrderType;
  status: WorkOrderStatus;
  width: number | null;
  targetQuantity: number | null;
  /** Hedef ağırlık (kg) — opsiyonel; tekstilde mt + kg planlanır. */
  targetWeight: number | null;
  /** Liste response'unda — üretilen depo metrajı, ÇIKAN (ilerleme kolonu için). */
  producedMeters?: number;
  /** Liste response'unda — üretime GİREN ham metraj (ilk adıma giren toplar). */
  inputMeters?: number;
  /** Liste response'unda — bağlı sipariş satırlarının toplam talep metrajı (m).
   *  Stok üretiminde / siparişe bağlı değilken 0. Çıkan/giren ile sipariş kıyası için. */
  orderedMeters?: number;
  /** Liste response'unda — şu an mal tutulan fason istasyon adları (genelde tek;
   *  AT_SUBCONTRACTOR toplar). Boş = şu an fasonda mal yok. "Şu an: Boyahane" rozeti. */
  currentFasonStations?: string[];
  /** Liste response'unda — bu iş emrinin gittiği fason firmalar (geçmiş DAHİL).
   *  `current: true` → mal ŞU AN orada. 2026-08-17 talebi: adım geçse de
   *  "bu işi kim yaptı" görünsün. */
  fasonFirms?: { name: string; current: boolean }[];
  /** Liste response'unda — canlı (birleştirilmemiş) partilerin İLK üçü,
   *  doğuş sırasına göre. Kolon `+N` rozetini `_count.batches` ile kurar. */
  batches?: { id: string; batchNumber: string }[];
  /** Liste response'unda — canlı parti TOPLAMI (önizlemedeki 3'ten fazlası için). */
  _count?: { batches: number };
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  routeTemplateId: string | null;
  targetItemId: string | null;
  targetColorId: string | null;
  /** Tambur planlama bilgisi — operatöre default olarak gelir. */
  foldType: string | null;
  steps: WorkOrderStepLite[];
  routeTemplate?: { id: string; code: string | null; name: string } | null;
  targetItem?: WorkOrderTargetItem | null;
  targetColor?: WorkOrderTargetColor | null;
  /** Tambur'da finalize edilen rulolarda olacak özellikler. */
  targetProperties?: WorkOrderTargetPropertyLink[];
  orderLinks?: {
    orderLineId: string;
    allocatedQty: number;
    orderLine?: {
      quantity: number;
      /** Denormalize sevk toplamı (m) — kalemin TÜM sevkiyatları (spec havuzu),
       *  bu WO'ya atfedilmez; bağlam bilgisidir. findById payload'ında gelir. */
      shippedQty: number;
      width: number | null;
      colorId: string | null;
      order?: {
        id: string;
        orderNumber: string;
        status: string;
        deadline?: string | null;
        customer?: { id: string; code: string; name: string } | null;
        /** Sipariş hedef şubesi (opsiyonel — eski kayıtlar null). findById include eder. */
        branch?: { id: string; name: string; code: string | null } | null;
      };
      item?: {
        id: string;
        name: string;
      };
      color?: { id: string; code: string; name: string; hex: string | null } | null;
      requiredProperties?: {
        propertyId: string;
        property: { id: string; name: string };
      }[];
    };
  }[];
  /** Sadece findById response'unda — bu WO'nun ürettiği nihai toplar.
   *  Headline: count = warehouse+a1+fire, totalMeters = warehouse+a1 (fire
   *  metresi sayılmaz). Tambur tüm çıktıyı status=WAREHOUSE olarak yazar; ayrım
   *  qualityGrade (1.KALITE/A1/FIRE) üzerinden. (Kartela artık WO'dan üretilmez —
   *  bitmiş top → kartela fasonu; bu yüzden swatch alanı yok.) */
  producedRolls?: {
    count: number;
    totalMeters: number;
    warehouse: { count: number; totalMeters: number };
    a1: { count: number; totalMeters: number };
    fire: { count: number; totalMeters: number };
    items: Array<{
      id: string;
      barcode: string | null;
      qualityGrade: string;
      /** Snapshot — production anındaki initialQty. */
      currentQty: number;
      /** Anlık durum; WAREHOUSE = aktif, TAMBUR_CONSUMED = bölündü, CANCELLED = iptal. */
      status: RollStatus;
      color: { code: string; name: string; hex: string | null } | null;
      createdAt: string;
    }>;
  };
  /**
   * Sadece findById response'unda — bu WO'ya üretime giren ham toplar (girdi).
   * attachRolls ile ilk adıma bağlanan orijinal stok topları; tambur çıktısı ve
   * fason açık kumaşı hariç. totalMeters = giriş anı (initialQty) toplamı.
   */
  inputRolls?: { count: number; totalMeters: number };
  /**
   * Sadece findById response'unda — iptal edilmemiş fason sevklerin toplam
   * metrajı. Form'da yeni hedef metraj girilirken karşılaştırma için kullanılır
   * (sevk edilen > yeni hedef → fazla, Tambur'da stok kalır uyarısı).
   */
  dispatchedTotalQty?: number;
  /**
   * Sadece findById response'unda — düzenleme kilitleri. Frontend form input
   * disabled durumunu ve tooltip mesajını buradan okur. Detay: backend
   * `workorder-locks.helper.ts`.
   */
  locks?: WorkOrderLocks;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrderLocks {
  materialCommitted: boolean;
  targetItem: boolean;
  width: boolean;
  targetQuantity: boolean;
  targetColor: boolean;
  foldType: boolean;
  lockedPropertyIds: string[];
  applicablePropertyIds: string[];
  reasons: Partial<{
    materialCommitted: string;
    targetItem: string;
    width: string;
    targetQuantity: string;
    targetColor: string;
    foldType: string;
    properties: Record<string, string>;
  }>;
}

/** WO targetProperties update endpoint'inin döndürdüğü impact bilgisi. */
export interface TargetPropertyChangeImpact {
  tamburPassedCount: number;
  inProductionCount: number;
}

/** `GET /work-orders/:id/documents` satırı — dört belge kaynağının ortak şekli.
 *  Baskı ucu tipe göre değişir: TRAVELER_CARD → /traveler-cards/:id/html,
 *  diğerleri → /printed-documents/:docType/:sourceId/html. */
export interface WorkOrderDocument {
  docType:
    | "TRAVELER_CARD"
    | "SUBCONTRACTOR_DISPATCH"
    | "SUBCONTRACTOR_RECEIPT"
    | "SUBCONTRACTOR_DIRECT_SHIP";
  sourceId: string;
  documentNo: string;
  /** ISO — kartta basım anı, diğerlerinde olay anı (sevk/kabul/çıkış). */
  date: string;
  /** Grup başlığı: "İş Emri Belgeleri" ya da fason adımının istasyon adı. */
  group: string;
  title: string;
  subtitle: string;
  /** İptal edilmiş belge listede KALIR — donmuş belge silinmez, filigranla basılır. */
  cancelled: boolean;
  /** Yalnız TRAVELER_CARD: basılı kâğıt gerçekle ayrıştı mı. */
  contentDirty?: boolean;
}

export type TravelerCardStatus = "ACTIVE" | "REPRINTED" | "VOIDED" | "COMPLETED";

export interface TravelerCard {
  id: string;
  cardNumber: string;
  barcode: string;
  /** Kart PARTİ başına (Batch). Eskiden workOrderId'ydi. */
  batchId: string;
  version: number;
  status: TravelerCardStatus;
  printedAt: string;
  printedById: string | null;
  /** Basılı kâğıt gerçekle ayrıştı mı (parti doğdu/bölündü/birleşti, sevk yapıldı,
   *  WO içeriği düzenlendi). `Roll.labelDirty` ile aynı sözleşme — baskı olayında
   *  (`POST /traveler-cards/:id/print-event`) temizlenir. Eski API'de yok. */
  contentDirty?: boolean;
  voidedAt?: string | null;
  voidReason?: string | null;
  printedBy?: { id: string; username: string; fullName: string | null } | null;
  /** Basım anında dondurulan WO içeriği (refakat kartı snapshot'ı) + marka/içerik
   *  config'i. PDF bunu canlı WO yerine kullanır → reprint orijinali birebir basar.
   *  Eski kartlarda null → canlı WO'ya fallback. WorkOrder alt-kümesi şeklindedir. */
  snapshot?: (WorkOrder & { config?: TravelerCardConfig }) | null;
}

/**
 * `GET /api/work-orders/:id/linkable-order-lines` satırı (2026-08-17, madde 8).
 *
 * Liste zaten kumaş+renk uyumuna göre süzülmüş gelir; `warnings` yalnız
 * ENGEL OLMAYAN uyumsuzlukları (bugün: en farkı) taşır.
 */
export interface LinkableOrderLine {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  width: number | null;
  quantity: number;
  shippedQty: number;
  /** İstenen − sevk edilen (negatife düşmez). */
  openQty: number;
  deadline: string | null;
  warnings: string[];
}

/** "Toplara da uygula" adayı — parti başına toplar (2026-08-17, madde 12). */
export interface RollAttributeTarget {
  batchId: string | null;
  batchNumber: string | null;
  rolls: {
    id: string;
    barcode: string | null;
    status: string;
    colorName: string | null;
    width: number | null;
    /** null → değiştirilebilir. Doluysa kısa sebep ("fasonda", "sevk edildi"). */
    blocked: string | null;
  }[];
}

/** `GET /work-orders/:id/fason-quick-receive` — kapatmayı engelleyen fason yükü. */
export interface FasonQuickPreview {
  groups: Array<{
    dispatchId: string;
    dispatchNo: string;
    stepId: string;
    stationName: string;
    subcontractorId: string;
    subcontractorName: string;
    rolls: { id: string; barcode: string | null; qty: number }[];
    /** Giden toplam metraj — "dikilerek geldi" modunda tek topun varsayılanı. */
    totalQty: number;
    /** Kabulde RENK sorulmalı mı (hedef rengi olmayan "ekru" iş emirleri). */
    colorRequired: boolean;
  }>;
  /** Fasonda görünüp açık sevke bağlanamayan toplar — buradan kabul EDİLEMEZ. */
  orphanRolls: { id: string; barcode: string | null; qty: number }[];
}
