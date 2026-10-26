// İkon eşlemesi: alan/modül → Ionicons adı (SF Symbols'a en yakın çizgi; iOS · Android · web aynı).
// Alan rengi `tokens.ts` `domain`dan; ikon + renk birlikte "hangi iş" der.
import type Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import type { ModuleKey } from "../lib/access";
import type { Domain } from "./tokens";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export const DOMAIN_ICON: Readonly<Record<Domain, IconName>> = {
  uretim: "construct-outline",
  siparisler: "receipt-outline",
  sevkiyat: "car-outline",
  finans: "wallet-outline",
  cariler: "people-outline",
  stok: "cube-outline",
  fason: "git-branch-outline",
  raporlar: "document-text-outline",
  gelenKutusu: "file-tray-full-outline",
  genel: "ellipse-outline",
};

/** Modül → alan kimliği (renk) + ikon. */
export const MODULE_ICON: Readonly<Record<ModuleKey, { readonly domain: Domain; readonly icon: IconName }>> = {
  pano: { domain: "genel", icon: "grid-outline" },
  siparisler: { domain: "siparisler", icon: DOMAIN_ICON.siparisler },
  teklifler: { domain: "siparisler", icon: "document-text-outline" },
  "standart-maliyetler": { domain: "finans", icon: "calculator-outline" },
  cariler: { domain: "cariler", icon: DOMAIN_ICON.cariler },
  sevkiyat: { domain: "sevkiyat", icon: DOMAIN_ICON.sevkiyat },
  uretim: { domain: "uretim", icon: DOMAIN_ICON.uretim },
  stok: { domain: "stok", icon: DOMAIN_ICON.stok },
  finans: { domain: "finans", icon: DOMAIN_ICON.finans },
  raporlar: { domain: "raporlar", icon: DOMAIN_ICON.raporlar },
  "gelen-kutusu": { domain: "gelenKutusu", icon: DOMAIN_ICON.gelenKutusu },
  hesaplar: { domain: "genel", icon: "key-outline" },
  bildirimler: { domain: "genel", icon: "notifications-outline" },
  profil: { domain: "genel", icon: "person-circle-outline" },
};

/** "Diğer" sekmesinin ikonu. */
export const MORE_ICON: IconName = "ellipsis-horizontal-circle-outline";
