// Kişiselleştirme seçeneklerinin etiketleri — popover ve Ayarlar › Görünüm aynı listeyi okur.
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import type {
  Density,
  FontScale,
  PresetKey,
  RadiusScale,
  SidebarStyle,
  SurfaceTone,
  TileStyle,
} from "@/lib/theme/appearance";
import type { ThemePref } from "@/types/preferences";

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export const THEME_MODES: (Option<ThemePref> & { icon: LucideIcon })[] = [
  { value: "light", label: "Açık", icon: Sun },
  { value: "dark", label: "Koyu", icon: Moon },
  { value: "system", label: "Sistem", icon: Monitor },
];

export const PRESETS: Option<PresetKey>[] = [
  { value: "violet", label: "Mor" },
  { value: "blue", label: "Mavi" },
  { value: "teal", label: "Turkuaz" },
  { value: "green", label: "Yeşil" },
  { value: "orange", label: "Turuncu" },
  { value: "rose", label: "Gül" },
  { value: "graphite", label: "Grafit" },
];

export const SIDEBARS: Option<SidebarStyle>[] = [
  { value: "light", label: "Açık" },
  { value: "dark", label: "Koyu" },
  { value: "brand", label: "Tema rengi" },
];

export const SURFACES: Option<SurfaceTone>[] = [
  { value: "lavender", label: "Lavanta" },
  { value: "neutral", label: "Nötr" },
  { value: "white", label: "Beyaz" },
];

export const RADII: Option<RadiusScale>[] = [
  { value: "small", label: "Az" },
  { value: "medium", label: "Orta" },
  { value: "large", label: "Geniş" },
];

export const DENSITIES: Option<Density>[] = [
  { value: "compact", label: "Sıkı", hint: "Daha çok satır" },
  { value: "comfortable", label: "Rahat", hint: "Geniş aralık" },
];

export const FONTS: Option<FontScale>[] = [
  { value: "small", label: "Küçük" },
  { value: "normal", label: "Normal" },
  { value: "large", label: "Büyük" },
];

export const TILES: Option<TileStyle>[] = [
  { value: "color", label: "Renkli" },
  { value: "mono", label: "Tek renk" },
];
