// Kullanıcı UI tercihleri — backend `UserPreference.preferences` Json blob'unun
// frontend kontratı. Backend gevşek doğrular; şekli burası sahiplenir. Yeni alan
// eklemek migration gerektirmez (sadece bu tip + uygulama mantığı).

import type { ScannerTransport, ScanTerminatorPref } from "@shared/ipc-contract";

export type ThemePref = "light" | "dark" | "system";
export type DensityPref = "comfortable" | "compact";

export interface SavedView {
  id: string;
  name: string;
  /** URL search string snapshot — search + filter[*] + sortBy/sortOrder + date(+tab). */
  query: string;
}

export interface AppPreferences {
  theme?: ThemePref;
  /** HSL kanalları "H S% L%" (CSS var formatı). null/boş = tema varsayılanı. */
  accent?: string | null;
  density?: DensityPref;
  /** Sidebar favorileri (route listesi). */
  sidebar?: { favorites?: string[] };
  /** Tablo kayıtlı görünümleri — anahtar = sayfa pathname, değer = görünüm listesi. */
  savedViews?: Record<string, SavedView[]>;
  /** Sidebar menü grup-içi sırası — grup adı → route listesi. */
  menuOrder?: Record<string, string[]>;
  /** Tablo sütun sırası — queryKey → sütun id listesi. */
  tableOrder?: Record<string, string[]>;
  /** Tablo sütun görünürlüğü — queryKey → { columnId: visible }. */
  tableVisibility?: Record<string, Record<string, boolean>>;
  /** Sekme sırası — sekme seti anahtarı → sekme key listesi. */
  tabOrder?: Record<string, string[]>;
  /** Hub kart sırası — hub anahtarı (örn "operations") → kart key listesi. */
  hubOrder?: Record<string, string[]>;
  /** Toplar ekranı tercihleri. */
  rolls?: {
    /** Barkod okutunca detay panelini otomatik aç (default açık). Kapalıyken okutma
     *  yalnız listeyi süzer; detay "Aç" butonu veya satıra tıklayarak açılır. */
    openDetailOnScan?: boolean;
  };
  /** Dashboard widget düzeni — gizli widget'lar + grup/öğe sırası. */
  dashboard?: {
    hidden?: string[];
    groupOrder?: string[];
    itemOrders?: Record<string, string[]>;
  };
  /**
   * Barkod tabancası ayarları — bu iş istasyonuna özel (org-geneli değil).
   * `scanAnywhere`: input odaklı değilken global "her yerde okut" yönlendirici.
   * Zamanlama alanları gerçek tabancaya göre ince ayar (genelde dokunulmaz).
   */
  scanner?: {
    scanAnywhere?: boolean;
    terminator?: "Enter" | "Tab" | "both";
    maxInterKeyMs?: number;
    minLength?: number;
    /**
     * Faz-2 — klavye-wedge YAPAMAYAN (seri/HID'e kilitli) tabanca. Bu iş
     * istasyonuna fiziksel bağlı cihaz; opt-in, default kapalı. Donanım okuması
     * Electron ana-süreçte (window.api.scanner); aynı `pushScan` boru hattını besler.
     */
    device?: {
      enabled?: boolean;
      transport?: ScannerTransport;
      path?: string;
      baudRate?: number;
      vendorId?: number;
      productId?: number;
      frameTerminator?: ScanTerminatorPref;
    };
  };
  /**
   * Etiket yazıcısı (Argox) — bu iş istasyonuna özel YEREL tercih (org-geneli
   * değil). Açıkken etiket baskısı OS yazdırma diyaloğu yerine seçili seri/COM
   * porta ham PPLA gönderir (BT-SPP sanal COM veya USB-CDC) → "her seferinde
   * yazdırma ekranı çıkması" sorunu kalkar. Gönderim Electron ana-süreçte
   * (window.api.printer.send). Kapalı/seçilmemişse iframe.print() diyaloğuna düşer.
   */
  labelPrinter?: {
    enabled?: boolean;
    /** "serial" = seri/COM (fabrika, Windows); "cups" = macOS/Linux CUPS kuyruğu
     * (bu Mac'te USB Argox printer-class → seri düğüm açmaz, tek yol budur). */
    transport?: "serial" | "cups";
    /** serial: COM yolu (COM5 / /dev/tty.*); cups: CUPS kuyruk adı (lp -d). */
    path?: string;
    baudRate?: number;
    /** Cihaz Kaydı'ndaki LABEL_PRINTER id'si — seçiliyse native istekler peripheralId
     * taşır; dil/profil/şablon O CİHAZDAN çözülür → global "Etiket yazıcı dili"ne
     * dokunmadan istasyon-özel dil (ör. bu PC Bixolon=ZPL, Argox istasyonları=PPLA). */
    peripheralId?: string;
  };
  /**
   * Sevkiyat kantarı (seri/COM) — bu bilgisayara özel YEREL tercih. Çalışma
   * oturumu modeliyle PC kantarı backend cihaz kaydından çözülmez: kantar bu
   * PC'ye USB/seri bağlıdır, okuma window.api.scale.read (ana süreç) ile.
   * path boşsa geçiş döneminde backend for-device fallback'i denenir (Faz 6'da kalkar).
   */
  scaleDevice?: {
    /** COM yolu (COM3 / /dev/tty.*). Boş = tanımsız. */
    path?: string;
    baudRate?: number;
    /** İstek-cevap komutu (boş = sürekli-yayın; ilk taze satır okunur). */
    pollCommand?: string;
    terminator?: string;
    timeoutMs?: number;
    /** Ondalık hassasiyeti (weight-codec; default 2). */
    decimals?: number;
    /** Ham → kg çarpanı (default 1). */
    factor?: number;
    /** Sahte kg üret (donanımsız test). */
    simulate?: boolean;
  };
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "system",
  accent: null,
  density: "comfortable",
};

export interface AccentPreset {
  key: string;
  label: string;
  /** HSL kanalları — index.css token formatıyla aynı. */
  value: string;
}

/** Hazır vurgu renkleri. "Varsayılan" (accent: null) bunlara ek olarak sunulur. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { key: "indigo", label: "İndigo", value: "243 75% 59%" },
  { key: "violet", label: "Mor", value: "262 83% 58%" },
  { key: "blue", label: "Mavi", value: "217 91% 60%" },
  { key: "cyan", label: "Camgöbeği", value: "199 89% 48%" },
  { key: "teal", label: "Teal", value: "172 66% 45%" },
  { key: "emerald", label: "Yeşil", value: "160 84% 39%" },
  { key: "amber", label: "Amber", value: "38 92% 50%" },
  { key: "orange", label: "Turuncu", value: "25 95% 53%" },
  { key: "rose", label: "Gül", value: "350 89% 60%" },
];

/** Backend'den gelen kısmi/boş objeyi varsayılanlarla birleştirir. */
export function mergePreferences(raw: Partial<AppPreferences> | null | undefined): AppPreferences {
  return { ...DEFAULT_PREFERENCES, ...(raw ?? {}) };
}
