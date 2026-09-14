// =============================================================================
// Tasarım token'ları — tek doğruluk kaynağı.
//
// Mobilde renk/spacing/radius değerleri bugüne kadar her dosyada ham hex olarak
// dağınıktı (#0f172a, #f8fafc, #4f46e5, #64748b ...). Bu dosya hepsini tek yere
// toplar; ekranlar `colors.text`, `spacing.lg` gibi semantik adlarla okur.
// Yeni ekran/komponent yazarken ham hex YAZMA — buradan al veya buraya ekle.
//
// Palet Tailwind slate + indigo skalasıyla hizalı (mevcut görünümü bozmadan
// formalize eder). Fabrika ortamı için yüksek kontrast korunur.
// =============================================================================

import type { MobileScreenKey } from '../types/permissions';

/** Ham renk skalaları — semantik `colors` bunların üstüne kurulur. */
export const palette = {
  indigo: { 50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca' },
  slate: {
    50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8',
    500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a',
  },
  emerald: { 50: '#ecfdf5', 100: '#d1fae5', 500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b' },
  red: { 50: '#fef2f2', 100: '#fee2e2', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b', 900: '#7f1d1d' },
  amber: { 50: '#fffbeb', 100: '#fef3c7', 500: '#f59e0b', 600: '#d97706', 700: '#b45309' },
  violet: { 50: '#f5f3ff', 100: '#ede9fe', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9' },
  blue: { 50: '#eff6ff', 100: '#dbeafe', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a' },
  white: '#ffffff',
  black: '#000000',
} as const;

/** Semantik renkler — ekranlar HER ZAMAN bunları kullanır. */
export const colors = {
  // Marka
  brand: palette.indigo[600],
  brandDark: palette.indigo[700],
  brandContainer: palette.indigo[100],
  brandSoft: palette.indigo[50],

  // Liste içi "ekle/yeni" aksiyon kartı — MOR. Bilinçli olarak marka indigo'sundan
  // ayrı: seçili seçenek indigo ile vurgulandığı için aksiyon aynı renk olsaydı
  // "seçili" gibi okunurdu.
  action: palette.violet[600],
  actionDark: palette.violet[700],

  // Yüzeyler
  appBg: palette.slate[50],
  surface: palette.white,
  surfaceMuted: palette.slate[100],
  surfaceSunken: palette.slate[200],
  headerBg: palette.slate[900],
  scrim: 'rgba(15,23,42,0.55)',

  // Metin
  text: palette.slate[900],
  textSecondary: palette.slate[600],
  textMuted: palette.slate[500],
  textOnDark: palette.white,
  textOnDarkMuted: palette.slate[300],

  // Kenarlık
  border: palette.slate[200],
  borderStrong: palette.slate[300],

  // Semantik durumlar
  success: palette.emerald[500],
  successDark: palette.emerald[600],
  successText: palette.emerald[900],
  successContainer: palette.emerald[100],

  danger: palette.red[500],
  dangerDark: palette.red[700],
  dangerText: palette.red[900],
  dangerContainer: palette.red[100],

  warning: palette.amber[500],
  warningDark: palette.amber[700],
  warningText: palette.amber[700],
  warningContainer: palette.amber[100],

  info: palette.blue[500],
  infoDark: palette.blue[700],
  infoText: palette.blue[900],
  infoContainer: palette.blue[100],
} as const;

/** Boşluk skalası (dp). Tutarlı ritim için 4'ün katları. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Köşe yarıçapı. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 999,
} as const;

/** Gölge presetleri (Android elevation + iOS shadow birlikte). */
export const shadow = {
  sm: {
    shadowColor: palette.slate[900],
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: palette.slate[900],
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  lg: {
    shadowColor: palette.slate[900],
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;

/** Tipografi yardımcıları — Paper variant'larının dışında kalan özel Text için. */
export const typography = {
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  size: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    display: 32,
  },
} as const;

/**
 * Modül (istasyon) vurgu renkleri — ModuleSelect grid'i ve istasyon başlıkları
 * aynı renk kimliğini paylaşsın diye merkezi. `tint` = ikon/aksan, `bg` = ikon
 * kutusu zemini.
 */
export const moduleAccents: Record<MobileScreenKey, { tint: string; bg: string }> = {
  KK1: { tint: '#2563eb', bg: '#dbeafe' },
  KursunQc: { tint: '#d97706', bg: '#fef3c7' },
  Tambur: { tint: '#7c3aed', bg: '#ede9fe' },
  Depo: { tint: '#475569', bg: '#e2e8f0' },
  TartiPaket: { tint: '#059669', bg: '#d1fae5' },
  Sevkiyat: { tint: '#ea580c', bg: '#ffedd5' },
  FasonSevk: { tint: '#0891b2', bg: '#cffafe' },
  FasonKabul: { tint: '#db2777', bg: '#fce7f3' },
  KartelaSevk: { tint: '#9333ea', bg: '#f3e8ff' },
  KartelaKabul: { tint: '#c026d3', bg: '#fae8ff' },
  IadeGirisi: { tint: '#dc2626', bg: '#fee2e2' },
  HizliIsEmri: { tint: '#4f46e5', bg: '#e0e7ff' },
  // Satış tarafı — üretim/lojistik tonlarından ayrışsın diye teal.
  Siparis: { tint: '#0d9488', bg: '#ccfbf1' },
  // Master-data (tanım) ekranı — operasyon ekranlarından ayrışsın diye taş grisi.
  Kumas: { tint: '#57534e', bg: '#e7e5e4' },
  // Kurşun ailesi (amber) ama KursunQc'den KOYU tonla ayrışır: aynı işin planlama
  // yüzü olduğu anlaşılsın, istasyon ekranıyla karıştırılmasın.
  KursunDagitim: { tint: '#b45309', bg: '#fde68a' },
  Dokuma: { tint: '#0f766e', bg: '#ccfbf1' },
  // Devere (levent) — dokuma ailesi ama tezgahtan ayrışsın diye kayısı tonu.
  Devere: { tint: '#c2410c', bg: '#fed7aa' },
  FasonDokuma: { tint: '#db2777', bg: '#fce7f3' }, // fason kabulün kardeşi — aynı renk ailesi
};
