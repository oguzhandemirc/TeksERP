import { Send, Inbox, PackageCheck, Package, Palette, History, type LucideIcon } from "lucide-react";

export type KartelaTabKey = "dispatches" | "outstanding" | "receipts" | "rolls" | "swatches" | "events";

/**
 * Kartela Takibi sekmeleri — TEK KAYNAK. Sayfa şeridi ve komut paletinin `?tab=` derin
 * bağlantıları buradan üretilir (kopyalanırsa palet ile sayfa ayrışır).
 */
export const KARTELA_TABS: { key: KartelaTabKey; label: string; Icon: LucideIcon }[] = [
  { key: "dispatches", label: "Sevkler", Icon: Send },
  { key: "outstanding", label: "Bekleyen Kabul", Icon: Inbox },
  { key: "receipts", label: "Kabuller", Icon: PackageCheck },
  { key: "rolls", label: "Kartelada Toplar", Icon: Package },
  { key: "swatches", label: "Kartela Stoğu", Icon: Palette },
  { key: "events", label: "Hareketler", Icon: History },
];

export function isKartelaTabKey(v: string | null): v is KartelaTabKey {
  return KARTELA_TABS.some((t) => t.key === v);
}

/** Komut paletinden "Yeni Kartela Sevki" doğrudan diyaloğu açar: `?tab=dispatches&action=new-dispatch`. */
export const NEW_DISPATCH_ACTION = "new-dispatch";
