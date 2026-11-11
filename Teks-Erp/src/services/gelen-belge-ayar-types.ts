// Gelen belge ayar ucu görünüm/girdi tipleri — gelen-belge-ayar.service.ts'ten bölündü (dosya boyu tavanı); servis aynı adlarla yeniden verir.
import type { StationVerifySettings } from "./gelen-belge-ayar-istasyon";
import type { AutoWorkOrderPatternlessMode, BatchNumberSourceMode, DesenRenkEslesmeMode, DocumentTotalCheckMode, DuplicateBatchNoMode, DuplicateDocNoMode, HeaderLineMeterSource, IncomingDocEntryMode, IncomingDocFormApprovalMode, MultiPartyWorkOrderMode, PhotoRetentionMode, RouteSuggestionPriority, TabletIeGirisiMode, TanitimGuveniMode, UnreviewedApprovalMode } from "./system-setting.service";

export interface DefaultItemView {
  id: string;
  code: string;
  name: string;
  /** null = top doğurabilir; dolu = neden doğuramaz (pasif, birleşmiş, tür …). */
  problem: string | null;
}

export interface IncomingDocSettings extends StationVerifySettings {
  defaultItem: DefaultItemView | null;
  unreviewedApproval: UnreviewedApprovalMode;
  defaultUnreviewedApproval: UnreviewedApprovalMode;
  /** Onaydan sonra net desen gruplarına iş emri kendiliğinden açılır mı (varsayılan false). */
  autoWorkOrder: boolean;
  /** Rota önerisinin fabrika varsayılanı; null = ayar boş. `problem` dolu = onay anında kullanılmaz (atlanır + neden). */
  defaultRoute: { id: string; name: string; problem: string | null } | null;
  routeSuggestionPriority: RouteSuggestionPriority;
  defaultRouteSuggestionPriority: RouteSuggestionPriority;
  /** El yazısı şüpheli metre oranı K (medyanın 1/K altı ya da K katı üstü); yeni okumaya uygulanır. */
  handwritingOutlierFactor: number;
  defaultHandwritingOutlierFactor: number;
  handwritingOutlierFactorRange: { min: number; max: number };
  /** Tablosuz belgede (ürün sevk fişi) satır metresi/kg kaynağı; yeni okumaya uygulanır. */
  headerLineMeterSource: HeaderLineMeterSource;
  defaultHeaderLineMeterSource: HeaderLineMeterSource;
  /** Okunan şablonun gönderen carisi boş gönderen alanına yazılır mı (varsayılan false). */
  autoSenderFromTemplate: boolean;
  /** Belge geneli beyan (Müşteri MT) farkı: INFO bilgi (onay geçer) | REQUIRE_REASON gerekçe ister. */
  documentTotalCheck: DocumentTotalCheckMode;
  defaultDocumentTotalCheck: DocumentTotalCheckMode;
  /** Gelen belgeden doğan partinin numarası: SERIES seriden (varsayılan) | DOCUMENT taslağın parti no'su (boşsa seri). */
  batchNumberSource: BatchNumberSourceMode;
  defaultBatchNumberSource: BatchNumberSourceMode;
  /** Onay kipi: PER_LINE her satır bir top (varsayılan) | PER_DOCUMENT belge başına tek top. */
  entryMode: IncomingDocEntryMode;
  defaultEntryMode: IncomingDocEntryMode;
  /** İşlem değeri çözülemeyen grupta oto iş emri: SKIP atla (varsayılan) | OPEN hedef değersiz aç. */
  autoWorkOrderPatternless: AutoWorkOrderPatternlessMode;
  defaultAutoWorkOrderPatternless: AutoWorkOrderPatternlessMode;
  /** İş emri formundan okutulan belge: SEPARATE ayrı onay (varsayılan) | WITH_WORK_ORDER iş emri açan kaydeder. */
  formApproval: IncomingDocFormApprovalMode;
  defaultFormApproval: IncomingDocFormApprovalMode;
  multiPartyWorkOrder: MultiPartyWorkOrderMode;
  defaultMultiPartyWorkOrder: MultiPartyWorkOrderMode;
  /** K27 aynı gönderen belge no: BLOCK engelle (varsayılan) | WARN işi süren eşte uyar | ALLOW serbest. */
  duplicateDocNo: DuplicateDocNoMode;
  defaultDuplicateDocNo: DuplicateDocNoMode;
  /** Aynı sahip + müşteri parti no işi süren başka belgede: ALLOW serbest (varsayılan) | WARN uyar | BLOCK engelle. */
  duplicateBatchNo: DuplicateBatchNoMode;
  defaultDuplicateBatchNo: DuplicateBatchNoMode;
  /** İş emri açılınca refakat kartı kendiliğinden yazdırılır mı (varsayılan false). */
  refakatAutoPrint: boolean;
  /** İstasyon tabletinde "Belge okut" ile iş emri bulma (varsayılan false). */
  stationDocLookup: boolean;
  /** Belge fotoğrafı saklama (K28); geçmiş onaylı belgelere de uygulanır. */
  photoRetention: PhotoRetentionMode;
  /** K30 okunan desen/renk: KAPALI (varsayılan) | ONER kayıt önerilir | NOT nota eklenir. */
  desenRenkEslesme: DesenRenkEslesmeMode; defaultDesenRenkEslesme: DesenRenkEslesmeMode;
  /** K30 tablet iş emri girişi: IKISI (varsayılan) | BELGE | TOP. */
  tabletIeGirisi: TabletIeGirisiMode; defaultTabletIeGirisi: TabletIeGirisiMode; tanitimGuveni: TanitimGuveniMode; defaultTanitimGuveni: TanitimGuveniMode;
  defaultPhotoRetention: PhotoRetentionMode;
  /** Bilgisayarda ikinci okuma (okuma servisiyle sunucu OCR); kapalıyken belgeyi yalnız tablet/telefon okur. */
  serverOcrEnabled: boolean; defaultServerOcrEnabled: boolean;
}

export interface IncomingDocSettingsInput {
  /** null = temizle (bugünkü davranışa dön). */
  defaultItemId?: string | null;
  unreviewedApproval?: UnreviewedApprovalMode;
  autoWorkOrder?: boolean;
  /** null = temizle (bugünkü davranış). */
  defaultRouteTemplateId?: string | null;
  routeSuggestionPriority?: RouteSuggestionPriority;
  /** null = temizle (varsayılan oran). */
  handwritingOutlierFactor?: number | null;
  headerLineMeterSource?: HeaderLineMeterSource;
  autoSenderFromTemplate?: boolean;
  documentTotalCheck?: DocumentTotalCheckMode;
  batchNumberSource?: BatchNumberSourceMode;
  entryMode?: IncomingDocEntryMode;
  autoWorkOrderPatternless?: AutoWorkOrderPatternlessMode;
  formApproval?: IncomingDocFormApprovalMode;
  multiPartyWorkOrder?: MultiPartyWorkOrderMode;
  duplicateDocNo?: DuplicateDocNoMode;
  duplicateBatchNo?: DuplicateBatchNoMode;
  refakatAutoPrint?: boolean;
  stationDocLookup?: boolean; stationVerifyThreshold?: number | null;
  photoRetention?: PhotoRetentionMode;
  desenRenkEslesme?: DesenRenkEslesmeMode; tabletIeGirisi?: TabletIeGirisiMode; tanitimGuveni?: TanitimGuveniMode;
  serverOcrEnabled?: boolean;
}
