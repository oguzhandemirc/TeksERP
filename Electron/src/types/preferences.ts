// Kullanıcı UI tercihleri — backend `UserPreference.preferences` Json blob'unun
// frontend kontratı. Backend gevşek doğrular; şekli burası sahiplenir. Yeni alan
// eklemek migration gerektirmez (sadece bu tip + uygulama mantığı).
//
// SADECE kullanıcıyı takip etmesi gereken tercihler burada. Makineye bağlı
// donanım ayarları (etiket yazıcısı / kantar / tabanca) bilerek DIŞARIDA —
// onlar `@/lib/machine-config` (secure-store, per-machine) içindedir; aksi halde
// aynı hesapla başka bilgisayara girince A'nın COM portu B'ye taşınırdı.

import type { Appearance } from "@/lib/theme/appearance";

export type ThemePref = "light" | "dark" | "system";
/** ESKİ yoğunluk alanı — yalnız göçte okunur (`lib/theme/appearance.ts`); yeni yazım `appearance.density`. */
export type DensityPref = "comfortable" | "compact";

export interface SavedView {
  id: string;
  name: string;
  /** URL search string snapshot — search + filter[*] + sortBy/sortOrder + date(+tab). */
  query: string;
}

export interface AppPreferences {
  theme?: ThemePref;
  /** ESKİ vurgu rengi (HSL kanalı) — yalnız göçte okunur; görünüm değişince null yazılır. */
  accent?: string | null;
  /** ESKİ yoğunluk — yalnız göçte okunur. */
  density?: DensityPref;
  /** Kişiselleştirme (tema, menü, zemin, köşe, yoğunluk, yazı, simge) — şekli ve doğrulaması
   *  `lib/theme/appearance.ts` (`resolveAppearance`) sahiplenir; okurken süzülür. */
  appearance?: Partial<Appearance>;
  /** Sidebar favorileri (route listesi). */
  sidebar?: { favorites?: string[] };
  /** Tablo kayıtlı görünümleri — anahtar = sayfa pathname, değer = görünüm listesi. */
  savedViews?: Record<string, SavedView[]>;
  /** Sidebar menü grup-içi sırası — grup adı → route listesi. */
  menuOrder?: Record<string, string[]>;
  /** Tablo sütun sırası — queryKey → sütun id listesi. */
  tableOrder?: Record<string, string[]>;
  /** Liste filtre kaydı — tablo anahtarı → son kullanılan süzgeç + sıralama (arama hariç; hazır tarih
   *  göreli `datePreset`). Şekli `filter-row/filter-persist.ts` sahiplenir ve okurken süzer. */
  tableFilters?: Record<string, { query: string; savedAt: string }>;
  /** Filtre satırı kutu görünürlüğü — sayfa (pathname ya da `viewKey`) → { filtreId: görünür } yalnız
   *  sayfa varsayılanından sapanlar; şekli `filter-row/filter-visibility.ts` sahiplenir ve okurken süzer. */
  filterRowVisibility?: Record<string, Record<string, boolean>>;
  /** Tablo sütun genişliği (px, elle) — queryKey → { columnId: px }; yalnız sürüklenen sütunlar. */
  tableSizing?: Record<string, Record<string, number>>;
  /** Tablo sütun görünürlüğü — queryKey → { columnId: visible }. */
  tableVisibility?: Record<string, Record<string, boolean>>;
  /** Sekme sırası — sekme seti anahtarı → sekme key listesi. */
  tabOrder?: Record<string, string[]>;
  /** Sekme davranışı — `tab-open-mode.ts` okur; yok/bilinmeyen = "newTab" (bugünkü davranış). */
  tabs?: { openMode?: "newTab" | "sameTab" };
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
  /** Siparişler ekranı tercihleri. */
  orders?: {
    /**
     * Özet şeridinin görünüm modu. Tema/renk gibi kullanıcıyı takip eder:
     * aynı kişi başka bilgisayara girince kendi düzenini bulur.
     *   sade     — adet + durum rozetleri
     *   onerilen — + istenen/sevk/açık metraj + geciken (varsayılan)
     *   genis    — + iş emri yok, bu hafta terminli, tutar
     */
    statsView?: "sade" | "onerilen" | "genis";
    /** "Excel (stok kalemi bazında)" modalının son seçimi — şekli `stock-line-export/options.ts`
     *  sahiplenir ve okurken süzer (bozuk/eski → varsayılan); burada bilerek `unknown`. */
    stockLineExport?: unknown;
  };
  /** Tezgah alarmı — kişisel tercih (aynı kişi başka bilgisayarda da aynı ayarı bulur). */
  loomAlarm?: {
    /** Yeni alarmda / tekrar çalmada ses (varsayılan AÇIK; şerit ve bildirim sesten bağımsız). */
    sound?: boolean;
  };
  /**
   * Bildirim — N3 masaüstü seçimi (ESKİ anahtar). N4-MOTOR'dan beri doğruluk `notification_preferences`
   * (MASAUSTU kanalı); bu anahtar BİR SÜRÜM birleşimle okunur, ilk yazımda tabloya taşınır ve yalnız
   * seçili kalanlarla budanır (`lib/bildirim/masaustu-tercih.ts`). Sonraki sürümde okuyucusu kalkar.
   */
  bildirim?: { masaustuTurler?: string[] };
  /** Rapor Merkezi (Raporlar v2) — favori rapor anahtarları ("sales/termin"); tablo YOK, blob alanı. */
  raporlar?: { favoriler?: string[] };
  /** Açılış panosu — seçili dönem (`bugun|hafta|ay|yil`; tanınmayan → bugün). Eski pano düzeni alanları
   *  (`hidden`/`groupOrder`/`itemOrders`) kayıtlı blob'da kalabilir; okunmaz. */
  dashboard?: { donem?: string };
  // NOT: `scanner`, `labelPrinter`, `scaleDevice` — makineye bağlı donanım
  // ayarları — bilerek burada DEĞİL. `@/lib/machine-config` (secure-store,
  // per-machine) içindeler; `useMachineConfig` ile okunur/yazılır.
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "system",
};

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
