// Bildirim satırı biçimi — grup ikonu/rengi, göreli saat ve gün grupları FABRİKA diliminden
// (`@/lib/factory-time`); sınıf renkleri ALARM / BİLDİRİM / ETKİNLİK'i ayırır ama anlam ikon+metinde.
import {
  BadgeCheck,
  Bell,
  Boxes,
  Factory,
  Layers,
  Package,
  ServerCog,
  ShoppingCart,
  Siren,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { addDaysToKey, factoryDayKey, formatFactory } from "@/lib/factory-time";
import type { NotificationGroup, NotificationItem, NotificationClass } from "./types";

export const GROUP_LOOK: Record<NotificationGroup, { ikon: LucideIcon; renk: string }> = {
  Sipariş: { ikon: ShoppingCart, renk: "text-blue-600 bg-blue-500/10 dark:text-blue-400" },
  Üretim: { ikon: Factory, renk: "text-violet-600 bg-violet-500/10 dark:text-violet-400" },
  Kalite: { ikon: BadgeCheck, renk: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400" },
  Sevkiyat: { ikon: Package, renk: "text-sky-600 bg-sky-500/10 dark:text-sky-400" },
  Fason: { ikon: Truck, renk: "text-orange-600 bg-orange-500/10 dark:text-orange-400" },
  Stok: { ikon: Boxes, renk: "text-amber-600 bg-amber-500/10 dark:text-amber-400" },
  Finans: { ikon: Wallet, renk: "text-teal-600 bg-teal-500/10 dark:text-teal-400" },
  Dokuma: { ikon: Layers, renk: "text-indigo-600 bg-indigo-500/10 dark:text-indigo-400" },
  Sistem: { ikon: ServerCog, renk: "text-slate-600 bg-slate-500/10 dark:text-slate-300" },
};
const FALLBACK_LOOK = { ikon: Bell, renk: "text-muted-foreground bg-muted" };

export function groupLook(grup: string): { ikon: LucideIcon; renk: string } {
  return GROUP_LOOK[grup as NotificationGroup] ?? FALLBACK_LOOK;
}

/** Üç sınıf: ALARM kırmızı, BİLDİRİM birincil renk; ETKİNLİK (sayaçsız akış) bu yüzeyde yoktur. */
export const CLASS_LOOK: Record<NotificationClass, { etiket: string; ikon: LucideIcon; renk: string }> = {
  ALARM: { etiket: "Alarm", ikon: Siren, renk: "border-destructive/40 bg-destructive/10 text-destructive" },
  BILDIRIM: { etiket: "Bildirim", ikon: Bell, renk: "border-primary/30 bg-primary/10 text-primary" },
};

const REASON_LABEL: Record<string, string> = {
  IZIN: "Yetkiniz gereği",
  TAKIPCI: "Takip ediyorsunuz",
  OLUSTURAN: "Siz oluşturdunuz",
  NOBET: "Nöbetçisiniz",
  LISTE: "Dağıtım listesindesiniz",
  ALARM_ALICISI: "Alarm listesindesiniz",
};
export const reasonLabel = (neden: string): string => REASON_LABEL[neden] ?? "";

/** "az önce" · "5 dk" · "3 sa" · "dün 17:40" · "12.10 08:15" — fabrika saatiyle. */
export function relativeTime(an: string | Date, simdi: Date = new Date()): string {
  const t = new Date(an);
  const fark = simdi.getTime() - t.getTime();
  if (fark < 60_000) return "az önce";
  if (fark < 60 * 60_000) return `${Math.floor(fark / 60_000)} dk`;
  const bugun = factoryDayKey(simdi);
  const gun = factoryDayKey(t);
  if (gun === bugun) return `${Math.floor(fark / 3_600_000)} sa`;
  if (gun === addDaysToKey(bugun, -1)) return `dün ${formatFactory(t, "HH:mm")}`;
  return formatFactory(t, "dd.MM HH:mm");
}

export type DayGroup = "Bugün" | "Dün" | "Bu hafta" | "Daha eski";

export function dayGroup(an: string | Date, simdi: Date = new Date()): DayGroup {
  const bugun = factoryDayKey(simdi);
  const gun = factoryDayKey(an);
  if (gun === bugun) return "Bugün";
  if (gun === addDaysToKey(bugun, -1)) return "Dün";
  if (gun >= addDaysToKey(bugun, -6)) return "Bu hafta";
  return "Daha eski";
}

/** Sıralı listeyi (sonAn azalan) gün gruplarına böler; sıra korunur. */
export function splitByDay(items: readonly NotificationItem[], simdi: Date = new Date()): Array<{ grup: DayGroup; items: NotificationItem[] }> {
  const out: Array<{ grup: DayGroup; items: NotificationItem[] }> = [];
  for (const it of items) {
    const g = dayGroup(it.sonAn, simdi);
    const son = out[out.length - 1];
    if (son && son.grup === g) son.items.push(it);
    else out.push({ grup: g, items: [it] });
  }
  return out;
}

/** Rozet metni: 99 üstü "99+". */
export const badgeText = (n: number): string => (n > 99 ? "99+" : String(n));
