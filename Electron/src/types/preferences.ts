// Kullanıcı UI tercihleri — backend `UserPreference.preferences` Json blob'unun
// frontend kontratı. Backend gevşek doğrular; şekli burası sahiplenir. Yeni alan
// eklemek migration gerektirmez (sadece bu tip + uygulama mantığı).
//
// SADECE kullanıcıyı takip etmesi gereken tercihler burada. Makineye bağlı
// donanım ayarları (etiket yazıcısı / kantar / tabanca) bilerek DIŞARIDA —
// onlar `@/lib/machine-config` (secure-store, per-machine) içindedir; aksi halde
// aynı hesapla başka bilgisayara girince A'nın COM portu B'ye taşınırdı.

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
  /**
   * İŞ EMRİ tercihleri — KİŞİSEL (kullanıcı bazlı), sistem geneli DEĞİL.
   *
   * Saha isteği: *"iş emri oluştururken son seçilen fasoncu otomatik gelsin;
   * favori geliyor şu an"* → kullanıcı kararı: **açılır-kapanır tercih**, çünkü
   * planlamacılar farklı çalışıyor.
   *
   * ⚠️ Varsayılan `favorite` = BUGÜNKÜ davranış. Yeni davranışı varsayılan
   * yapmak, sahadaki herkesin alışkanlığını habersiz değiştirirdi.
   */
  workOrders?: {
    /** Fason firma varsayılanı: kategorinin favorisi mi, en son seçilen mi. */
    subcontractorDefault?: "favorite" | "lastUsed";
    /**
     * Kategori → en son seçilen firma. `subcontractorDefault: "lastUsed"`
     * seçiliyken okunur; her iş emri kaydında güncellenir.
     *
     * ⚠️ Tercih kapalıyken de YAZILIR — açıldığı an geçmişi olsun diye.
     * Yazmamak, anahtarı çeviren kullanıcıya boş bir hafıza verirdi.
     */
    lastSubcontractorByCategory?: Record<string, string>;
  };
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
  // NOT: `scanner`, `labelPrinter`, `scaleDevice` — makineye bağlı donanım
  // ayarları — bilerek burada DEĞİL. `@/lib/machine-config` (secure-store,
  // per-machine) içindeler; `useMachineConfig` ile okunur/yazılır.
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
  const merged = { ...DEFAULT_PREFERENCES, ...(raw ?? {}) };
  // Geçiş temizliği: makineye özel donanım ayarları artık secure-store'da
  // (machine-config). Eski kullanıcı blob'unda kalmış olabilir — düşür ki bir
  // sonraki kayıtta DB satırından da temizlensin (blob makineler arası sızmasın).
  const legacy = merged as Record<string, unknown>;
  delete legacy.labelPrinter;
  delete legacy.scaleDevice;
  delete legacy.scanner;
  return merged;
}
