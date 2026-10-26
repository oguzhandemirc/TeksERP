import { DOC_TYPE_TO_KEY } from "@/services/documentConfig";
import type { AffectedParty, DocumentTemplateRow, ProfileCatalogRow, TemplateAssignments } from "@/services/documentTemplateService";

// Atamalar sekmesinin SAF kuralları (plan §3.7, R4): kim atanabilir, ne etkilenir, ne uyarılır.

/** Yalnız bu türün ACTIVE + yayında şablonu atanabilir (sunucu da 409 `TEMPLATE_NOT_ASSIGNABLE` ile korur). */
export function assignableTemplates(rows: DocumentTemplateRow[], docType: string): DocumentTemplateRow[] {
  return rows.filter((t) => t.docType === docType && t.status === "ACTIVE" && !!t.publishedVersionId);
}

export function defaultOf(a: TemplateAssignments | undefined, docType: string) {
  return a?.defaults.find((d) => d.docType === docType)?.template ?? null;
}

export function profileTemplateOf(a: TemplateAssignments | undefined, profileId: string, docType: string) {
  return a?.profiles?.find((p) => p.profile.id === profileId && p.docType === docType)?.template ?? null;
}

/** Profilin bu türde genel ayarı ezen config'i var mı (R4: şablonun `ayar`ı üstüne uygulanır). */
export function hasConfigOverride(p: ProfileCatalogRow, docType: string): boolean {
  const key = DOC_TYPE_TO_KEY[docType];
  return !!key && p.overrideKeys.includes(key);
}

export function affectedNames(p: Pick<ProfileCatalogRow, "affected">): { customers: AffectedParty[]; subcontractors: AffectedParty[]; total: number } {
  const { customers, subcontractors } = p.affected;
  return { customers, subcontractors, total: customers.length + subcontractors.length };
}

/** Tür varsayılanı değişince ETKİLENMEYEN profiller: bu türde kendi ataması olanlar. */
export function profilesShieldedFromDefault(catalog: ProfileCatalogRow[], a: TemplateAssignments | undefined, docType: string): ProfileCatalogRow[] {
  return catalog.filter((p) => profileTemplateOf(a, p.id, docType) !== null);
}

/** Atama değişikliği gerçekten bir şey değiştiriyor mu (aynı şablon → düğme pasif). */
export function isNoop(current: { id: string } | null, next: string | null): boolean {
  return (current?.id ?? null) === next;
}
