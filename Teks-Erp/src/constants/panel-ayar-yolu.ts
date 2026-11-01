// =============================================================================
// PANEL AYAR YOLU — kullanıcıya dönen "şuradan açılır" cümlelerinin TEK kaynağı
// =============================================================================
// Panelin ayar kataloğunun (Electron `pages/GeneralSettings/settings-config.ts`: ekran adı ·
// kategori adı · ayar satırı başlığı) aynası. Mesaj menü yolunu elle yazmaz; menü bölünüp adı
// değişince eski cümle yalan söyler. `test_ayar_yol_tarifi` bu tabloyu panel kataloğuyla bayt
// bayt karşılaştırır ve backend dizgelerinde elle yazılmış yolu yasaklar.
// =============================================================================
import { yolBicimle } from "./panel-ekran-yolu";

/** Ayar ekranı (panel kategori kimliği) → menü yolu (`settingsCategoryTrail`). */
export const PANEL_SETTING_SCREEN = {
  modules: "Sistem → Modüller",
  demo: "Sistem → Modüller",
  shipping: "Sistem → Özellik Anahtarları → Sevkiyat & İade",
  devere: "Sistem → Özellik Anahtarları → Devere / Levent",
  production: "Sistem → Özellik Anahtarları → Üretim — Saha",
  tezgah: "Sistem → Özellik Anahtarları → Tezgah izleme",
  warehouse: "Sistem → Özellik Anahtarları → Mal Kabul & Alış",
  yarn: "Sistem → Özellik Anahtarları → İplik",
  finance: "Sistem → Özellik Anahtarları → Muhasebe",
  session: "Sistem → Şirket & Güvenlik → Oturum & Güvenlik",
  company: "Sistem → Şirket & Güvenlik → Şirket Bilgileri",
  "e-irsaliye": "Sistem → Şirket & Güvenlik → e-İrsaliye",
  belgeler: "Sistem → Baskı & Cihazlar → Belgeler",
  "gelen-belge": "Sistem → Özellik Anahtarları → Gelen Belge",
  orders: "Sistem → Özellik Anahtarları → Siparişler",
} as const;

export type PanelSettingScreen = keyof typeof PANEL_SETTING_SCREEN;

/** Ayar satırı (panel `flags[].key`) → bulunduğu ekran ve satır başlığı. */
export const PANEL_SETTING_ROW = {
  tezgahAlarmEnabled: { ekran: "tezgah", baslik: "Tezgah alarmı" },
  documentDesignerEnabled: { ekran: "belgeler", baslik: "Belge tasarımcısı" },
  shipmentUndoSameDayOnly: { ekran: "shipping", baslik: "Sevk geri almayı aynı günle sınırla" },
  shipmentManualSackCountEnabled: { ekran: "shipping", baslik: "Çuval sayısını elle gir" },
  devereMountTracking: { ekran: "devere", baslik: "Levent tezgah bağı defteri" },
  yarnBlockNegativeBalanceEnabled: { ekran: "yarn", baslik: "İplik stoğu eksi bakiyeye düşemesin" },
  goodsReceiptRequirePriceEnabled: { ekran: "warehouse", baslik: "Mal kabul satırında birim fiyat zorunlu olsun" },
  purchaseBlockOverReceiptEnabled: { ekran: "warehouse", baslik: "Siparişten fazla mal kabulünü engelle" },
  financeRiskLimitBlockEnabled: { ekran: "finance", baslik: "Risk limiti aşımında satış faturası onayını engelle" },
  financeRiskLimitBlockIntake: { ekran: "finance", baslik: "Risk limiti aşımında yeni iş kabulünü engelle" },
  financeRiskLimitBlockShipment: { ekran: "finance", baslik: "Risk limiti aşımında sevki engelle" },
  financeRiskLimitCurrencyMode: { ekran: "finance", baslik: "Risk limiti para birimi" },
  financeYarnOutOnInvoiceEnabled: { ekran: "finance", baslik: "Satış faturası onayında iplik stoktan düşsün" },
  financeFutureDatedDocumentBlockEnabled: { ekran: "finance", baslik: "İleri tarihli mali belgeyi engelle" },
  financeExpenseAllocationField: { ekran: "finance", baslik: "Masrafı makineye / işe bağlama" },
  financeAutoAllocateOnPaymentEnabled: { ekran: "finance", baslik: "Tahsilat/ödemeyi en eski faturalara otomatik kapat (FIFO)" },
  orderProductionProposal: { ekran: "orders", baslik: "Siparişten üretim önerisi" },
} as const satisfies Record<string, { ekran: PanelSettingScreen; baslik: string }>;

export type PanelSettingRow = keyof typeof PANEL_SETTING_ROW;

/** "Sistem → Özellik Anahtarları → Tezgah izleme" */
export function settingScreenPath(ekran: PanelSettingScreen): string {
  return PANEL_SETTING_SCREEN[ekran];
}

/** 'Sistem → Özellik Anahtarları → Tezgah izleme → "Tezgah alarmı"' */
export function settingRowPath(satir: PanelSettingRow): string {
  const s = PANEL_SETTING_ROW[satir];
  return yolBicimle([PANEL_SETTING_SCREEN[s.ekran], `"${s.baslik}"`]);
}
