// K22 — İstasyon yeteneği varsayılanları (panel düzenleme yüzeyi). Kural sunucuda:
// İE ön seçimini `station-default-targets.helper` çözer; burası yalnız ayarı YAZAR.
import type { FabricProperty } from "@/pages/FabricProperties/types";
import type { MultiSelectItem } from "@/components/forms/MultiSelectCheckboxList";

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
 * Çeşit istasyonda KENDİ satırıyla tanımlıysa onun varsayılanı kazanır (station-default-targets) —
 * ebeveyn satırı çeşidin değerlerini sunmaz, aynı varsayılan iki yerden atanamaz.
 */
export function defaultValueOptions(
  propertyId: string,
  catalog: readonly FabricProperty[],
  stationPropertyIds: readonly string[] = [],
): DefaultValueOption[] {
  const own = catalog.find((p) => p.id === propertyId);
  const child = catalog.find(
    (p) => p.variantOfPropertyId === propertyId && !stationPropertyIds.includes(p.id),
  );
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

/**
 * Özellik seçici satırları — K21 hiyerarşisi: çeşit ebeveyninin grubunda, ebeveynin hemen altında
 * "Ebeveyn › Çeşit" etiketiyle durur (aramada iki adla da bulunur).
 */
export function propertyPickerItems(catalog: readonly FabricProperty[]): MultiSelectItem[] {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const parentOf = (p: FabricProperty) => (p.variantOfPropertyId ? byId.get(p.variantOfPropertyId) : undefined);
  const item = (p: FabricProperty): MultiSelectItem => {
    const parent = parentOf(p);
    return {
      id: p.id,
      label: parent ? `${parent.name} › ${p.name}` : p.name,
      hint: p.description ?? p.code,
      group: (parent ?? p).category ?? "Diğer",
      swatch: p.color,
    };
  };
  const out: MultiSelectItem[] = [];
  for (const p of catalog) {
    if (parentOf(p)) continue; // ebeveyninin ardına eklenir
    out.push(item(p));
    for (const c of catalog) if (c.variantOfPropertyId === p.id) out.push(item(c));
  }
  return out;
}
