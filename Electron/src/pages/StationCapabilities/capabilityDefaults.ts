// K22 — İstasyon yeteneği varsayılanları (panel düzenleme yüzeyi). Kural sunucuda:
// İE ön seçimini `station-default-targets.helper` çözer; burası yalnız ayarı YAZAR.
import type { FabricProperty } from "@/pages/FabricProperties/types";

export interface CapabilityDefault {
  defaultOn: boolean;
  defaultValueId: string | null;
}

export const NO_DEFAULT: CapabilityDefault = { defaultOn: false, defaultValueId: null };

export interface DefaultValueOption {
  id: string;
  name: string;
  /** Değerin ait olduğu özellik (bayrak satırında çeşit adı görünsün diye). */
  propertyName: string;
}

/**
 * Seçilebilir varsayılan değerler: özelliğin kendi AKTİF değerleri + çeşit çocuğunun
 * (bayrak satırında gramaj) AKTİF değerleri. Backend aynı sahipliği 400 ile zorlar.
 */
export function defaultValueOptions(
  propertyId: string,
  catalog: readonly FabricProperty[],
): DefaultValueOption[] {
  const own = catalog.find((p) => p.id === propertyId);
  const child = catalog.find((p) => p.variantOfPropertyId === propertyId);
  return [own, child].flatMap((p) =>
    (p?.values ?? [])
      .filter((v) => v.isActive)
      .map((v) => ({ id: v.id, name: v.name, propertyName: p!.name })),
  );
}

function same(a: CapabilityDefault, b: CapabilityDefault): boolean {
  return a.defaultOn === b.defaultOn && a.defaultValueId === b.defaultValueId;
}

/** Kaydet düğmesini açan fark: herhangi bir satırın varsayılanı başlangıçtan ayrıştı mı? */
export function defaultsDirty(
  ids: readonly string[],
  current: Record<string, CapabilityDefault>,
  initial: Record<string, CapabilityDefault>,
): boolean {
  return ids.some((id) => !same(current[id] ?? NO_DEFAULT, initial[id] ?? NO_DEFAULT));
}

/**
 * PUT satırının varsayılan parçası — YALNIZ değişen satırda gönderilir: backend
 * verilmeyen alanı korur, eski backend tanımadığı alanı yok sayar.
 */
export function defaultsPatch(
  id: string,
  current: Record<string, CapabilityDefault>,
  initial: Record<string, CapabilityDefault>,
): Partial<CapabilityDefault> {
  const c = current[id] ?? NO_DEFAULT;
  return same(c, initial[id] ?? NO_DEFAULT) ? {} : { defaultOn: c.defaultOn, defaultValueId: c.defaultValueId };
}
