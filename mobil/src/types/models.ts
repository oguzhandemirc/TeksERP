// Legacy string literal type — KK1 form'unda hardcoded picker için kullanılır.
// Yeni admin-yönetimli katalog için aşağıdaki `QualityGrade` interface'ine bak.
export type QualityGradeCode = '1.KALITE' | 'A1' | '2.KALITE' | 'FIRE';

export type CompanyType = 'CUSTOMER' | 'SUBCONTRACTOR' | 'BOTH';
export type StationType = 'PROCESS' | 'PROCESS_QC' | 'EXTERNAL' | 'WAREHOUSE';
export type StationKind =
  | 'RAW_QC'
  | 'EXTERNAL'
  | 'PROCESS_QC'
  | 'TAMBUR'
  | 'SUBCONTRACTOR'
  | 'OTHER';
// ⚠️ BACKEND `StepStatus` İLE ELLE SENKRON (schema.prisma → `enum StepStatus`).
// NEDEN 'CANCELLED' ÇIKARILDI (2026-07-31 denetimi): backend enum'unda yalnız
// PENDING/ACTIVE/COMPLETED/SKIPPED var — 'CANCELLED' hayalet bir ayna değeriydi ve
// hiçbir yerde okunmuyordu. İş emri iptalinde ADIM iptal olmaz; kart VOIDED olur.
// Hayalet değer sessizce zarar verir: `step.status === 'CANCELLED'` yazan kod
// derlenir ama koşulu ASLA sağlanmaz, dolayısıyla ölü dal hata vermeden yaşar.
export type StepStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'SKIPPED';
export type WorkOrderStatus =
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'PARTIAL_SHIPPED';

export type WorkOrderType =
  | 'ORDER_PRODUCTION'
  | 'STOCK_PRODUCTION'
  | 'SAMPLE_PRODUCTION'
  | 'REPAIR_REWORK';

// ⚠️ BACKEND `RollStatus` İLE ELLE SENKRON — değiştirmeden önce
// `Teks-Erp/prisma/schema.prisma` → `enum RollStatus`'a BAK.
// Mobil ayrı bir projedir, backend Prisma enum'unu import EDEMEZ; bu union bir
// AYNADIR ve derleyici aynanın eksik olduğunu SÖYLEMEZ.
//
// NEDEN önemli (2026-07-31 denetimi): burada DÖRT gerçek değer EKSİKTİ —
// CANCELLED, RETURNED_FROM_SUBCONTRACTOR, AT_KARTELA, KARTELA_CONSUMED. Backend
// bu statülerdeki topu pekâlâ döndürüyor (operatör iptali, fason dönüşü, kartela
// sevki/kabulü). Eksikliğin SESSİZ olmasının sebebi: veri yolunda hiçbir şey
// patlamıyor (`ROLL_STATUS_LABEL` bir `Record<string, string>`, 13 değerin
// hepsini zaten tanıyor ve doğru Türkçe etiketi basıyor). Kırılan yer TİP
// YÜZEYİ: eksik değer TypeScript için "imkânsız" olduğundan
//   • `roll.status === 'AT_KARTELA'` yazmak TS2367 derleme hatası verir —
//     yani o statüyü ele alan kod YAZILAMAZ,
//   • `Record<RollStatus, X>` / switch gibi kapsayıcı yapılar o dalları
//     sessizce dışarıda bırakır (eksiklik "tamam" görünür).
// Sonuç: kartelaya çıkmış ya da iptal edilmiş top için özel davranış
// eklenemiyordu ve bunun sebebi hiçbir hata mesajında görünmüyordu.
//
// Sıra backend enum'uyla aynı tutuldu ki gözle karşılaştırmak kolay olsun.
export type RollStatus =
  | 'STOCK'
  | 'IN_PRODUCTION'
  | 'SCRAP' // Gerçek fire
  | 'CANCELLED' // Operatör iptali (yanlış kayıt) — fire değil
  | 'AT_SUBCONTRACTOR'
  | 'A1_STOCK'
  | 'RETURNED_FROM_SUBCONTRACTOR' // Fason dönüşü — eski top kapandı, yenileri doğdu
  | 'WAREHOUSE'
  | 'SHIPPED'
  | 'TAMBUR_CONSUMED'
  | 'SUBCONTRACTOR_CONSUMED'
  | 'AT_KARTELA' // Bitmiş top kartela fasonunda
  | 'KARTELA_CONSUMED'; // Kartela kabulünde kapandı — metraj Swatch'lara gitti

// Backend enum'uyla (Teks-Erp RollEntrySource) birebir — SUPPLIER_RECEIPT = mobil
// KK1 istasyon taraması, MANUAL_ENTRY = Electron admin "Manuel Top Ekle" (2026-07-15
// ayrıştırıldı), TAMBUR_MANUAL = Tambur "Manuel Ekle" modu, kartsız (2026-08-03).
// Önceki 'KK1_INITIAL'/'MANUAL' değerleri backend'de HİÇ var olmadı.
export type RollEntrySource =
  | 'SUPPLIER_RECEIPT'
  | 'MANUAL_ENTRY'
  | 'TAMBUR_SPLIT'
  | 'SUBCONTRACTOR_RETURN'
  | 'TAMBUR_MANUAL';

// =============================================================================
// Master data — Color, FabricProperty
// =============================================================================

export interface Color {
  id: string;
  code: string;
  name: string;
  hex?: string | null;
  isActive?: boolean;
}

export interface FabricProperty {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
}

// =============================================================================
// Customer / Subcontractor / Station
// =============================================================================

export interface Customer {
  id: string;
  code: string;
  name: string;
  type: CompanyType;
  isActive: boolean;
}

export interface SubcontractorCategory {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  /**
   * true ise bu kategorideki fason kabulde Roll'a iş emrinin hedef rengi
   * otomatik uygulanır. Boyahane gibi.
   */
  appliesColor?: boolean;
  /**
   * [YENİ — 2026-05-18] true ise bu kategorideki fason kabulde Roll'a iş
   * emrinin hedef özellikleri otomatik uygulanır. Boyahane'de appliesColor ile
   * birlikte gelir; ileride Zımpara/Kurşun gibi yalnız özellik veren adımlar
   * ("zımparalanmış", "kurşunlanmış") için bağımsız açılabilir.
   *
   * TODO (FasonKabulScreen): UI şu an renk + özellik bloklarını tek
   * appliesColor flag'ine bağlı tutuyor. Yeni mantıkta:
   *   - renk seçici → appliesColor=true ise göster
   *   - özellik seçici → appliesProperty=true ise göster
   * Backend `subcontractor.service.ts` artık property'i `appliesProperty`
   * üzerinden çözüyor (`appliesColor`'dan bağımsız). Mobil bu ayrımı henüz
   * yansıtmıyor — kullanıcı bilinçli olarak sonraya bıraktı.
   */
  appliesProperty?: boolean;
  isActive: boolean;
}

export interface SubcontractorToCategory {
  subcontractorId: string;
  categoryId: string;
  category?: SubcontractorCategory;
}

export interface Subcontractor {
  id: string;
  code: string;
  name: string;
  taxNumber?: string | null;
  phone?: string | null;
  address?: string | null;
  isActive: boolean;
  /** İş emri fason adımında firma seçicide default — kategori bazında client eşleşir. */
  isFavorite?: boolean;
  categories?: SubcontractorToCategory[];
}

export interface Station {
  id: string;
  code: string;
  name: string;
  type: StationType;
  kind?: StationKind;
}

// =============================================================================
// Item — Variant kaldırıldı; allowedColors / allowedProperties pattern
// =============================================================================

export interface Item {
  id: string;
  code: string;
  name: string;
  itemType?: string;
  isActive?: boolean;
  /** Saha (KK1) "yeni desen" olarak açtı → admin gözden geçirmesi bekleniyor. */
  pendingReview?: boolean;
  /** M:N pivot satırları — `GET /items` `include: { allowedColors: { include: { color } } }`
   *  ile döner, yani eleman DÜZ `Color` DEĞİLDİR (renk `.color` altındadır).
   *  Boş/verilmemiş = sınırsız (kumaş her renkte üretilebilir). */
  allowedColors?: ItemAllowedColor[];
  allowedProperties?: ItemAllowedProperty[];
}

/** `item_allowed_colors` pivotu — kumaşın izinli renk listesi. */
export interface ItemAllowedColor {
  colorId: string;
  color?: Color;
}

/** `item_allowed_properties` pivotu — kumaşın izinli özellik listesi. */
export interface ItemAllowedProperty {
  propertyId: string;
  property?: FabricProperty;
}

// =============================================================================
// WorkOrder + steps + order links
// =============================================================================

export interface WorkOrderStep {
  id: string;
  workOrderId: string;
  stationId: string;
  stepSequence: number;
  status: StepStatus;
  notes?: string | null;
  station?: Station;
  requiredCategoryId?: string | null;
  requiredCategory?: SubcontractorCategory | null;
  plannedSubcontractorId?: string | null;
  plannedSubcontractor?: Subcontractor | null;
}

export interface WorkOrderToOrderLine {
  workOrderId: string;
  orderLineId: string;
  allocatedQty: number;
  orderLine?: {
    id: string;
    quantity: number;
    width: number | null;
    colorId?: string | null;
    customerItemName?: string | null;
    customerColorName?: string | null;
    item?: { id: string; code: string; name: string };
    color?: Color | null;
    order?: {
      id: string;
      orderNumber: string;
      deadline?: string | null;
      customer?: { id: string; code: string; name: string };
    };
  };
}

export interface WorkOrder {
  id: string;
  workOrderNumber: string;
  status: WorkOrderStatus;
  type?: WorkOrderType;
  width?: number | null;
  targetQuantity?: number | null;
  /** Hedef ağırlık (kg) — refakat kartında "Hedef Kg" olarak basılır, opsiyonel. */
  targetWeight?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  steps?: WorkOrderStep[];
  createdAt?: string;
  // withOrderDetail=true ile gelen alanlar
  orderLinks?: WorkOrderToOrderLine[];
  targetItemId?: string | null;
  targetItem?: Item | null;
  targetColorId?: string | null;
  targetColor?: Color | null;
  targetProperties?: FabricProperty[];
  /** "2-KAT" / "4-KAT" gibi — Tambur planlaması, opsiyonel. */
  foldType?: string | null;
  /** Tambur katman sayısı (1-20), opsiyonel. */
  layerCount?: number | null;
  dispatchedTotalQty?: number;
  /** Liste response'unda — canlı (birleştirilmemiş) partilerin ilk üçü. */
  batches?: { id: string; batchNumber: string }[];
  /** Liste response'unda — canlı parti toplamı ("+N" için). */
  _count?: { batches: number };
}

// =============================================================================
// Subcontractor Dispatch
// =============================================================================

export interface SubcontractorDispatchItem {
  id: string;
  rollId: string;
  dispatchedQty: number;
  dispatchedWeight: number | null;
  roll?: Pick<Roll, 'id' | 'barcode' | 'item' | 'qualityGrade' | 'width' | 'color'>;
}

export interface SubcontractorDispatchListItem {
  id: string;
  dispatchNo: string;
  dispatchedAt: string;
  totalQty: number;
  plateNumber: string | null;
  driverName: string | null;
  notes: string | null;
  /** Fason adım talimatı (adımın notes'undan default, sevkte override edilebilir). */
  instruction: string | null;
  stepId: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  workOrder?: Pick<WorkOrder, 'id' | 'workOrderNumber'>;
  subcontractor?: Pick<Subcontractor, 'id' | 'name'>;
  _count?: { items: number };
}

export interface SubcontractorDispatch {
  id: string;
  dispatchNo: string;
  workOrderId: string;
  stepId: string;
  subcontractorId: string;
  plannedSubcontractorId: string | null;
  plateNumber: string | null;
  driverName: string | null;
  notes: string | null;
  /** Fason adım talimatı (adımın notes'undan default, sevkte override edilebilir). */
  instruction: string | null;
  totalQty: number;
  dispatchedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  workOrder?: Pick<WorkOrder, 'id' | 'workOrderNumber'> & Partial<WorkOrder>;
  step?: WorkOrderStep;
  subcontractor?: Subcontractor;
  plannedSubcontractor?: Subcontractor | null;
  dispatchedBy?: { id: string; username: string; fullName: string } | null;
  cancelledBy?: { id: string; username: string; fullName: string } | null;
  items?: SubcontractorDispatchItem[];
}

// =============================================================================
// Roll — barcode nullable (açık kumaş), colorId + properties bağımsız
// =============================================================================

export interface RollProperty {
  propertyId: string;
  property?: FabricProperty;
  /** SEÇİM tipli özellikte seçilen değer — backend GET /rolls yanıtında ZATEN
   *  gönderiyor (ROLL_LIST_INCLUDE); tip taşımayınca ekranlar basamıyordu
   *  (denetim VAL-04). */
  value?: { code: string; name: string } | null;
}

export interface RollErrorRecord {
  id: string;
  startMeter: number;
  endMeter: number | null;
  defectTypeId: string | null;
  errorType: string | null;
  isProcessed?: boolean;
}

export interface Roll {
  id: string;
  /** Açık kumaş (boyahane dönüşü Kurşun/KK2 aşaması) için NULL. */
  barcode: string | null;
  itemId: string;
  colorId?: string | null;
  initialQty: number;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
  status: RollStatus;
  entrySource?: RollEntrySource;
  /** Kaç kat sarıldığı ("2-KAT" | "4-KAT"); NULL = kayıtlı değil. */
  foldType?: string | null;
  parentReceiptId?: string | null;
  item?: { id: string; code: string; name: string };
  color?: Color | null;
  properties?: RollProperty[];
  producedInStep?: {
    workOrder?: { id: string; workOrderNumber: string } | null;
  } | null;
  createdBy?: { id: string; username: string; fullName: string } | null;
  /** Topun sisteme GİRDİĞİ istasyon (kalıcı köken; 2026-08-05 öncesi toplar null). */
  entryStation?: { id: string; code: string; name: string } | null;
  /** Topun üstündeki son basılan etiket snapshot'ı (null = stok/etiket yok). BAĞ DEĞİL. */
  lastLabelSnapshot?: RollLabelSnapshot | null;
  /** Sevkiyat rezervasyonu: dolu ise top "serbest depo" DEĞİL — bir çuvalın
   *  içinde, bir sevkiyata bağlı (çuval depo / planlı sevkiyat). WAREHOUSE statüsüyle
   *  görünse de başka işe (sevk/kartela/iş emri) ayrılamaz. */
  shipmentId?: string | null;
  sackId?: string | null;
  shipment?: { id: string; shipmentNo: string; status: string } | null;
  sack?: { id: string; sackNo: string; seq: number } | null;
  /** Top Tambur'da kartela sevki için işaretlendi mi (depo "kartelalık" rozeti). */
  markedForKartela?: boolean;
  createdAt?: string;

  // ── ÖLÜ ETİKET TEŞHİSİ (2026-08-05) ────────────────────────────────────────
  // Okutma yüzeyi iptal edilmiş barkodda eskiden yalnız "stokta değil" deyip
  // SUSUYORDU. Operatörün elinde fiziksel top, önünde akan vardiya varken bu
  // sessizlik doğaçlamaya davettir — sahada tam olarak öyle oldu: kayıt öldü,
  // mal gitmek zorundaydı, ikinci bir barkod basıldı ve topta iki etiket kaldı.
  /** Etiketin basıldığı an — doluysa topun üstünde fiziksel bir kâğıt VAR. */
  labelPrintedAt?: string | null;
  /** İptal anı (yalnız CANCELLED topta dolu). */
  cancelledAt?: string | null;
  /** İptal gerekçesi — topun KENDİ satırından gelir, audit'ten değil. */
  cancelReason?: string | null;
  cancelledBy?: { id: string; username: string; fullName: string } | null;
  /**
   * İptal GERİ ALINABİLİR mi. Backend ile AYNI yüklemden gelir — istemci kendi
   * kuralını kurmaz, yoksa buton çizilir ama uç 409 verir.
   * `undefined` = top zaten iptal değil (teşhis hiç koşmadı).
   */
  canRestore?: boolean;
  /** Geri alınamıyorsa somut Türkçe sebep (operatöre ne yapacağını söyler). */
  restoreBlockReason?: string | null;
}

export interface RollLabelSnapshot {
  customerId: string | null;
  customerName: string | null;
  orderNumber: string | null;
  itemName: string | null;
  colorName: string | null;
  printedAt: string;
  operatorId: string | null;
  operatorName: string | null;
}

// =============================================================================
// Fason Mal Kabul (Subcontractor Receipt)
// =============================================================================

export interface PendingReturnGroup {
  step: {
    id: string;
    stepSequence: number;
    station: Station;
    notes: string | null;
    requiredCategory: SubcontractorCategory | null;
    plannedSubcontractor: Subcontractor | null;
  };
  workOrder: {
    id: string;
    batchNumber: string;
    status: WorkOrderStatus;
    targetColor?: Color | null;
    targetProperties?: FabricProperty[];
    /** İş emrinin HEDEF eni (cm) — işlem SONRASI beklenen en, giden topun eni DEĞİL.
     *  Fason kabulünde en alanına ön değer olarak düşer; dolu geldiğinde
     *  "uygulanan" paneli kapalı açılır (operatörün önünü kalabalıklaştırmasın). */
    width?: number | null;
  };
  lastDispatch: {
    id: string;
    dispatchNo: string;
    dispatchedAt: string;
    plateNumber: string | null;
    driverName: string | null;
    subcontractorId: string;
    subcontractor: Subcontractor;
  } | null;
  /**
   * Adımdaki bekleyen toplar SEVK (parti) bazında alt-gruplanmış hali. Çoklu
   * sevkte (aynı adıma parça parça boyahaneye gönderim) operatör "ikisi birlikte
   * mi geldi, tek parti mi?" teyidini ancak partiler ayrı görünürse yapabilir.
   * Parti kimliği = kaynak sevkin id'si (`SubcontractorDispatch`; backend
   * `Roll.batchId` → `SubcontractorDispatch.batchId` üzerinden türetir — eski
   * `batchSplitId` kolonu parti-modeli redesign'ıyla kalktı).
   * Tek parti varsa dizi tek elemanlı; eski payload'larda olmayabilir (guard et).
   */
  parties: PendingReturnParty[];
  rolls: Roll[];
  rollCount: number;
  totalQty: number;
  /**
   * Fason adımında DURAN ama fasona ÇIKMAMIŞ top var mı ("Konumu Düzelt" sonrası
   * mal içeride bekliyor). Kabul akışına GİRMEZ — `rolls`/`parties`/`rollCount`
   * yalnız `AT_SUBCONTRACTOR` sayar; bu bayrak yalnız görünürlük içindir, yoksa
   * iş emri listeden sessizce kaybolur. Eski backend'lerde alan YOK.
   */
  awaitingDispatch?: boolean;
  awaitingDispatchRollCount?: number;
  awaitingDispatchQty?: number;
}

/** Bekleyen kabul grubu içindeki tek bir sevk partisi (kaynak dispatch lane'i). */
export interface PendingReturnParty {
  /** Sevkin id'si (kaynak `SubcontractorDispatch`). Eski/kimliksiz akışta null olabilir. */
  dispatchId: string | null;
  dispatchNo: string | null;
  dispatchedAt: string | null;
  plateNumber: string | null;
  driverName: string | null;
  subcontractorId: string | null;
  subcontractor: Subcontractor | null;
  rolls: Roll[];
  rollCount: number;
  totalQty: number;
}

/** Liste görünümü için hafif özet — rolls yok, seçimde /step/:stepId lazy-load. */
export interface PendingReturnSummary {
  step: {
    id: string;
    stepSequence: number;
    station: Station;
    notes: string | null;
    requiredCategory: SubcontractorCategory | null;
    plannedSubcontractor: Subcontractor | null;
  };
  workOrder: {
    id: string;
    batchNumber: string;
    status: WorkOrderStatus;
  };
  lastDispatch: {
    id: string;
    dispatchNo: string;
    dispatchedAt: string;
    plateNumber: string | null;
    driverName: string | null;
    subcontractorId: string;
    subcontractor: Subcontractor;
  } | null;
  rollCount: number;
  totalQty: number;
  /** Bkz. `PendingReturnGroup.awaitingDispatch` — satır "SEVK BEKLİYOR" rozeti alır. */
  awaitingDispatch?: boolean;
  awaitingDispatchRollCount?: number;
  awaitingDispatchQty?: number;
  /** Client-side arama özetleri — gruptaki rulolardan distinct (rolls taşınmaz). */
  itemNames: string[];
  colorNames: string[];
  /** WO'nun aktif refakat kart numaraları — kart no ile arama için. */
  cardNumbers: string[];
}

/** Alıcı her satır için tek opaque obje gönderir; ölçüm/etiket yapılmaz. */
export interface ReceiveReturnInput {
  rollId: string;
  notes?: string | null;
}

export interface ReceiveNewRollInput {
  qty: number;
  weightKg?: number | null;
  notes?: string | null;
}

export interface ReceiveRequest {
  workOrderId: string;
  stepId: string;
  subcontractorId: string;
  manifestNo?: string | null;
  notes?: string;
  /** Receipt seviyesinde uygulanan renk (override; appliesColor=true kategoride boş bırakılabilir → WO.targetColor). */
  appliedColorId?: string | null;
  /** Receipt seviyesinde uygulanan özellikler (override; appliesColor=true kategoride boş bırakılabilir → WO.targetProperties). */
  appliedPropertyIds?: string[];
  /**
   * Kabulde ÖLÇÜLEN en (cm) — doğan TÜM parçalara uygulanır (kabul başına tek değer).
   * Renkten farkı: renk yalnız "renk veren" kategoride sorulur, en HER fason
   * dönüşünde. Topun enini ilk kez burada öğreniyoruz — ham girişte en tasarım
   * gereği yazılmıyor. Opsiyonel: zorunluluk ekranda yaşar, sözleşmede değil.
   */
  appliedWidth?: number;
  returns: ReceiveReturnInput[];
  /** Fasondan dönen açık kumaş parçaları — backend min(1) zorunlu. */
  newRolls: ReceiveNewRollInput[];
}

export interface ReceiptBornRoll {
  id: string;
  initialQty: number;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  status: string;
  qualityGrade: string;
  item?: { code: string; name: string } | null;
  color?: { code: string; name: string } | null;
}

export interface SubcontractorReceiptItem {
  id: string;
  receiptId: string;
  newRollId: string;
  notes: string | null;
  newRoll?: Pick<
    Roll,
    'id' | 'barcode' | 'item' | 'qualityGrade' | 'color' | 'currentQty' | 'initialQty' | 'width' | 'weightKg'
  >;
}

export interface SubcontractorReceiptListItem {
  id: string;
  receiptNo: string;
  manifestNo: string | null;
  receivedAt: string;
  notes: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  appliedColorId?: string | null;
  appliedColor?: Color | null;
  workOrder?: Pick<WorkOrder, 'id' | 'workOrderNumber'>;
  subcontractor?: Pick<Subcontractor, 'id' | 'name' | 'code'>;
  step?: { id: string; stepSequence: number; station: Pick<Station, 'name' | 'code'> };
  receivedBy?: { id: string; username: string; fullName: string } | null;
  cancelledBy?: { id: string; username: string; fullName: string } | null;
  items?: { id: string }[];
  _count?: { items: number };
  totalQty?: number;
}

export interface SubcontractorReceipt extends SubcontractorReceiptListItem {
  items?: SubcontractorReceiptItem[];
  appliedProperties?: FabricProperty[];
  /** Fasondan dönen yeni açık kumaş parçaları (split varsa N adet). */
  bornRolls?: ReceiptBornRoll[];
  /**
   * ÜRETİM BİLGİSİ (2026-08-09) — detay ucu iş emrini İLİŞKİLERİYLE döner
   * (liste ucundaki `Pick<WorkOrder, 'id'|'workOrderNumber'>` DEĞİL).
   *
   * ⚠️ Liste tipini genişletme cazip ama YANLIŞ: `listReceipts` bu ilişkileri
   * çekmiyor ve tip "var" derse ekran boş basar. Emsal: 2026-08-05 "Ekleme
   * Nedeni" vakası — panel liste satırından okuyordu, alan yalnız detayda
   * dönüyordu ve özellik kullanıcıya HİÇ ulaşmadı.
   */
  workOrder?: Pick<WorkOrder, 'id' | 'workOrderNumber'> & {
    width?: number | null;
    foldType?: string | null;
    targetColor?: Pick<Color, 'id' | 'code' | 'name' | 'hex'> | null;
    targetProperties?: Array<{ property?: { id: string; name: string } }>;
  };
}

export interface CancelReceiptRequest {
  reason: string;
  /** Receipt'ten doğan açık kumaş Roll'larını cascade iptal et. Preview'den
   *  alınıp aynen geri gönderilir; eksik/fazla → 409. */
  cascadeRollIds?: string[];
}

/** GET /receipts/:id/cancel-preview — UI cascade onay listesini bunu kullanarak çizer. */
export interface BornRollPreviewItem {
  id: string;
  itemCode: string;
  itemName: string;
  colorName: string | null;
  currentQty: number;
  status: string;
  /** Boş ise cascade güvenli. Dolu ise her satır operatöre tooltip olarak gösterilir. */
  blockingReasons: string[];
  safeToCancel: boolean;
}

/**
 * K14 parti-tutarlılık engelinin tek satırı — kabul iptali topların parti
 * üyeliği değiştiği için (birleştirme/taşıma) yapılamıyor.
 */
export interface ReceiptBatchMismatchItem {
  rollId: string;
  /** Barkod; barkodsuz açık kumaşta backend `(barkodsuz açık kumaş)` yazar. */
  barcode: string;
  dispatchNo: string;
  /** Topun ŞU ANKİ partisi. */
  rollBatchNumber: string | null;
  /** Sevk kaydının bağlı olduğu parti. */
  dispatchBatchNumber: string | null;
}

export interface ReceiptCancelPreview {
  receiptNo: string;
  receivedAt: string;
  bornRolls: BornRollPreviewItem[];
  /**
   * K14 parti uyuşmazlığı — `cancelReceipt`'in tx-içi guard'ıyla AYNI kaynaktan.
   * Eskiden önizleme bunu hiç sormuyordu: operatör `allSafe: true` görüp butona
   * basıyor, sonra 409 yiyordu. Eski backend'lerde alan YOK → guard'lı oku.
   */
  batchMismatch?: {
    blocked: boolean;
    items: ReceiptBatchMismatchItem[];
    /** Guard'ın basacağı metnin birebir aynısı (null = engel yok). */
    message: string | null;
  };
  /** Tüm bornRoll'ları cascade iptal güvenli mi (K14 dahil). False ise iptal butonu disabled. */
  allSafe: boolean;
  totalBornRolls: number;
}

// =============================================================================
// Refakat Kartı (Traveler Card)
// =============================================================================

export type TravelerCardStatus = 'ACTIVE' | 'COMPLETED' | 'VOIDED';

export interface TravelerCardLookup {
  id: string;
  cardNumber: string;
  barcode: string;
  version: number;
  status: TravelerCardStatus;
  workOrderId: string;
  printedAt: string;
  /** Basılı kâğıt gerçekle ayrıştı mı (parti doğdu/bölündü/birleşti, sevk yapıldı,
   *  iş emri içeriği değişti). `Roll.labelDirty` ile aynı sözleşme; baskı olayında
   *  (`POST /traveler-cards/:id/print-event`) temizlenir. Eski backend'de yok. */
  contentDirty?: boolean;
  workOrder?: WorkOrder;
  /** Bu WO'da iptal edilmemiş + mal kabulü tamamlanmamış açık sevk var mı. */
  hasOpenDispatch?: boolean;
}

// =============================================================================
// Kalite — Hata tipi kataloğu (DefectType)
// =============================================================================

export type DefectSeverity = 'MINOR' | 'MAJOR' | 'CRITICAL';

export interface DefectType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  severity: DefectSeverity | null;
  isActive: boolean;
}

// =============================================================================
// Kurşun + QC2 (PROCESS_QC istasyonu)
// =============================================================================

export interface KursunRollDefectSummary {
  id: string;
  startMeter: number;
  defectTypeId: string | null;
  errorType: string | null;
}

export interface KursunRollSummary {
  rollId: string;
  barcode: string | null;
  currentQty: number;
  qc2Completed: boolean;
  errorCount: number;
  defects: KursunRollDefectSummary[];
  itemName?: string | null;
  colorName?: string | null;
}

export interface KursunStepSummary {
  workOrderStepId: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  workOrderId: string;
  batchNumber: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'SKIPPED';
  /**
   * İstasyona KURSUN özelliği yetenek olarak atanmış mı?
   *
   * ⚠️ Bu alan "İSTASYON verebilir mi" der, "BU TOPA yazılacak mı" DEMEZ —
   * 2026-08-10 mod modelinde ikisi ayrıldı. Uygulanma kararı `properties`
   * içindeki KURSUN satırının `mode`'undadır.
   */
  appliesKursun: boolean;
  /**
   * İstasyonun özellik yetenekleri + MODLARI (2026-08-10).
   *   OTOMATİK → operatöre sorulmaz, adım kapanınca yazılır (tuş çizilmez)
   *   OPSİYONEL → tuş çıkar; yalnız işaretlenirse yazılır
   *   ZORUNLU   → tuş çıkar; işaretlenmeden adım kapanmaz (backend 400)
   * Eski backend bu alanı göndermez → `undefined` → tuş çizilmez, davranış
   * bugünküyle aynı (yalnız AUTO uygulanır).
   */
  properties?: {
    propertyId: string;
    code: string;
    name: string;
    mode: 'AUTO' | 'OPTIONAL' | 'REQUIRED';
    /** BAYRAK → aç/kapa çipi · SEÇİM → değer çipleri (2026-08-11).
     *  Eski backend göndermez → undefined → BAYRAK gibi davranılır. */
    valueType?: 'FLAG' | 'CHOICE';
    /** SEÇİM tipliyse operatöre sunulacak AKTİF değerler. Tuşlar BURADAN
     *  çizilir — kodda sabit liste YOK (25GR/50GR/75GR panelden tanımlanır). */
    values?: { code: string; name: string }[];
  }[];
  /** Bu adıma yazılan not (WorkOrderStep.notes; rotada KK2 istasyonuna özel
   *  talimat) — kart açıkken üstte gösterilir. */
  stepNote?: string | null;
  /**
   * Bu adım bir fiziksel kurşun MAKİNESİNE dağıtılmışsa (kurşun bypass) dolu.
   * Bilgi amaçlı: iş kâğıtla yürüyor, kapanışı Tambur yapıyor.
   */
  bypassAssignment?: { machineName: string; assignedAt: string } | null;
  /**
   * TABLET SALT-OKUNUR MU? Non-null ise kurşun tabletinin HİÇBİR yazma yolu
   * çalışmaz (backend `assertKursunTabletMayWrite` ile 409 döner) → ekran tüm
   * aksiyonları gizler ve `reason`'ı basar.
   *
   * İki sebepten doğar: adım makineye dağıtılmış, ya da kurşun dağıtımı bayrağı
   * AÇIK ve adım dağıtıma uygun. Uygun OLMAYAN adımlarda null gelir — o iş
   * tablette işlenmeye devam eder (kurşundan sonra Tambur gelmeyen rotalar
   * çıkmaza girmesin).
   *
   * Eski APK'larda alan gelmez → `undefined` → davranış eskisi gibi kalır.
   * Bu yüzden backend + APK aynı pencerede dağıtılmalı; yoksa tablet yazmaya
   * çalışır ve ham 409 görür.
   */
  tabletReadOnly?: { reason: string } | null;
  rolls: KursunRollSummary[];
}

export interface KursunOpenCard {
  cardId: string;
  cardNumber: string;
  cardBarcode: string;
  workOrderId: string;
  batchNumber: string;
  stepId: string;
  stationName: string;
  stationCode: string;
  openRollCount: number;
  /// Planlamanın atadığı sıra (Electron Kurşun Sırası ile aynı kaynak).
  /// Liste backend tarafında bu alanlara göre sıralanmış gelir.
  priority: number;
  isUrgent: boolean;
  /** Kurşun adımına ilk roll'un giriş tarihi (en eski açık RollMovement.enteredAt) —
   *  liste ekranında "ne zamandır bekliyor" göstergesi için. */
  oldestEnteredAt?: string | null;
}

/** Açık kumaş aç (Kurşun/KK2) — `POST /api/rolls/open-fabric` */
export interface OpenFabricCreateRequest {
  receiptId: string;
  stepId: string;
  notes?: string | null;
}

/** Açık kumaş kapanışı (Kurşun/KK2) — `POST /api/rolls/:id/kursun-finish` */
export interface KursunFinishRequest {
  /** Opsiyonel — backend verilmezse `Roll.currentQty`'yi kullanır. */
  totalMeters?: number;
  errors?: Array<{
    startMeter: number;
    defectTypeId?: string | null;
  }>;
  notes?: string | null;
}

// =============================================================================
// Tambur ekranı
// =============================================================================

export interface TamburRollDefect {
  id: string;
  startMeter: number;
  errorType: string | null;
}

export interface TamburRollSummary {
  rollId: string;
  barcode: string | null;
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  /** Rulonun fiilen taşıdığı özellikler (RollProperty). `value`: SEÇİM tipli
   *  özellikte operatörün seçtiği değer (GRAMAJ=50 gr) — final kararı veren
   *  Tambur operatörü görmeli. Eski backend göndermez → undefined. */
  properties: { id: string; name: string; value?: { code: string; name: string } | null }[];
  errorCount: number;
  errors: TamburRollDefect[];
  /** Parti (Batch) kimliği — null = partisiz/doğrudan top. Bu alanla gruplanır. */
  batchId: string | null;
  /** Parti numarası (Batch.batchNumber, P+GGAAYY+NNNN) — partisiz topta null. */
  batchNumber: string | null;
  /** Partinin iptal edilmemiş en güncel fason sevk numarası
   *  (SubcontractorDispatch.dispatchNo) — sevk görmemiş partide null. */
  dispatchNo: string | null;
  /** WO içindeki 1-based parti sırası (Batch.createdAt'e göre, stabil). */
  branchOrdinal: number | null;
}

export interface TamburStepSummary {
  workOrderStepId: string;
  workOrderId: string;
  batchNumber: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  rolls: TamburRollSummary[];
}

export type TamburDecision = 'CUT' | 'NO_CUT';

export interface TamburErrorDecision {
  errorId: string;
  decision: TamburDecision;
  qualityGrade?: string;
}

export type TamburFoldType = string; // serbest string ("2-KAT" / "4-KAT" / özel)

/** Yeni cumulative-length kesim modeli (backend `cuts[]`). */
export interface TamburCut {
  length: number;
  qualityGrade: string;
  relatedErrorIds?: string[];
}

export interface TamburFinalizeRequest {
  rollId: string;
  decisions: TamburErrorDecision[];
  cuts: TamburCut[];
  foldType?: TamburFoldType;
}

export interface TamburReportErrorRequest {
  rollId: string;
  stepId: string;
  startMeter: number;
  defectTypeId: string;
}


export interface TamburSplitRollLabel {
  id: string;
  barcode: string | null;
  qualityGrade: string;
  currentQty: number;
  width: number | null;
  itemCode?: string;
  itemName?: string;
}

export interface TamburOpenCard {
  cardId: string;
  /** = iş emri numarası (TravelerCard.cardNumber şemada workOrderNumber'dır). */
  cardNumber: string;
  cardBarcode: string;
  workOrderId: string;
  /**
   * ⚠️ ADI YANILTICI: parti değil, İŞ EMRİ NUMARASI taşır
   * (backend `tambur.service.ts` → `batchNumber: s.workOrder.workOrderNumber`).
   * Yani `cardNumber` ile AYNI değerdir; listede ikisini birden basmak iş emri
   * numarasını iki kez yazdırıyordu (2026-08-04'te UI'dan kaldırıldı).
   */
  batchNumber: string;
  stepId: string;
  stationName: string;
  stationCode: string;
  openRollCount: number;
  /** İş emrinin hedef kumaşı/rengi — liste satırında sütun olarak gösterilir. */
  itemName?: string | null;
  colorName?: string | null;
  colorHex?: string | null;
  /** Tambur adımına ilk roll'un giriş tarihi — liste'de "ne zamandır bekliyor". */
  oldestEnteredAt?: string | null;
}

// =============================================================================
// Yeni Tambur context — açık kumaş modeli (boyahane dönüşü)
// =============================================================================

export interface TamburContextOrderLine {
  lineId: string;
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
  width: number | null;
  orderedQty: number;
  /** Sipariş satırı kesim notu ("Kesim notu") — Tambur operatörüne talimat. */
  cutNote?: string | null;
  /** Eşit-parça kesim önerisi (m). NULL = serbest kesim. */
  pieceLengthM?: number | null;
  /** Müşterinin sipariş satırında istediği özellikler (OrderLineRequiredProperty). */
  requiredProperties: { id: string; name: string }[];
}

export interface TamburContextOrder {
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  lines: TamburContextOrderLine[];
}

export interface TamburContextOpenFabricError {
  id: string;
  startMeter: number;
  endMeter: number | null;
  errorType: string | null;
}

export interface TamburContextOpenFabric {
  rollId: string;
  /** Barkodlu top adıma alınmışsa dolu (2026-07-27); açık kumaşta null. */
  barcode: string | null;
  currentQty: number;
  initialQty: number;
  receiptNo: string | null;
  colorCode: string | null;
  colorName: string | null;
  kursunFinishedAt: string | null;
  errors: TamburContextOpenFabricError[];
}

/**
 * Kurşun Dağıtım (bypass) kapanışına giren top — `bypassPending.rolls`.
 * Kapanış çağrısına gidecek `rollIds` KAPSAM sözleşmesinin kaynağıdır (backend
 * kapsam paritesini doğrular: eksik/fazla liste 409).
 */
export interface TamburBypassPendingRoll {
  rollId: string;
  /** Fason dönüşü açık kumaşta barkod henüz yoktur → null olabilir. */
  barcode: string | null;
  currentQty: number;
  receiptNo: string | null;
  colorCode: string | null;
  colorName: string | null;
}

/**
 * Kurşun makinelerinde tablet YOKTUR: iş, Kurşun Dağıtım ekranından fiziksel
 * bir kurşun MAKİNESİNE atanır. Tambur operatörü refakat kartını okuttuğunda bu
 * blok doluysa Kurşun/KK2 adımı `POST /api/tambur/bypass-complete` ile SESSİZCE
 * COMPLETED yapılır (SKIPPED DEĞİL) ve kart normal Tambur işi olarak açılır —
 * operatöre soru SORULMAZ. null = normal akış.
 */
/**
 * Kapanacak kurşun işinin KAYNAĞI (2026-08-06).
 *
 *  • `ASSIGNED`   — planlamacı işi bir kurşun makinesine dağıttı; makine BİLİNİR.
 *  • `UNASSIGNED` — dağıtım hiç yapılmadı (personel unuttu) ama adım bypass'a
 *    uygun. Kapanış yine yapılır, makine atfı bilinmez ve UYDURULMAZ.
 *
 * Eski APK'lar bu alanı görmez ve yalnız `rolls`'u okuduğu için yeni backend'le
 * doğru çalışmaya devam eder — kaybedilen tek şey bilgi metninin ayrıntısıdır.
 */
export type TamburBypassSource = 'ASSIGNED' | 'UNASSIGNED';

export interface TamburBypassPending {
  /** `UNASSIGNED` kaynakta null — ortada atama satırı yoktur. */
  assignmentId: string | null;
  source: TamburBypassSource;
  /** Kurşun/KK2 adımı (WorkOrderStep) — kapanacak olan adım. */
  stepId: string;
  /** İşin ATANDIĞI fiziksel kurşun makinesi; `UNASSIGNED`'da null. */
  machineId: string | null;
  machineName: string | null;
  /** Kurşun/KK2 istasyonu — bağlam bilgisi (tek PROCESS_QC istasyonu). */
  stationId: string;
  stationName: string;
  assignedAt: string | null;
  assignedByName: string | null;
  notes: string | null;
  rollCount: number;
  totalMeters: number;
  rolls: TamburBypassPendingRoll[];
}

export interface TamburContext {
  workOrderId: string;
  batchNumber: string;
  stepId: string;
  stationName: string;
  /** WO planlamasında belirlenen kat tipi — Tambur'a bilgi olarak iletilir. */
  plannedFoldType?: string | null;
  /** WO planlamasında belirlenen katman sayısı (1-20). */
  plannedLayerCount?: number | null;
  /** Tambur adımına yazılan not (WorkOrderStep.notes) — operatöre gösterilir. */
  stepNote?: string | null;
  orders: TamburContextOrder[];
  openFabricRolls: TamburContextOpenFabric[];
  /** Bekleyen Kurşun Dağıtım işi (sessiz bypass kapanışının kapsam kaynağı). */
  bypassPending?: TamburBypassPending | null;
  /**
   * Tambur adımında AÇIK TOP YOK ama kart yine de açıldı — backend bunu yalnız
   * saha düzeltmesi yetkisi olan operatöre yapar (2026-08-03). Ekran bu durumda
   * "bekleyen top yok" bandı basar ve YALNIZ saha düzeltmesini sunar; kesim /
   * finalize aksiyonları anlamsızdır. Yetkisiz operatörde kart zaten açılmaz.
   */
  emptyStep?: boolean;
}

/** `POST /api/tambur/:id/cut` — açık kumaşta tek kesim */
export interface TamburCutRequest {
  lengthMeters: number;
  status: 'WAREHOUSE' | 'SCRAP' | 'A1_STOCK';
  qualityGrade?: string | null;
  notes?: string | null;
  /** Bu kesimin hedef sipariş kalemi (null = stok). Etiket buradan basılır. */
  targetOrderLineId?: string | null;
  /** Bu kesimin hedef müşterisi (sipariş-dışı; null = stok). Backend child'ın
   *  lastLabelSnapshot'ına yazar → yazıcı/ekran bağımsız kalıcı niyet. */
  targetCustomerId?: string | null;
  /** Çıktı top kartelalık işaretlensin (depoda kartela sevki için). */
  markedForKartela?: boolean;
  /**
   * Bu kesimde doğan ÇOCUĞUN katı — topun KALICI özelliği (2026-08-04).
   * Kesim anında seçilen değer kazanır: aynı topun iki parçası farklı kat
   * taşıyabilir. Gönderilmezse backend parent → iş emri planı fallback'i uygular.
   */
  foldType?: string | null;
  /** Offline/ağ-retry idempotency anahtarı (UUID). Barkod sunucuda sıralı atanır;
   *  aynı token'la 2. çağrı backend'de idempotent döner (çift kesim/decrement YOK). */
  clientToken?: string;
}

/** `POST /api/tambur/:id/finalize-open-fabric` — açık kumaşı bitir */
export type TamburFinalizeRemainingAction =
  | "keep_1kalite"
  | "keep_a1"
  | "scrap"
  | "discard";

export interface TamburFinalizeOpenFabricRequest {
  /**
   * Kalan metre (parent.currentQty) için operatör kararı:
   *   - keep_1kalite → 1.KALITE barkodlu top oluştur
   *   - keep_a1      → A1 barkodlu top oluştur
   *   - scrap        → FIRE barkodlu top oluştur (stokta kalır) — mal VARDI
   *   - discard      → KAYIT DÜZELTMESİ: bu metraj fiziksel olarak HİÇ YOKTU
   *
   * ⚠️ `discard`ın eski açıklaması "operatör fiziksel olarak attı" idi ve
   * YANLIŞTI — "atmak" fire demektir. İkisini karıştırmak fire oranını
   * sistematik olarak şişirir (2026-08-09).
   */
  remainingAction?: TamburFinalizeRemainingAction;
  /** Deprecated — `remainingAction` kullan. true ≈ "scrap", false ≈ "discard". */
  scrapRemaining?: boolean;
  notes?: string | null;
  foldType?: string | null;
  layerCount?: number | null;
  /** SAPMA SEBEBİ (2026-08-09) — `constants/varianceReasons.ts` kataloğundan. */
  varianceReasonCode?: string | null;
  varianceReasonText?: string | null;
}

// =============================================================================
// Kalite derecesi kataloğu (admin yönetimli)
// =============================================================================
export interface QualityGrade {
  id: string;
  code: string;
  name: string;
  description: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  targetStatus: RollStatus;
}

// =============================================================================
// Label payload + template
// =============================================================================

export type NameSource = 'OVERRIDE' | 'MASTER' | 'DEFAULT';

export interface LabelPayload {
  rollId: string;
  barcode: string | null;
  status: string;
  qualityGrade: string;
  widthCm: number | null;
  lengthMeters: number;
  weightKg: number | null;
  packagingDate: string | null;

  itemCode: string;
  itemName: string;
  itemNameDefault: string;
  itemNameSource: NameSource;
  colorCode: string | null;
  colorName: string | null;
  colorNameDefault: string | null;
  colorNameSource: NameSource | null;

  customerName: string | null;
  customerId: string | null;
  orderNumber: string | null;
  orderLineId: string | null;

  batchNumber: string | null;
  printedAt: string;
}

export interface SwatchLabelPayload {
  swatchId: string;
  cardNumber: string;
  barcode: string;
  itemCode: string;
  itemName: string;
  itemNameDefault: string;
  itemNameSource: NameSource;
  colorCode: string | null;
  colorName: string | null;
  colorNameDefault: string | null;
  colorNameSource: NameSource | null;
  widthCm: number | null;
  lengthCm: number;
  weightKg: number | null;
  customerName: string | null;
  customerId: string | null;
  orderNumber: string | null;
  orderLineId: string | null;
  batchNumber: string | null;
  parentRollBarcode: string | null;
  printedAt: string;
}

export interface UpdateOrderLineCustomerNamesRequest {
  customerItemName?: string | null;
  customerColorName?: string | null;
}

// === Label Template ===

// ⚠️ Prisma LabelKind enum'undan BAĞIMSIZ — backend'e değer eklemek burayı
// derleme hatasıyla uyarmaz. SACK = çuval etiketi (barkod/QR = Sack.sackNo).
export type LabelKind = 'ROLL_RAW' | 'ROLL_FINISHED' | 'SWATCH' | 'SACK';

export type LabelFontSize = 'sm' | 'md' | 'lg' | 'xl';

export interface LabelFieldDef {
  key: string;
  defaultLabel: string;
  type: 'text' | 'number' | 'date' | 'qr' | 'barcode' | 'table';
  required?: boolean;
}

export interface LabelTemplateField {
  key: string;
  label: string;
  order: number;
  isVisible: boolean;
  isBold?: boolean;
  fontSize?: LabelFontSize;
}

export interface LabelTemplate {
  id: string;
  name: string;
  kind: LabelKind;
  isDefault: boolean;
  isActive: boolean;
  fields: LabelTemplateField[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LabelTemplateCatalog {
  kind: LabelKind;
  fields: LabelFieldDef[];
}

export interface LabelTemplateCreateRequest {
  name: string;
  kind: LabelKind;
  isDefault?: boolean;
  isActive?: boolean;
  fields?: LabelTemplateField[];
}

export interface LabelTemplateUpdateRequest {
  name?: string;
  isDefault?: boolean;
  isActive?: boolean;
  fields?: LabelTemplateField[];
}

// =============================================================================
// Order — mobil "Sipariş" ekranı (liste + detay). Backend `GET /orders`
// `defaultInclude`'u ile birebir: customer, branch ve lines TEK istekte gelir,
// bu yüzden detay için ayrı bir uç çağrılmaz.
//
// ⚠️ Alan kümesi Electron'un `Orders/types.ts`'inin ALT KÜMESİDİR — mobil
// yalnız gösterdiğini tipler. Fiyat (`unitPrice`/`totalAmount`) ve müşteri-adı
// override'ları bilinçli olarak DIŞARIDA: mobil sipariş formu bunları
// yazmıyor, ekran da göstermiyor.
// =============================================================================

export type OrderStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'PARTIAL_SHIPPED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface OrderLine {
  id: string;
  itemId: string;
  colorId: string | null;
  /** İstenen metraj. Prisma Decimal → JSON'da string gelebilir. */
  quantity: number | string;
  width: number | string | null;
  /** Denormalize SEVK toplamı. Açık = quantity − shippedQty (rezerv YOK). */
  shippedQty?: number | string;
  item?: { id: string; code: string; name: string };
  color?: { id: string; code: string; name: string; hex?: string | null } | null;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  branchId: string | null;
  status: OrderStatus;
  orderDate: string;
  deadline: string | null;
  /** Sipariş geneli denormalize sevk toplamı (m). */
  shippedQty?: number | string;
  createdAt?: string;
  customer?: { id: string; code: string; name: string };
  branch?: { id: string; name: string; code?: string | null } | null;
  lines?: OrderLine[];
}
