import type { PackageNoMode, PackingGroupMode } from "@/lib/shipping-flags";
import type { PackingGroup } from "./types";

/**
 * SEVK PARTİSİ — panel yüzeyinin saf kuralları (2026-09-21). Bileşenler buradan
 * okur; test ikizi `packingLotUi.test.ts`. Tasarım: docs/design/SEVK-PARTISI-TASARIM.md.
 */

/** Ekran sevk partisi modunda mı — grup bayrağı kapalıysa hiçbir zaman. */
export function isLotMode(groupsEnabled: boolean, mode: PackingGroupMode): boolean {
  return groupsEnabled && mode === "sevk-partisi";
}

/**
 * "Ambalaj No" alanının durumu — moda göre TEK yerde karar verilir:
 *  otomatik → alan gösterilmez (sayaç verir) · otomatik-ezilebilir → boş bırakılabilir
 *  · elle → zorunlu.
 */
export function packageNoField(mode: PackageNoMode): { shown: boolean; required: boolean; hint: string } {
  switch (mode) {
    case "otomatik":
      return { shown: false, required: false, hint: "Numarayı sistem verir." };
    case "elle":
      return { shown: true, required: true, hint: "Numara zorunlu (ayar: elle)." };
    default:
      return { shown: true, required: false, hint: "Boş bırakırsan sıradaki numara verilir." };
  }
}

/** Çip altyazısı: açık N · sevk edilen M (0 ise sevk kısmı düşer). */
export function lotChipSummary(g: Pick<PackingGroup, "sackCount" | "shippedSackCount" | "totalQty">): string {
  const parts = [`${g.sackCount} açık`];
  if (g.shippedSackCount > 0) parts.push(`${g.shippedSackCount} sevk`);
  const m = g.totalQty.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  return `${parts.join(" · ")} · ${m} m`;
}

/** Yalnız HİÇ çuvalı olmamış parti silinebilir (taslak sınıfı); diğeri kapatılır. */
export function lotDeletable(g: Pick<PackingGroup, "sackCount" | "shippedSackCount">): boolean {
  return g.sackCount === 0 && g.shippedSackCount === 0;
}

/**
 * "Yeni Çuval" hedefi — parti modunda seçili parti varsa ONA açılır; `lotRequired`
 * açıkken parti seçilmeden çuval açılamaz (backend 400 verir, ekran sebebini söyler).
 */
export function newSackLotTarget(args: {
  lotMode: boolean;
  selectedLotId: string | null;
  lotRequired: boolean;
}): { packingGroupId: string | null; blocked: string | null } {
  if (!args.lotMode) return { packingGroupId: null, blocked: null };
  if (args.selectedLotId) return { packingGroupId: args.selectedLotId, blocked: null };
  return {
    packingGroupId: null,
    blocked: args.lotRequired ? "Önce bir sevk partisi seçin — partisiz çuval açma kapalı (ayar)." : null,
  };
}

/** Ambalaj no girdisi → sayı ya da null (boş). Negatif / kesirli → hata metni. */
export function parsePackageNoInput(raw: string): { value: number | null; error: string | null } {
  const t = raw.trim();
  if (!t) return { value: null, error: null };
  if (!/^\d+$/.test(t)) return { value: null, error: "Ambalaj no yalnız tam sayı olabilir" };
  const n = Number(t);
  if (n > 999_999) return { value: null, error: "Ambalaj no çok büyük" };
  return { value: n, error: null };
}
