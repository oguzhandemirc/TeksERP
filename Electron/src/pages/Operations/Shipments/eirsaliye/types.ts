// Backend `/api/e-irsaliye` yanıt şekilleri (E5 servis + E7 liste aynası). TCKN yalnız
// pencerede düzenlenir; kartta maskelenir.
import type { EIrsaliyeEventType, EIrsaliyeStatus } from "@/types/enums";

export type EIrsaliyeAdapterCode = "disaAktar" | "simulasyon" | (string & {});

export interface EIrsaliyeReadiness {
  durum: "HAZIR" | "YAPILANDIRILMAMIS";
  eksikler: string[];
}

/** Taşıma + alıcı kişi alanları (PATCH / prepare gövdesi). */
export interface EIrsaliyeFields {
  licensePlate?: string | null;
  trailerPlate?: string | null;
  driverFirstName?: string | null;
  driverFamilyName?: string | null;
  driverNationalId?: string | null;
  carrierName?: string | null;
  carrierTaxId?: string | null;
  recipientFirstName?: string | null;
  recipientFamilyName?: string | null;
}

export interface EIrsaliyeRecord extends Required<EIrsaliyeFields> {
  id: string;
  shipmentId: string | null;
  status: EIrsaliyeStatus;
  documentNo: string | null;
  ettn: string | null;
  confirmedNo: string | null;
  confirmedEttn: string | null;
  adapter: EIrsaliyeAdapterCode;
  simulasyon: boolean;
  sentAt: string | null;
  responseAt: string | null;
  responseNote: string | null;
  lastDownloadedAt: string | null;
  downloadCount: number;
  replacesId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EIrsaliyeEvent {
  id: string;
  type: EIrsaliyeEventType;
  fromStatus: EIrsaliyeStatus | null;
  toStatus: EIrsaliyeStatus;
  note?: string | null;
  createdAt: string;
}

export interface EIrsaliyeXmlVersion {
  id: string;
  version: number;
  ettn: string;
  sha256: string;
  createdAt: string;
}

export interface EIrsaliyeRecordView extends EIrsaliyeRecord {
  kaynakDegisti: boolean;
  olaylar: EIrsaliyeEvent[];
  xmlSurumleri: EIrsaliyeXmlVersion[];
}

export interface ShipmentEIrsaliye {
  shipmentId: string;
  ihracat: boolean;
  hazirlik: EIrsaliyeReadiness;
  aktifIrsaliye: { version: number; status: string } | null;
  canli: EIrsaliyeRecordView | null;
  gecmis: EIrsaliyeRecordView[];
}

export interface EIrsaliyeDownload {
  dosyaAdi: string;
  version: number;
  ettn: string;
  sha256: string;
  xml: string;
  simulasyon: boolean;
}

export interface EIrsaliyePreview {
  kayit: EIrsaliyeRecord;
  etkiler: string[];
  engel: string | null;
  islem?: "undo-sent" | "undo-response" | null;
}

export type EIrsaliyeResponseStatus = "KABUL" | "KISMI_KABUL" | "REDDEDILDI" | "HATA";

/** `EIRSALIYE_VALIDATION` hata ayrıntısındaki tek satır (alan alan). */
export interface EIrsaliyeValidationIssue {
  field: string;
  message: string;
}

/** Kayıtlar listesi satırı (`GET /api/e-irsaliye`). */
export interface EIrsaliyeListItem {
  id: string;
  status: EIrsaliyeStatus;
  documentNo: string | null;
  ettn: string | null;
  confirmedNo: string | null;
  adapter: EIrsaliyeAdapterCode;
  simulasyon: boolean;
  shipmentId: string | null;
  sentAt: string | null;
  responseAt: string | null;
  downloadCount: number;
  createdAt: string;
  updatedAt: string;
  shipment: { shipmentNo: string; dispatchedAt: string | null; customer: { name: string } } | null;
}

export interface EIrsaliyeSummary {
  total: number;
  byStatus: Partial<Record<EIrsaliyeStatus, number>>;
}
