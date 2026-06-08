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
}

/** findById response'unda step başına bekleyen rulolar listesi (detay paneli için). */
export interface StepRollItem {
  id: string;
  barcode: string | null;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  kind: "raw" | "dyed" | "open";
  item: { id: string; code: string; name: string } | null;
  color: { id: string; code: string; name: string; hex: string | null } | null;
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
  dyehouseNote: string | null;
  /** WO'daki boyahane notu (default) — sevkin kendi notu boşsa buna düşülür. */
  woDyehouseNote: string | null;
  subcontractor: { id: string; name: string };
  dispatchedBy: { id: string; fullName: string | null; username: string } | null;
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
  batchNumber: string;
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
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  routeTemplateId: string | null;
  targetItemId: string | null;
  targetColorId: string | null;
  /** Tambur planlama bilgisi — operatöre default olarak gelir. */
  foldType: string | null;
  /** Boyahaneye özel talimat — fason sevkinde kullanılır. */
  dyehouseNote: string | null;
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
      width: number | null;
      colorId: string | null;
      order?: {
        id: string;
        orderNumber: string;
        deadline?: string | null;
        customer?: { id: string; code: string; name: string } | null;
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

export type TravelerCardStatus = "ACTIVE" | "REPRINTED" | "VOIDED" | "COMPLETED";

export interface TravelerCard {
  id: string;
  cardNumber: string;
  barcode: string;
  workOrderId: string;
  version: number;
  status: TravelerCardStatus;
  printedAt: string;
  printedById: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  printedBy?: { id: string; username: string; fullName: string | null } | null;
  /** Basım anında dondurulan WO içeriği (refakat kartı snapshot'ı) + marka/içerik
   *  config'i. PDF bunu canlı WO yerine kullanır → reprint orijinali birebir basar.
   *  Eski kartlarda null → canlı WO'ya fallback. WorkOrder alt-kümesi şeklindedir. */
  snapshot?: (WorkOrder & { config?: TravelerCardConfig }) | null;
}
