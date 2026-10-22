// =============================================================================
// Tasarım token'ları — patron uygulamasının TEK renk/ölçü kaynağı.
//
// Ham hex YALNIZ bu dosyada yazılır; ekran ve bileşenler `useTokens()` ile okur
// (bekçi: `__tests__/tokens.test.ts`). Yeni renk gerekirse buraya ekle, belgeyi
// (`docs/design/PATRON-TASARIM-DILI.md`) aynı commit'te güncelle.
// Kaynak: R3 §C1 (bizim palet + Apple düzeni); tablet `mobil/src/theme/tokens.ts` ile aynı aile.
// =============================================================================
import type { TextStyle, ViewStyle } from "react-native";

export type Scheme = "light" | "dark";

/** Alan kimliği: rengi yalnız "hangi iş" der, iyi/kötü söylemez. */
export type Domain =
  | "uretim"
  | "siparisler"
  | "sevkiyat"
  | "finans"
  | "cariler"
  | "stok"
  | "fason"
  | "raporlar"
  | "gelenKutusu"
  | "genel";

/** 4'lü durum seti: renk + metin + zemin + ikon (durum asla yalnız renkle söylenmez). */
export type StatusKind = "iyi" | "uyari" | "kritik" | "bilgi";

export interface DomainColor {
  /** Metin/ikon/şerit rengi. */
  readonly fg: string;
  /** İkon çipi zemini. */
  readonly chip: string;
}

export interface StatusColor {
  /** Dolgu / ikon rengi. */
  readonly fill: string;
  /** Zemin üstündeki metin. */
  readonly text: string;
  /** Rozet/bant zemini. */
  readonly bg: string;
  /** Ionicons adı (renksiz de anlaşılır şekil). */
  readonly icon: "checkmark-circle" | "warning" | "alert-circle" | "information-circle";
}

export interface Tokens {
  readonly scheme: Scheme;
  readonly bg: string;
  readonly surface: string;
  readonly surfaceAlt: string;
  readonly separator: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly navy: string;
  readonly tint: string;
  readonly tintContainer: string;
  /** Tint/durum dolgusu üstündeki metin. */
  readonly onTint: string;
  readonly gold: string;
  readonly domain: Readonly<Record<Domain, DomainColor>>;
  readonly status: Readonly<Record<StatusKind, StatusColor>>;
  readonly role: { readonly yonetici: { readonly bg: string; readonly fg: string }; readonly ekip: { readonly bg: string; readonly fg: string } };
  /** Kart gölgesi (koyu modda yok; yüzey tonu farkı yeter). */
  readonly cardShadow: ViewStyle;
  readonly floatShadow: ViewStyle;
  /** Karekod gibi her temada beyaz kalması gereken yüzey. */
  readonly paper: string;
}

const STATUS_ICON = {
  iyi: "checkmark-circle",
  uyari: "warning",
  kritik: "alert-circle",
  bilgi: "information-circle",
} as const;

export const light: Tokens = {
  scheme: "light",
  bg: "#F2F4F7",
  surface: "#FFFFFF",
  surfaceAlt: "#F8FAFC",
  separator: "#E2E8F0",
  text: "#0F172A",
  textSecondary: "#475569",
  textMuted: "#5B6576",
  navy: "#161C2B",
  tint: "#4F46E5",
  tintContainer: "#E0E7FF",
  onTint: "#FFFFFF",
  gold: "#FDE68A",
  domain: {
    uretim: { fg: "#7C3AED", chip: "#EDE9FE" },
    siparisler: { fg: "#0F766E", chip: "#CCFBF1" },
    sevkiyat: { fg: "#C2410C", chip: "#FFEDD5" },
    finans: { fg: "#0369A1", chip: "#E0F2FE" },
    cariler: { fg: "#BE185D", chip: "#FCE7F3" },
    stok: { fg: "#57534E", chip: "#E7E5E4" },
    fason: { fg: "#A21CAF", chip: "#FAE8FF" },
    raporlar: { fg: "#475569", chip: "#E2E8F0" },
    gelenKutusu: { fg: "#4F46E5", chip: "#E0E7FF" },
    genel: { fg: "#475569", chip: "#E2E8F0" },
  },
  status: {
    iyi: { fill: "#15803D", text: "#14532D", bg: "#DCFCE7", icon: STATUS_ICON.iyi },
    uyari: { fill: "#B45309", text: "#78350F", bg: "#FEF3C7", icon: STATUS_ICON.uyari },
    kritik: { fill: "#B91C1C", text: "#7F1D1D", bg: "#FEE2E2", icon: STATUS_ICON.kritik },
    bilgi: { fill: "#475569", text: "#1E293B", bg: "#F1F5F9", icon: STATUS_ICON.bilgi },
  },
  role: { yonetici: { bg: "#161C2B", fg: "#FDE68A" }, ekip: { bg: "#E0E7FF", fg: "#4F46E5" } },
  cardShadow: { boxShadow: "0 1px 2px rgba(15,23,42,0.06), 0 4px 12px rgba(15,23,42,0.05)" },
  floatShadow: { boxShadow: "0 8px 24px rgba(15,23,42,0.12)" },
  paper: "#FFFFFF",
};

export const dark: Tokens = {
  scheme: "dark",
  bg: "#0B0D12",
  surface: "#1C1F26",
  surfaceAlt: "#252933",
  separator: "#2E3440",
  text: "#F1F5F9",
  textSecondary: "#CBD5E1",
  textMuted: "#94A3B8",
  navy: "#161C2B",
  tint: "#818CF8",
  tintContainer: "#2A2A5C",
  onTint: "#0B0D12",
  gold: "#FDE68A",
  domain: {
    uretim: { fg: "#A78BFA", chip: "#2E1065" },
    siparisler: { fg: "#2DD4BF", chip: "#042F2E" },
    sevkiyat: { fg: "#FB923C", chip: "#431407" },
    finans: { fg: "#38BDF8", chip: "#082F49" },
    cariler: { fg: "#F472B6", chip: "#500724" },
    stok: { fg: "#A8A29E", chip: "#292524" },
    fason: { fg: "#E879F9", chip: "#4A044E" },
    raporlar: { fg: "#94A3B8", chip: "#1E293B" },
    gelenKutusu: { fg: "#818CF8", chip: "#2A2A5C" },
    genel: { fg: "#94A3B8", chip: "#1E293B" },
  },
  status: {
    iyi: { fill: "#4ADE80", text: "#BBF7D0", bg: "#052E16", icon: STATUS_ICON.iyi },
    uyari: { fill: "#FBBF24", text: "#FDE68A", bg: "#451A03", icon: STATUS_ICON.uyari },
    kritik: { fill: "#F87171", text: "#FECACA", bg: "#450A0A", icon: STATUS_ICON.kritik },
    bilgi: { fill: "#94A3B8", text: "#E2E8F0", bg: "#1E293B", icon: STATUS_ICON.bilgi },
  },
  role: { yonetici: { bg: "#161C2B", fg: "#FDE68A" }, ekip: { bg: "#2A2A5C", fg: "#818CF8" } },
  cardShadow: {},
  floatShadow: {},
  paper: "#FFFFFF",
};

export const schemes: Readonly<Record<Scheme, Tokens>> = { light, dark };

/** Sayılar sütunda hizalı kalsın, tazelenince titremesin. */
const tabular: TextStyle = { fontVariant: ["tabular-nums"] };

/** Tipografi ölçeği (sistem fontu; `allowFontScaling` açık). */
export const typography = {
  display: { fontSize: 40, lineHeight: 44, fontWeight: "700", ...tabular },
  kpi: { fontSize: 30, lineHeight: 34, fontWeight: "700", ...tabular },
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700" },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: "600" },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 22, fontWeight: "400" },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: "400" },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: "400" },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
} as const satisfies Record<string, TextStyle>;

export const tabularNums = tabular;

/** Başlıkta büyük yazı çarpanı sınırı (Dynamic Type taşmasın); gövdede 2. */
export const FONT_SCALE = { title: 1.4, body: 2 } as const;

/** Boşluk ölçeği: 4 · 8 · 12 · 16 · 20 · 24 · 32 (eski adlar xs/s/m/l/xl korunur). */
export const space = { xs: 4, s: 8, m: 12, l: 16, ml: 20, xl: 24, xxl: 32 } as const;

/** Eş merkezli yarıçap: iç = dış − iç boşluk. */
export const radius = { sheet: 28, card: 20, cardInner: 12, control: 12, button: 14, chip: 999 } as const;

/** Kart sol alan şeridi kalınlığı. */
export const STRIPE = 4;
/** En küçük dokunma hedefi (iOS 44pt / Android 48dp → 48). */
export const TOUCH = 48;
/** Bu genişlikten itibaren sol ray + iki sütun. */
export const WIDE_MIN = 768;
/** Geniş ekranda içerik kabı (ray hariç) en fazla bu kadar yayılır, ortalanır. */
export const CONTENT_MAX = 1120;
/** Tek sütunlu okuma genişliği (form, liste). */
export const READABLE_MAX = 960;
/** Telefonda sıkı üst bar yüksekliği (iOS gezinme çubuğu). */
export const BAR_HEIGHT = 44;
/** Telefon alt sekme çubuğu yüksekliği (güvenli alan HARİÇ; ikon kabı 28 + etiket satırı 14 + öğe/çubuk dolgusu ~20). */
export const TAB_BAR_HEIGHT = 64;
/** Sol ray genişliği (≥ WIDE_MIN). */
export const RAIL_WIDTH = 248;
