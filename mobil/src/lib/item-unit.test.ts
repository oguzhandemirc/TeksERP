// Backend `constants/item-unit.ts` ikizi + "Açık" rozeti metni (MEASURED_LINE, #7).
// KG/ADET satırda backend `openQty`yi null gönderir; tablet rakam UYDURMAZ.
import { isMeasuredUnit, openQtyText, unitLabel } from './item-unit';

describe('isMeasuredUnit (backend ikizi)', () => {
  it('MT ve belirsiz (eski backend) → ölçülür', () => {
    expect(isMeasuredUnit('MT')).toBe(true);
    expect(isMeasuredUnit(null)).toBe(true);
    expect(isMeasuredUnit(undefined)).toBe(true);
  });
  it('KG / ADET → ölçülmez', () => {
    expect(isMeasuredUnit('KG')).toBe(false);
    expect(isMeasuredUnit('ADET')).toBe(false);
  });
});

describe('openQtyText', () => {
  it('sayı → yuvarlanmış metre', () => {
    expect(openQtyText(60)).toBe('60m');
    expect(openQtyText(59.6)).toBe('60m');
    expect(openQtyText(0)).toBe('0m');
  });
  it("null (KG/ADET) → 'ölçülmüyor' — 0m'ye DÜŞÜLMEZ", () => {
    expect(openQtyText(null)).toBe('ölçülmüyor');
    expect(openQtyText(undefined)).toBe('ölçülmüyor');
  });
});

describe('unitLabel', () => {
  it('kod → etiket; belirsiz → m', () => {
    expect(unitLabel('KG')).toBe('kg');
    expect(unitLabel(null)).toBe('m');
  });
});
