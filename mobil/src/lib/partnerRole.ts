// İş Ortağı Rol Modeli (D1, 2026-09-17): kart tek, roller ÜÇ BAYRAK. Etiket ROLLERDEN
// üretilir, `type`tan değil — `type` türetilmiş ve fasonu taşımaz (fason bir ROL, tip değil).
// Backend eşi: `services/helpers/partner-roles.helper.ts` (`resolveCompanyType` ters yönü).
export interface PartnerRoles {
  isCustomerRole: boolean;
  isSupplierRole: boolean;
  isSubcontractorRole: boolean;
}

/** "Müşteri" · "Tedarikçi" · "Müşteri + Tedarikçi" · "+ Fason" eki · rolsüz kart "Rolsüz". */
export function partnerRoleLabel(r: PartnerRoles): string {
  const parts: string[] = [];
  if (r.isCustomerRole) parts.push('Müşteri');
  if (r.isSupplierRole) parts.push('Tedarikçi');
  let label = parts.join(' + ');
  if (r.isSubcontractorRole) label = label ? `${label} + Fason` : 'Fason';
  return label || 'Rolsüz';
}
