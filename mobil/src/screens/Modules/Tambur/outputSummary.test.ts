// "Çıkan etiketler" özeti ve KG sütunu: basılan metre (initialQty), kg yalnız tartılmışlardan; yoksa "—".
import { kgCellText, outputSummaryText, outputTotals } from './outputSummary';

describe('outputSummary', () => {
  it('kg yoksa "—"', () => {
    const t = outputTotals([{ initialQty: 40, weightKg: null }, { initialQty: 90, weightKg: null }] as never);
    expect(outputSummaryText({ ...t, count: 4 })).toBe('4 top · 130.0 m · — kg');
    expect(kgCellText(null)).toBe('—');
  });
  it('tartılmışların kg toplamı', () => {
    const t = outputTotals([{ initialQty: 10, weightKg: 2.5 }, { initialQty: 5, weightKg: null }, { initialQty: 5, weightKg: '1.5' }] as never);
    expect(outputSummaryText(t)).toBe('3 top · 20.0 m · 4.0 kg');
    expect(kgCellText(2.5)).toBe('2.5 kg');
  });
});
