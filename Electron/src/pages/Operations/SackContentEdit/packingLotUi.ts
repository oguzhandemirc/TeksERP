import type { PackageNoMode, PackingGroupMode } from "@/lib/shipping-flags";
import { CUSTOMERLESS_FILTER_VALUE, type PackingGroup } from "./types";

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

/**
 * Satır etiketi: açık partide "N çuval" (sevk edilenler bu ekranda İZLENMEZ — yeri
 * Sevkiyatlar; saha 2026-09-22); "sevk edildi" partide "M çuval sevk edildi".
 */
export function lotSackLabel(g: Pick<PackingGroup, "status" | "sackCount" | "shippedSackCount">): string {
  if (g.status === "CLOSED") return `${g.shippedSackCount} çuval sevk edildi`;
  return `${g.sackCount} çuval`;
}

/** Durum etiketi — CLOSED "sevk edildi"dir, "kapalı" değil (elle kapatma yok). */
export function lotStatusLabel(status: PackingGroup["status"]): string {
  return status === "CLOSED" ? "SEVK EDİLDİ" : "AÇIK";
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

/** `filter[customerId]` TEK cari ise onu döner (CSV ve müşterisiz sentineli dışlanır). */
export function singleCustomerFromFilter(searchParams: URLSearchParams): string | null {
  const ids = (searchParams.get("filter[customerId]") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v && v !== CUSTOMERLESS_FILTER_VALUE);
  return ids.length === 1 ? (ids[0] ?? null) : null;
}
