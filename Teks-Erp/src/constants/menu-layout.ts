// =============================================================================
// MENÜ DÜZENİ (K19, 2026-11-03) — gizlenemez küme · "Gelişmiş" grubu · hazır setler
// =============================================================================
// Fabrika ayarı `ui.menuHiddenScreens` (ekran anahtarı listesi, SCREEN_CATALOG `key`i; desktop + mobile) ve
// `ui.menuAdvancedGroup` (boolean). Gizleme yalnız MENÜDEN kaldırır (hub karosu · komut paleti · tablet karosu);
// doğrudan bağlantı/bildirim açılır — GÜVENLİK SINIRI DEĞİL, izin ayrıdır. Varsayılan: hiçbiri gizli değil,
// Gelişmiş grubu kapalı (= bugünkü menü). Tek yazar `PUT /api/menu-layout` (`services/menu-layout.service.ts`).
// Bekçi: `scripts/test_menu_layout.ts` (küme ⊆ katalog, küme ayrıklığı, yazım 400, eski anahtar yok sayılır).
// =============================================================================

import { SCREEN_CATALOG } from "./screen-catalog";

/** Menü Düzeni ekranının katalog anahtarı (kendisi gizlenemez). */
export const MENU_LAYOUT_SCREEN_KEY = "system/menu-layout";

/**
 * GİZLENEMEZ ekranlar — kilitlenme olmasın: menüyü geri açan ekran, modül/özellik şalterleri, Sistem kökü,
 * kullanıcı/yetki yönetimi. Yazımda 400 `MENU_SCREEN_LOCKED`; panel satırı kilitli + açıklamalı çizer.
 */
export const MENU_UNHIDEABLE_SCREENS: ReadonlyArray<{ key: string; reason: string }> = [
  { key: MENU_LAYOUT_SCREEN_KEY, reason: "Gizlenen ekranları geri açan yer burası." },
  { key: "system", reason: "Sistem kökü — Menü Düzeni ve ayar ekranlarının girişi." },
  { key: "system/module-profile", reason: "Modülleri açıp kapatan ekran." },
  { key: "system/feature-flags", reason: "Fabrika ayarlarının (özellik anahtarları) ekranı." },
  { key: "access", reason: "Yetkilendirme kökü — kullanıcı ve izin yönetiminin girişi." },
  { key: "access/users", reason: "Kullanıcı yönetimi — erişim sorununu çözen ekran." },
];

export const MENU_UNHIDEABLE_KEYS: ReadonlySet<string> = new Set(MENU_UNHIDEABLE_SCREENS.map((s) => s.key));

/**
 * "GELİŞMİŞ" GRUBU — teknik ekranlar (ayar açıksa panelde hub'lardan çıkar, kenar menüde kapalı duran tek
 * "Gelişmiş" grubunda toplanır; kapalıysa bugünkü yerleri). Yalnız masaüstü ekranı.
 */
export const MENU_ADVANCED_SCREENS: readonly string[] = [
  "system/server-status",
  "system/perf",
  "system/clients",
  "system/logs",
  "system/read-only-db",
  "system/data-import",
  "system/db-restore",
  "access/permissions",
];

export interface MenuPresetScreen {
  key: string;
  /** Neden bu firma tipinde menüden kalkar (önizlemede gösterilir). */
  reason: string;
}

export interface MenuPreset {
  id: string;
  /** Firma TİPİ adı — müşteri adı YAZILMAZ (tek gövde, çok fabrika). */
  label: string;
  description: string;
  screens: readonly MenuPresetScreen[];
}

const DOKUMA_YOK = "Dokuma/devere yapılmıyor (modül kapalıysa zaten görünmez).";

/**
 * HAZIR SETLER — firma tipine göre önerilen gizleme listesi. Uygulama ÖNİZLEMELİDİR (gizlenecek her ekran
 * listelenir) ve mevcut listeye EKLENİR. İçerik ölçülerek kuruldu (gerekçe satır başında); kurşun · kalite ·
 * tambur · iş emri · gelen belge · sevkiyat · çuval · cari · fatura · gram fiyatı · etiket · istasyon/makine
 * ekranları BİLEREK dışarıda (bekçi `MENU_PRESET_FORBIDDEN_KEYS` ile ölçer).
 */
export const MENU_PRESETS: readonly MenuPreset[] = [
  {
    id: "fason-hizmet",
    label: "Fason hizmet firması",
    description:
      "Müşterinin malını işleyip geri gönderen firma: dokuma, levent, ham giriş, kartela, dışarıya fason ve iplik ekranları menüden kalkar.",
    screens: [
      { key: "operations/kartela", reason: "Kartela gönderilmiyor (kartela takibi ticari kumaş satışının işi)." },
      { key: "reports/subcontract", reason: "Dışarıya fasona mal gönderilmiyor; fason raporu boş kalır." },
      { key: "definitions/subcontractors", reason: "Dışarıdaki fason firmalara iş verilmiyor; müşteriler Cariler'de." },
      { key: "definitions/subcontractor-categories", reason: "Fason firma kategorileri kullanılmıyor." },
      { key: "definitions/traveler-card", reason: "Refakat kartı kullanılmıyor (iş emri numarası + etiket yeter)." },
      { key: "definitions/traveler-card-studio", reason: "Refakat kartı şablonu gerekmiyor." },
      { key: "cost/yarn-prices", reason: "İplik alınmıyor; maliyet makine saati ve sarf normundan." },
      { key: "cost/yarn-need", reason: "İplik ihtiyacı hesaplanmıyor (dokuma yok)." },
      { key: "operations/purchase-orders", reason: "Ticari mal alınmıyor; sarf mal kabulü siparişsiz yapılabilir." },
      { key: "definitions/warp-specs", reason: DOKUMA_YOK },
      { key: "definitions/weave-designs", reason: DOKUMA_YOK },
      { key: "operations/weaving-orders", reason: DOKUMA_YOK },
      { key: "operations/warp-beams", reason: DOKUMA_YOK },
      { key: "reports/dokuma", reason: DOKUMA_YOK },
      { key: "KK1", reason: "Ham giriş yok — toplar gelen belgeden doğar." },
      { key: "Dokuma", reason: DOKUMA_YOK },
      { key: "Devere", reason: DOKUMA_YOK },
      { key: "FasonDokuma", reason: DOKUMA_YOK },
      { key: "FasonSevk", reason: "Dışarıya fasona mal gönderilmiyor." },
      { key: "FasonKabul", reason: "Dışarıdan fason dönüşü kabul edilmiyor." },
      { key: "KartelaSevk", reason: "Kartela gönderilmiyor." },
      { key: "KartelaKabul", reason: "Kartela kabul edilmiyor." },
    ],
  },
];

/**
 * Hazır sete GİREMEZ ekranlar — firmanın asıl işi (kurşun, kalite, tambur, iş emri, gelen belge, sevkiyat,
 * çuval, cari, fatura, istasyon/makine, etiket). Bekçi set ∩ bu küme = ∅ ölçer.
 */
export const MENU_PRESET_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "KursunQc",
  "KursunDagitim",
  "Tambur",
  "TartiPaket",
  "Sevkiyat",
  "GelenBelge",
  "Muayene",
  "HizliIsEmri",
  "operations/work-orders",
  "operations/kursun-dagitim",
  "operations/kursun-sapmalar",
  "operations/gelen-belgeler",
  "operations/shipments",
  "operations/sack-store",
  "operations/sack-content-edit",
  "definitions/sack-tags",
  "definitions/cariler",
  "definitions/customers",
  "definitions/stations",
  "definitions/machines",
  "definitions/labels",
  "definitions/label-templates",
  "definitions/fabric-properties",
  "finance/invoices",
  "finance/cari",
  "quality",
  "quality/inspections",
]);

const CATALOG_KEYS: ReadonlySet<string> = new Set(SCREEN_CATALOG.map((s) => s.key));

/** Katalogda var mı (desktop + mobile anahtarları tek uzay; çakışma `test_screen_catalog` ile yok). */
export function isCatalogScreenKey(key: string): boolean {
  return CATALOG_KEYS.has(key);
}

/** Okuma süzgeci: katalogda olmayan eski anahtar ve gizlenemez anahtar sessizce düşer; sıra + tekillik korunur. */
export function sanitizeHiddenScreens(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of raw) {
    if (typeof k !== "string" || seen.has(k)) continue;
    if (!CATALOG_KEYS.has(k) || MENU_UNHIDEABLE_KEYS.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
