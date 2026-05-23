export type MobilePermission =
  | 'mobile:kk1'
  | 'mobile:kk2-kursun'
  | 'mobile:tambur'
  | 'mobile:depo'
  | 'mobile:tarti-paket'
  | 'mobile:sevkiyat'
  | 'mobile:fason-sevk'
  | 'mobile:fason-kabul'
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
  | 'FasonKabul';

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
    label: 'KK1 — Ham Giriş',
    icon: 'package-variant-plus',
    description: 'Ham mal kabul, ölçüm ve etiketleme',
  },
  {
    key: 'KursunQc',
    permission: 'mobile:kk2-kursun',
    label: 'Kurşun + KK2',
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
    key: 'TartiPaket',
    permission: 'mobile:tarti-paket',
    label: 'Tartı + Paket',
    icon: 'scale-balance',
    description: 'Tartım ve paketleme',
  },
  {
    key: 'Sevkiyat',
    permission: 'mobile:sevkiyat',
    label: 'Sevkiyat',
    icon: 'truck-delivery',
    description: 'Sevk hazırlık ve çıkış',
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
];

export const SCREEN_BY_KEY: Record<MobileScreenKey, MobileScreenMeta> = MOBILE_SCREENS.reduce(
  (acc, s) => ({ ...acc, [s.key]: s }),
  {} as Record<MobileScreenKey, MobileScreenMeta>
);
