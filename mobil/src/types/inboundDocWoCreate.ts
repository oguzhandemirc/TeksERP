// Belgeden terbiye iş emri gövdesi + yanıtı (`POST /gelen-belge/irsaliyeler/:id/is-emri`) — `inboundDoc.service.ts` 300 satır
// sınırında olduğundan ayrı dosya; servis aynı adlarla yeniden dışa verir (çağıranlar değişmez).
import type { CreateWorkOrderRoll } from './inboundDocRolls';

/** Sözleşme 3: belgeden tek seferde terbiye iş emri (`POST /gelen-belge/irsaliyeler/:id/is-emri`). */
export interface CreateWorkOrderFromNoteBody {
  clientToken: string;
  ownerCustomerId: string;
  /** null = temizle. */
  ourBatchNo?: string | null;
  ourBatchNoKey?: string;
  /** Müşterinin parti no'su; YALNIZ kullanıcı değiştirdiyse gider (eski sunucu strict gövdesi anahtarı 400'ler). */
  customerBatchNo?: string | null;
  /** Decimal string; verilince gözden geçirilmiş sayılır. */
  kursunMeters: string;
  /** Yok = rotasız iş emri (K29; yalnız rota uygulaması "Okutmayla", sunucu SIRALI'da 400 verir). */
  routeTemplateId?: string;
  stepPlanning?: { sequence: number; plannedMachineId?: string | null }[];
  targetValues?: { propertyId: string; valueId: string }[];
  notes?: string;
  /** S1 çok partili belge (≥2 parti); yalnız `/partiler` çok parti dediğinde gider (eski sunucu strict gövdeyle 400 verir). */
  parties?: {
    blockNo: number;
    batchNo: string | null;
    meters: number;
    /** Belge masası: parti başına gramaj / plan makinesi (verilmezse gövdedekiler). */
    targetValues?: { propertyId: string; valueId: string }[];
    stepPlanning?: { sequence: number; plannedMachineId?: string | null }[];
  }[];
  mode?: MultiPartyMode;
  /** Toplar ayrı geldi (SEPARATE + `rolls` 1–200); yok = bugünkü tek parça. `parties` ile birlikte gitmez. Eski sunucu strict gövdeyle 400 verir. */
  rollMode?: 'SINGLE' | 'SEPARATE';
  rolls?: CreateWorkOrderRoll[];
  /** K27 WARN: işi süren aynı belge no'lu eşe rağmen kaydet (409 `DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE` sonrası). */
  confirmDuplicateDocNo?: true;
  // S16a tek form alanları (hepsi isteğe bağlı): verilen açık değer toptan türetileni ezer; yoksa bugünkü davranış.
  targetItemId?: string;
  targetColorId?: string;
  /** cm */
  width?: number;
  /** m */
  targetQuantity?: number;
  /** kg */
  targetWeight?: number;
  plannedStartDate?: string;
  plannedEndDate?: string;
  foldType?: string;
  orderLineIds?: string[];
  // K30-D (hepsi isteğe bağlı; anahtar yoksa sunucuda bugünkü türetme):
  /** Hedef özellikler (BAYRAK); anahtar verilince istemcinin kümesi yazılır (istasyon tohumu eklenmez). */
  targetPropertyIds?: string[];
  /** Yoksa sipariş kalemi varsa ORDER, yoksa STOCK; ORDER + kalemsiz → 400. */
  type?: 'ORDER_PRODUCTION' | 'STOCK_PRODUCTION';
  /** Düzenlenmiş rota adımları (routeTemplateId ile birlikte; şablonun yerine geçer; stepPlanning ile birlikte 400). */
  steps?: {
    stationId: string;
    sequence?: number;
    notes?: string;
    requiredCategoryId?: string;
    plannedSubcontractorId?: string;
    plannedMachineId?: string;
    dispatchWithoutColor?: boolean;
  }[];
}

export interface CreateWorkOrderFromNoteResult {
  workOrderId: string;
  workOrderNo: string;
  batchNumber: string;
  rollId: string;
  /** Çok partili kayıtta açılan iş emirleri (eski sunucu göndermez). */
  workOrders?: { blockNos: number[]; workOrderId: string; workOrderNo: string; batchNumber: string | null }[];
}

export type MultiPartyMode = 'SINGLE' | 'PER_PARTY';
