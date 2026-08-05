export type MobilePermission =
  | 'mobile:kk1'
  | 'mobile:kk2-kursun'
  | 'mobile:tambur'
  | 'mobile:depo'
  | 'mobile:tarti-paket'
  | 'mobile:sevkiyat'
  | 'mobile:fason-sevk'
  | 'mobile:fason-kabul'
  | 'mobile:kartela-sevk'
  | 'mobile:kartela-kabul'
  | 'mobile:iade'
  | 'mobile:hizli-is-emri'
  // Telefondan sipariş LİSTELEME + AÇMA. Backend'de `order:read` + `order:write`'ın
  // DAR mobil ikizi: yalnız okuma ve yaratma uçlarında kabul edilir —
  // düzenleme/iptal/silme hâlâ `order:write` ister.
  | 'mobile:siparis'
  // Telefondan KUMAŞ TANIMI ekleme. `item:write`ten AYRI (o, web'de düzenleme +
  // pasifleştirmeyi de açar); KK1-içi `mobile:kk1-desen`den de ayrı (o yalnız ad
  // alıp `pendingReview` işaretleyen hızlı desen açmadır).
  | 'mobile:kumas'
  // Kurşun Dağıtım ekranı — web ikizi `workorder:distribute` (backend uçları
  // requireAnyPermission ile ikisini de kabul eder).
  | 'mobile:kursun-dagitim'
  // Ekran değil, KK1-içi yetenek: seçili operatöre inline yeni desen oluşturma.
  | 'mobile:kk1-desen'
  // Ekran değil, Tambur-içi yetenek: saha düzeltmesi (mevcut topu Tambur adımına
  // al + sistemde olmayan topu elle ekle). Varsayılan operatör paketinde YOKTUR;
  // panelden SEÇİLİ Tambur operatörüne verilir. Backend uçları bunu ya da
  // süpervizör yetkisi `roll:manual-adjust`'ı kabul eder (requireAnyPermission).
  | 'mobile:tambur-duzelt'
  | 'mobile:*';

/**
 * Etiket sistemi (Refactor 6 + 7) yetkileri. Backend `requirePermission` ile
 * istiyor; mobil ekranlar UI gating için kontrol eder.
 *   label:read    → etiket payload'unu görüntüleme + template fetch
 *   label:print   → POST /labels/rolls/:id/print (audit izi)
 *   label:edit    → PATCH /labels/order-lines/:id (müşteri-isim override)
 *   label-template:read  → template listele + catalog
 *   label-template:write → template oluştur/güncelle/default değiştir/pasifleştir
 */
export type LabelPermission =
  | 'label:read'
  | 'label:print'
  | 'label:edit'
  | 'label-template:read'
  | 'label-template:write';

export type MobileScreenKey =
  | 'KK1'
  | 'KursunQc'
  | 'Tambur'
  | 'Depo'
  | 'TartiPaket'
  | 'Sevkiyat'
  | 'FasonSevk'
  | 'FasonKabul'
  | 'KartelaSevk'
  | 'KartelaKabul'
  | 'IadeGirisi'
  | 'HizliIsEmri'
  | 'Siparis'
  | 'Kumas'
  | 'KursunDagitim';

export interface MobileScreenMeta {
  key: MobileScreenKey;
  permission: Exclude<MobilePermission, 'mobile:*'>;
  label: string;
  icon: string;
  description: string;
}

export const MOBILE_SCREENS: MobileScreenMeta[] = [
  {
    key: 'KK1',
    permission: 'mobile:kk1',
    label: 'Ham Giriş',
    icon: 'package-variant-plus',
    description: 'Ham mal kabul, ölçüm ve etiketleme',
  },
  {
    key: 'KursunQc',
    permission: 'mobile:kk2-kursun',
    label: 'Kurşun',
    icon: 'magnify-scan',
    description: 'Hata tespiti ve metraj girişi',
  },
  {
    key: 'Tambur',
    permission: 'mobile:tambur',
    label: 'Tambur',
    icon: 'circle-slice-8',
    description: 'Kesim kararı, fire/A1 değerlendirme',
  },
  {
    key: 'Depo',
    permission: 'mobile:depo',
    label: 'Depo',
    icon: 'warehouse',
    description: 'Depo girişi ve raf takibi',
  },
  {
    // Anahtar geri-uyum için 'TartiPaket' kalır; ekran ASIL "Sevkiyat" (tartım+paket+irsaliye+
    // çoğu işin fiilen sevk edildiği yer). İkinci ekran (key 'Sevkiyat') artık "Sevk Çıkışı".
    key: 'TartiPaket',
    permission: 'mobile:tarti-paket',
    label: 'Sevkiyat',
    icon: 'scale-balance',
    description: 'Tartım, paketleme ve irsaliye',
  },
  {
    // Key 'Sevkiyat' (permission mobile:sevkiyat) korunur; ekran "Sevk Çıkışı": bekleyen
    // (ara depo/kapı) sevklere çıkış ver / "ambar aldı" onayı.
    key: 'Sevkiyat',
    permission: 'mobile:sevkiyat',
    label: 'Sevk Çıkışı',
    icon: 'truck-delivery',
    description: 'Bekleyen sevklere çıkış / onay',
  },
  {
    key: 'FasonSevk',
    permission: 'mobile:fason-sevk',
    label: 'Fason Sevk',
    icon: 'truck-cargo-container',
    description: 'Fason firmaya sevk',
  },
  {
    key: 'FasonKabul',
    permission: 'mobile:fason-kabul',
    label: 'Fason Mal Kabul',
    icon: 'truck-check',
    description: 'Fason firmadan dönen mal',
  },
  {
    key: 'KartelaSevk',
    permission: 'mobile:kartela-sevk',
    label: 'Kartela Sevk',
    icon: 'palette-swatch',
    description: 'Bitmiş topu kartela firmasına gönder',
  },
  {
    key: 'KartelaKabul',
    permission: 'mobile:kartela-kabul',
    label: 'Kartela Kabul',
    icon: 'palette-swatch-variant',
    description: 'Kartela firmasından dönen kartelalar',
  },
  {
    key: 'IadeGirisi',
    permission: 'mobile:iade',
    label: 'İade Girişi',
    icon: 'undo-variant',
    description: 'Müşteriden dönen topu Hazır Depoya al',
  },
  {
    key: 'HizliIsEmri',
    permission: 'mobile:hizli-is-emri',
    label: 'Hızlı İş Emri',
    icon: 'rocket-launch-outline',
    description: 'Topu okutup iş emri başlat/yönet',
  },
  {
    // Satış/planlama ekranı — istasyon tableti DEĞİL (oturum/yer onayı istemez).
    // "Hızlı Sipariş"in (Sevkiyat altındaki, elindeki topları siparişe çeviren
    // geriye dönük akış) TERSİDİR: burada henüz üretilmemiş bir talep açılır.
    key: 'Siparis',
    permission: 'mobile:siparis',
    label: 'Sipariş',
    icon: 'clipboard-text-outline',
    description: 'Sipariş listesi + yeni müşteri siparişi aç',
  },
  {
    // Master-data ekranı — istasyon tableti DEĞİL (oturum/yer onayı istemez).
    // Electron'daki ürün formunun mobil ikizi; alan kümesi birebir aynı.
    key: 'Kumas',
    permission: 'mobile:kumas',
    label: 'Kumaş Ekle',
    icon: 'shape-square-plus',
    description: 'Yeni kumaş/ürün tanımı (kod · tip · izinli renk ve özellik)',
  },
  {
    // Ofis/süpervizör ekranı — istasyon tableti DEĞİL (oturum/yer onayı istemez).
    // 2026-08-05: KOŞULLU görünürlük KALDIRILDI (eskiden `kursunBypassEnabled`
    // kapalı + bekleyen dağıtım yoksa gizleniyordu). Electron'da Kurşun Sırası ile
    // Kurşun Dağıtım "Kurşun Planlama"da birleşip bayraktan bağımsızlaşınca mobil
    // ikizi de hizalandı: ekran bayrak kapalıyken de bekleyen kuyruğu gösteriyor.
    key: 'KursunDagitim',
    permission: 'mobile:kursun-dagitim',
    label: 'Kurşun Dağıtım',
    icon: 'clipboard-flow-outline',
    description: 'Fason dönüşü iş emirlerini fiziksel kurşun makinelerine dağıt',
  },
];

export const SCREEN_BY_KEY: Record<MobileScreenKey, MobileScreenMeta> = MOBILE_SCREENS.reduce(
  (acc, s) => ({ ...acc, [s.key]: s }),
  {} as Record<MobileScreenKey, MobileScreenMeta>
);
