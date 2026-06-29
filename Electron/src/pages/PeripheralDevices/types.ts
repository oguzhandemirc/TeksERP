/**
 * Birleşik cihaz kaydı — yazıcılar (ağ/Bluetooth/USB/seri) + tekstil makine
 * sinyal kaynakları (kantar/metraj, kayıt-only). Her cihaz dil/profil/şablon
 * yönlendirmesini taşır; baskı anında backend cihaz→{dil,profil,şablon} çözer.
 */
export type ConnectionType = "NETWORK_TCP" | "BLUETOOTH_SPP" | "BLE" | "USB" | "SERIAL_COM";
export type PeripheralKind = "LABEL_PRINTER" | "SCALE" | "METER" | "SIGNAL_SOURCE";
export type PrinterLanguage = "RASTER_HTML" | "PPLA" | "PPLB" | "ZPL";
export type RouteLabelKind = "ROLL_RAW" | "ROLL_FINISHED" | "SWATCH";

export interface PeripheralTemplateRouteRef {
  kind: RouteLabelKind;
  templateId: string;
  template?: { id: string; name: string } | null;
}

export interface PeripheralDevice {
  id: string;
  code: string;
  name: string;
  kind: PeripheralKind;
  connectionType: ConnectionType;
  address: string | null;
  port: number | null;
  identifyPattern: string | null;
  machineId: string | null;
  deviceId: string | null;
  printerModelId: string | null;
  formatProfileId: string | null;
  languageOverride: PrinterLanguage | null;
  isActive: boolean;
  lastSeenAt: string | null;
  notes: string | null;
  machine?: { id: string; code: string; name: string } | null;
  device?: { id: string; name: string } | null;
  printerModel?: { id: string; code: string; name: string; language: PrinterLanguage } | null;
  formatProfile?: { id: string; code: string; name: string } | null;
  templateRoutes?: PeripheralTemplateRouteRef[];
  createdAt: string;
  updatedAt: string;
}

export const connectionTypeLabels: Record<ConnectionType, string> = {
  NETWORK_TCP: "Ağ (TCP 9100)",
  BLUETOOTH_SPP: "Bluetooth (SPP)",
  BLE: "Bluetooth LE",
  USB: "USB",
  SERIAL_COM: "Seri (COM)",
};

export const peripheralKindLabels: Record<PeripheralKind, string> = {
  LABEL_PRINTER: "Etiket Yazıcısı",
  SCALE: "Kantar",
  METER: "Metraj",
  SIGNAL_SOURCE: "Sinyal Kaynağı",
};
