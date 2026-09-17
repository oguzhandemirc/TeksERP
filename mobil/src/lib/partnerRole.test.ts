// Etiket ROLLERDEN, tip'ten değil — sekiz bayrak kombinasyonunun hepsi.
// Negatif sonda (2026-09-17, bir kezlik): fason eki koşulu düşürüldü → 4 kombinasyon ❌.
import { partnerRoleLabel } from './partnerRole';

const r = (c: boolean, s: boolean, f: boolean) => ({ isCustomerRole: c, isSupplierRole: s, isSubcontractorRole: f });

describe('partnerRoleLabel', () => {
  it.each([
    [r(true, false, false), 'Müşteri'],
    [r(false, true, false), 'Tedarikçi'],
    [r(true, true, false), 'Müşteri + Tedarikçi'],
    [r(true, false, true), 'Müşteri + Fason'],
    [r(false, true, true), 'Tedarikçi + Fason'],
    [r(true, true, true), 'Müşteri + Tedarikçi + Fason'],
    [r(false, false, true), 'Fason'],
    [r(false, false, false), 'Rolsüz'],
  ])('%j → %s', (roles, beklenen) => {
    expect(partnerRoleLabel(roles)).toBe(beklenen);
  });
});
