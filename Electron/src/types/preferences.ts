// Kullanıcı UI tercihleri — backend `UserPreference.preferences` Json blob'unun
// frontend kontratı. Backend gevşek doğrular; şekli burası sahiplenir. Yeni alan
// eklemek migration gerektirmez (sadece bu tip + uygulama mantığı).

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
  /** Dashboard widget düzeni — gizli widget'lar + grup/öğe sırası. */
  dashboard?: {
    hidden?: string[];
    groupOrder?: string[];
    itemOrders?: Record<string, string[]>;
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
