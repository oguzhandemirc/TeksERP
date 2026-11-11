// Rapor Merkezi görünüm sözlüğü — kategori simgesi/rengi/tek satır açıklaması, persona adları, dönem adları.
// Kategori KÜMESİ ve sırası burada DEĞİL: `CENTER_CATEGORIES` (center-model) tek kaynaktır; burası yalnız süs.
import { Calculator, Factory, ShieldCheck, Spool, Truck, Wallet, type LucideIcon } from "lucide-react";
import type { IconTileTone } from "@/components/ui/icon-tile";
import type { ReportKategoriV2, ReportPersona } from "@/lib/report-catalog";
import type { PanoDonem } from "@/pages/Dashboard/pano/types";

export interface CategoryLook {
  icon: LucideIcon;
  tone: IconTileTone;
  description: string;
}

export const CATEGORY_LOOK: Record<ReportKategoriV2, CategoryLook> = {
  "satis-sevkiyat": { icon: Truck, tone: "green", description: "Alınan iş, sevk, termin ve iadeler" },
  uretim: { icon: Factory, tone: "violet", description: "Kurşun, iplik ihtiyacı ve makine duruşları" },
  kalite: { icon: ShieldCheck, tone: "rose", description: "Kalite gidişatı ve kayıplar" },
  dokuma: { icon: Spool, tone: "amber", description: "Tezgah verimi, duruşlar ve levent" },
  para: { icon: Wallet, tone: "teal", description: "Alacaklar, kârlılık ve masraflar" },
  "muhasebe-araclari": { icon: Calculator, tone: "blue", description: "Kasa, banka, KDV ve kur farkı" },
};

/** Katalog `persona` değerlerinin ekrandaki adı ("Kimin için" süzgeci). */
export const PERSONA_LABEL: Record<ReportPersona, string> = {
  patron: "Patron",
  satis: "Satış",
  sevkiyat: "Sevkiyat",
  planlama: "Planlama",
  uretim: "Üretim",
  kalite: "Kalite",
  depo: "Depo",
  dokuma: "Dokuma",
  muhasebe: "Muhasebe",
};

/** Pano ucunun pencereleriyle aynı (`pano-donem.ts`: bugün · son 7 gün · son 30 gün · son 12 ay). */
export const PERIOD_LABEL: Record<PanoDonem, string> = {
  bugun: "Bugün",
  hafta: "Son 7 gün",
  ay: "Son 30 gün",
  yil: "Son 12 ay",
};

export const DEFAULT_PERIOD: PanoDonem = "ay";
