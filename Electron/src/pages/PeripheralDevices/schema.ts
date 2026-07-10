import { z } from "zod";

// Form alanları düz string ("" = boş); ""→null dönüşümü buildPayload'da.
export const peripheralFormSchema = z.object({
  code: z.string().trim().min(1, "Kod gerekli").max(48),
  name: z.string().trim().min(1, "Ad gerekli").max(100),
  kind: z.enum(["LABEL_PRINTER", "SCALE", "METER", "SIGNAL_SOURCE"]),
  connectionType: z.enum(["NETWORK_TCP", "BLUETOOTH_SPP", "BLE", "USB", "SERIAL_COM"]),
  address: z.string().trim().max(128).optional().default(""),
  port: z.string().trim().optional().default(""),
  identifyPattern: z.string().trim().max(255).optional().default(""),
  // Giriş cihazı (SCALE/METER) protokolü
  readMode: z.enum(["POLL", "STREAM"]).optional().default("POLL"),
  pollCommand: z.string().trim().max(64).optional().default(""),
  terminator: z.string().max(8).optional().default(""),
  decimals: z.string().trim().optional().default(""),
  scale: z.string().trim().optional().default(""),
  unit: z.string().trim().max(8).optional().default(""),
  timeoutMs: z.string().trim().optional().default(""),
  role: z.string().trim().max(24).optional().default(""),
  simulate: z.boolean().optional().default(false),
  // "device" (tablete bağlı) YENİ seçimlerde sunulmaz — yalnız eski kayıtların
  // round-trip'i için parse edilir (çalışma oturumu modeli: donanım YERE bağlanır).
  owner: z.enum(["none", "machine", "station", "device"]),
  machineId: z.string().optional().default(""),
  stationId: z.string().optional().default(""),
  deviceId: z.string().optional().default(""),
  languageOverride: z.string().optional().default(""),
  // Baskı yöntemi (ribon): "" = otomatik, DIRECT_THERMAL = ribonsuz, THERMAL_TRANSFER = ribonlu.
  mediaType: z.string().optional().default(""),
  // Yazıcı medyası (mm/dpi) — form alanları düz string, "" = boş (sistem varsayılanı).
  labelWidthMm: z.string().trim().optional().default(""),
  labelHeightMm: z.string().trim().optional().default(""),
  labelDpi: z.string().trim().optional().default(""),
  labelGapMm: z.string().trim().optional().default(""),
  templateRawId: z.string().optional().default(""),
  templateFinishedId: z.string().optional().default(""),
  templateSwatchId: z.string().optional().default(""),
  notes: z.string().trim().max(500).optional().default(""),
  // isActive formdan YÖNETİLMEZ — aktiflik yalnız Pasife Al / Aktifleştir /
  // Kalıcı Sil aksiyonlarından (users kalıbı, f76f855 ile aynı gerekçe).
}).superRefine((v, ctx) => {
  // Yazıcının dili kendi kartında ZORUNLU — boş bırakılırsa globalden sürpriz
  // etkilenir (backend de enforce eder; buradaki kural anlık form hatası için).
  if (v.kind === "LABEL_PRINTER" && !v.languageOverride.trim()) {
    ctx.addIssue({ code: "custom", path: ["languageOverride"], message: "Yazıcı dili seçin" });
  }
  // Yazıcı medyası — opsiyonel (boş → sistem varsayılanı), ama girilmişse sınırlı.
  // Backend peripheral.service.validateRefs aynı aralıkları enforce eder.
  const range = (
    field: "labelWidthMm" | "labelHeightMm" | "labelDpi" | "labelGapMm",
    min: number,
    max: number,
    integer: boolean,
    message: string,
  ) => {
    const raw = v[field].trim();
    if (!raw) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
      ctx.addIssue({ code: "custom", path: [field], message });
    }
  };
  range("labelWidthMm", 10, 500, false, "Etiket eni 10-500 mm arası olmalı");
  range("labelHeightMm", 10, 500, false, "Etiket boyu 10-500 mm arası olmalı");
  range("labelDpi", 50, 1200, true, "DPI 50-1200 arası tam sayı olmalı");
  range("labelGapMm", 0, 50, false, "Boşluk 0-50 mm arası olmalı");
});

export type PeripheralFormValues = z.infer<typeof peripheralFormSchema>;

const nn = (v: string) => (v.trim() ? v.trim() : null);
const num = (v: string) => (v.trim() ? Number(v) : null);

// Form → API payload. Sahiplik owner'a göre tek alan; templateRoutes 3-kind array
// (backend setTemplateRoute ile uygular, boş templateId → kaldır).
export function buildPeripheralPayload(v: PeripheralFormValues) {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    kind: v.kind,
    connectionType: v.connectionType,
    address: nn(v.address),
    port: v.port.trim() ? Number(v.port) : null,
    identifyPattern: nn(v.identifyPattern),
    readMode: v.readMode,
    pollCommand: nn(v.pollCommand),
    terminator: v.terminator ? v.terminator : null,
    decimals: v.decimals.trim() ? Number(v.decimals) : null,
    scale: v.scale.trim() ? Number(v.scale) : null,
    unit: nn(v.unit),
    timeoutMs: v.timeoutMs.trim() ? Number(v.timeoutMs) : null,
    role: nn(v.role),
    simulate: v.simulate,
    machineId: v.owner === "machine" ? nn(v.machineId) : null,
    // Yalnız MAKİNESİZ istasyon (backend enforce eder — SHIPPING kantarı gibi).
    stationId: v.owner === "station" ? nn(v.stationId) : null,
    deviceId: v.owner === "device" ? nn(v.deviceId) : null,
    // Yazıcı alanları yalnız LABEL_PRINTER'da anlamlı; metre/kantar'da temizle.
    // formatProfileId DEPRECATED — gönderilmez; medya artık 4 alanda (mm/dpi).
    languageOverride: v.kind === "LABEL_PRINTER" ? nn(v.languageOverride) : null,
    mediaType: v.kind === "LABEL_PRINTER" ? nn(v.mediaType) : null,
    labelWidthMm: v.kind === "LABEL_PRINTER" ? num(v.labelWidthMm) : null,
    labelHeightMm: v.kind === "LABEL_PRINTER" ? num(v.labelHeightMm) : null,
    labelDpi: v.kind === "LABEL_PRINTER" ? num(v.labelDpi) : null,
    labelGapMm: v.kind === "LABEL_PRINTER" ? num(v.labelGapMm) : null,
    notes: nn(v.notes),
    templateRoutes: [
      { kind: "ROLL_RAW", templateId: nn(v.templateRawId) },
      { kind: "ROLL_FINISHED", templateId: nn(v.templateFinishedId) },
      { kind: "SWATCH", templateId: nn(v.templateSwatchId) },
    ],
  };
}

export const peripheralFormDefaults: PeripheralFormValues = {
  code: "",
  name: "",
  kind: "LABEL_PRINTER",
  connectionType: "NETWORK_TCP",
  address: "",
  port: "",
  identifyPattern: "",
  readMode: "POLL",
  pollCommand: "",
  terminator: "",
  decimals: "",
  scale: "",
  unit: "",
  timeoutMs: "",
  role: "",
  simulate: false,
  owner: "none",
  machineId: "",
  stationId: "",
  deviceId: "",
  languageOverride: "",
  mediaType: "",
  labelWidthMm: "",
  labelHeightMm: "",
  labelDpi: "",
  labelGapMm: "",
  templateRawId: "",
  templateFinishedId: "",
  templateSwatchId: "",
  notes: "",
};
