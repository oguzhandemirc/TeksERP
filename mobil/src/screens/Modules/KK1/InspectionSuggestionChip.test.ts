// K4P-TABLET — öneri çipi modeli: yalnız sunucu önerisi; kod katalogda yoksa dokunulamaz; otomatik doldurma yok.
import { suggestionChipModel } from './InspectionSuggestionChip';
import type { PreviewState } from '../../../components/inspection/useInspectionPreview';
import type { QualityGrade } from '../../../types/models';

const grades = [{ id: 'g1', code: 'Q1', name: '1.KALİTE' }] as QualityGrade[];
const ok = (suggested: unknown, per100: string | null = '9.84'): PreviewState =>
  ({ status: 'ok', data: { pointsPer100M2: per100, suggested } }) as unknown as PreviewState;

describe('suggestionChipModel', () => {
  it('"ÖNERİ: 1.KALİTE · A · 9,8" + uygulanabilir kod', () => {
    expect(suggestionChipModel(ok({ code: 'Q1', label: 'A' }), grades)).toEqual({ text: 'ÖNERİ: 1.KALİTE · A · 9,8', code: 'Q1' });
  });
  it('bant derecesiz ya da kod katalogda yok → metin var, kod yok', () => {
    expect(suggestionChipModel(ok({ code: null, label: 'C' }), grades)).toEqual({ text: 'ÖNERİ: C · 9,8', code: null });
    expect(suggestionChipModel(ok({ code: 'QX', label: 'B' }, null), grades)).toEqual({ text: 'ÖNERİ: QX · B', code: null });
  });
  it('öneri yok / çevrimdışı / hata → çip yok', () => {
    expect(suggestionChipModel(ok(null), grades)).toBeNull();
    expect(suggestionChipModel({ status: 'offline', data: null }, grades)).toBeNull();
    expect(suggestionChipModel({ status: 'error', data: null }, grades)).toBeNull();
  });
});
