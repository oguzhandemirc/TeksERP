import {
  LayoutDashboard,
  Library,
  ClipboardList,
  ScrollText,
  ShieldCheck,
  ServerCog,
  Settings,
  ShieldAlert,
  FileText,
  Factory,
  TrendingUp,
  BadgeCheck,
  Boxes,
  Handshake,
  Users,
  History,
  type LucideIcon,
} from "lucide-react";
import { allCommandEntries } from "@/components/layout/command-entries";

export interface TabMeta {
  title: string;
  icon: LucideIcon;
}

// command-entries kataloğunda olmayan hub / sistem sayfaları için sabit eşleme.
const STATIC: Record<string, TabMeta> = {
  "/": { title: "Anasayfa", icon: LayoutDashboard },
  "/settings": { title: "Ayarlar", icon: Settings },
  "/forbidden": { title: "Yetki yok", icon: ShieldAlert },
  "/definitions": { title: "Tanımlar", icon: Library },
  "/operations": { title: "Operasyon", icon: ClipboardList },
  "/operations/work-orders/new": { title: "Yeni İş Emri", icon: Factory },
  "/reports": { title: "Raporlar", icon: ScrollText },
  "/access": { title: "Yetkilendirme", icon: ShieldCheck },
  "/system": { title: "Sistem", icon: ServerCog },
  // Rapor domain hub'ları — HubCard'tan açıldığında okunur başlık.
  "/reports/production": { title: "Üretim Raporları", icon: Factory },
  "/reports/sales": { title: "Satış Raporları", icon: TrendingUp },
  "/reports/quality": { title: "Kalite Raporları", icon: BadgeCheck },
  "/reports/inventory": { title: "Stok Raporları", icon: Boxes },
  "/reports/subcontract": { title: "Fason Raporları", icon: Handshake },
  "/reports/customer": { title: "Müşteri Raporları", icon: Users },
  "/reports/audit": { title: "Denetim Raporları", icon: History },
};

/** Path'in sorgu/parametre kısmını atıp salt pathname döndürür. */
export function tabPathname(path: string): string {
  return path.split("?")[0] || "/";
}

/** Son segmenti başlığa çevirir ("station-efficiency" → "Station Efficiency"). */
function titleFromSegment(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean).pop() ?? "";
  if (!seg) return "Sayfa";
  return seg
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Bir pathname için sekme başlığı + ikonunu çözer. Sırayla:
 * sabit eşleme → komut kataloğu (label/icon) → son-segment fallback.
 * Dinamik detay yolları (`/x/:id`) prefix eşleşmesiyle ana sayfanın etiketini alır.
 */
export function resolveTabMeta(path: string): TabMeta {
  const pathname = tabPathname(path);

  const fixed = STATIC[pathname];
  if (fixed) return fixed;

  const exact = allCommandEntries.find((e) => e.to === pathname);
  if (exact) return { title: exact.label, icon: exact.icon };

  // Detay yolu (örn. /definitions/label-templates/:id) → en uzun prefix eşleşmesi.
  const prefixMatch = allCommandEntries
    .filter((e) => pathname.startsWith(e.to + "/"))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (prefixMatch) return { title: prefixMatch.label, icon: prefixMatch.icon };

  return { title: titleFromSegment(pathname), icon: FileText };
}
