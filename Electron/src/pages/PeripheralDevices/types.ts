/**
 * Birleşik cihaz kaydı — yazıcılar (ağ/Bluetooth/USB/seri) + tekstil makine
 * sinyal kaynakları (kantar/metraj, kayıt-only). Her cihaz dil/medya/şablon
 * yönlendirmesini taşır; baskı anında backend cihaz→{dil,medya,şablon} çözer.
 */
export type ConnectionType = "NETWORK_TCP" | "BLUETOOTH_SPP" | "BLE" | "USB" | "SERIAL_COM";
export type PeripheralKind = "LABEL_PRINTER" | "SCALE" | "METER" | "SIGNAL_SOURCE";
export type PrinterLanguage = "RASTER_HTML" | "PPLA" | "PPLB" | "ZPL";
/** Okuma davranışı (kantar/metre): POLL=komut yolla+cevabı oku · STREAM=sürekli yayın dinle. */
export type PeripheralReadMode = "POLL" | "STREAM";
/** Yönlendirme BAĞLAMI (baskı anındaki iş bağlamı) — şablonun kimliği DEĞİL.
 *  Etiket Stüdyosu v2 tek-havuz modeli: her bağlama havuzdaki HERHANGİ bir
 *  şablon atanabilir (LabelTemplate.kind yalnız legacy bilgi, null olabilir). */
export type RouteLabelKind = "ROLL_RAW" | "ROLL_FINISHED" | "SWATCH" | "SACK";

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
  // Giriş cihazı (SCALE/METER) okuma protokolü
  readMode: PeripheralReadMode;
  pollCommand: string | null;
  terminator: string | null;
  decimals: number | null;
  scale: number | string | null;
  unit: string | null;
  timeoutMs: number | null;
  role: string | null;
  simulate: boolean;
  machineId: string | null;
  /** MAKİNESİZ istasyona sabit donanım (SHIPPING kantarı vb.) — çalışma oturumu modeli. */
  stationId: string | null;
  deviceId: string | null;
  languageOverride: PrinterLanguage | null;
  /** Baskı yöntemi (ribon): null = otomatik; baskıda dile göre komuta çevrilir. */
  mediaType: "DIRECT_THERMAL" | "THERMAL_TRANSFER" | null;
  /** Raster baskı: kanvas-varyantlı etiket 1bpp bitmap (raster) gönderilir → önizleme=
   *  baskı birebir; false = bugünkü komut üretimi. Yalnız LABEL_PRINTER'da anlamlı. */
  rasterMode: boolean;
  // Yazıcı MEDYASI (Etiket Stüdyosu v2 — boyut artık doğrudan cihazda; "Boyutlar"
  // / LabelFormatProfile kataloğu emekli). Yalnız LABEL_PRINTER'da anlamlı, boş
  // (null) → sistem varsayılan medyası kullanılır. Decimal alanlar JSON'da number.
  labelWidthMm: number | null;
  labelHeightMm: number | null;
  labelDpi: number | null;
  labelGapMm: number | null;
  isActive: boolean;
  lastSeenAt: string | null;
  notes: string | null;
  machine?: { id: string; code: string; name: string } | null;
  station?: { id: string; code: string; name: string; kind: string } | null;
  device?: { id: string; name: string } | null;
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

export const peripheralReadModeLabels: Record<PeripheralReadMode, string> = {
  POLL: "Sorgu — komut yolla, cevabı oku",
  STREAM: "Yayın — cihaz sürekli akıtır, dinle",
};
