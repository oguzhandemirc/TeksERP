import { LayoutTemplate, Link2, Printer, type LucideIcon } from "lucide-react";

export type EtiketTabKey = "templates" | "assignments" | "freeprint";

export interface EtiketTabDef {
  key: EtiketTabKey;
  label: string;
  description: string;
  icon: LucideIcon;
}

/**
 * Etiketler sayfasının sekmeleri — TEK KAYNAK. `EtiketlerPage` şeridi, komut
 * paleti ise `?tab=<key>` derin bağlantılarını buradan üretir.
 *   - Düzenler      = hangi alan nerede / uzman kod — LabelTemplate (TEK HAVUZ)
 *   - Atamalar      = bağlam başına varsayılan şablon — LabelContextDefault
 *   - Serbest Baskı = kayda bağlı olmayan tekil etiket baskısı
 */
export const ETIKET_TABS: EtiketTabDef[] = [
  {
    key: "templates",
    label: "Etiket Düzenleri",
    description: "Alan yerleşimi / uzman yazıcı kodu — etiket şablon havuzu",
    icon: LayoutTemplate,
  },
  {
    key: "assignments",
    label: "Etiket Atamaları",
    description: "Bağlam başına varsayılan şablon (top, çuval, kartela…)",
    icon: Link2,
  },
  {
    key: "freeprint",
    label: "Serbest Etiket Baskısı",
    description: "Kayda bağlı olmayan tekil etiket baskısı",
    icon: Printer,
  },
];

const TAB_KEYS = new Set<EtiketTabKey>(ETIKET_TABS.map((t) => t.key));

export function resolveEtiketTab(v: string | null): EtiketTabKey {
  return v !== null && TAB_KEYS.has(v as EtiketTabKey) ? (v as EtiketTabKey) : "templates";
}
