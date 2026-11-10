// İE hedefi = SEÇİM özelliğinin varsayılan seçimi; elle seçim ezilmez; hedef yoksa seçimsiz.
import { applyChoiceTargetDefaults, choiceTargetDefaults, type ChoiceTargetProp } from './choiceTargetDefaults';

const gramaj: ChoiceTargetProp = { propertyId: 'p-gr', mode: 'REQUIRED', valueType: 'CHOICE', values: [{ code: '25GR' }, { code: '50GR' }, { code: '70GR' }] };
const renk: ChoiceTargetProp = { propertyId: 'p-renk', mode: 'OPTIONAL', valueType: 'CHOICE', values: [{ code: 'BEYAZ' }, { code: 'EKRU' }] };
const flag: ChoiceTargetProp = { propertyId: 'p-flag', mode: 'OPTIONAL', valueType: 'FLAG' };
const auto: ChoiceTargetProp = { propertyId: 'p-auto', mode: 'AUTO', valueType: 'CHOICE', values: [{ code: 'X' }] };

describe('choiceTargetDefaults', () => {
  it('⭐ İE hedefi olan her tuşlu SEÇİM özelliği (kurşuna özgü değil)', () => {
    const t = [{ propertyId: 'p-gr', valueCode: '50GR' }, { propertyId: 'p-renk', valueCode: 'EKRU' }];
    expect(choiceTargetDefaults([gramaj, renk], t)).toEqual({ 'p-gr': '50GR', 'p-renk': 'EKRU' });
  });
  it('hedef yok / eski backend → boş (seçimsiz kalır)', () => {
    expect(choiceTargetDefaults([gramaj], [])).toEqual({});
    expect(choiceTargetDefaults([gramaj], undefined)).toEqual({});
  });
  it('katalogda olmayan hedef kodu, BAYRAK ve AUTO özellik ön seçilmez', () => {
    const t = [{ propertyId: 'p-gr', valueCode: '99GR' }, { propertyId: 'p-flag', valueCode: 'x' }, { propertyId: 'p-auto', valueCode: 'X' }];
    expect(choiceTargetDefaults([gramaj, flag, auto], t)).toEqual({});
  });
});

describe('applyChoiceTargetDefaults', () => {
  const d = { 'p-gr': '50GR' };
  it('⭐ yeni top (boş cevap) → hedef seçili gelir', () => {
    expect(applyChoiceTargetDefaults({}, d, new Set())).toEqual({ 'p-gr': '50GR' });
  });
  it('⭐ elle değiştirilen seçim ezilmez (hedef tazelense de)', () => {
    expect(applyChoiceTargetDefaults({ 'p-gr': '70GR' }, d, new Set(['p-gr']))).toEqual({ 'p-gr': '70GR' });
  });
  it('elle kaldırılan seçim geri gelmez', () => {
    expect(applyChoiceTargetDefaults({}, d, new Set(['p-gr']))).toEqual({});
  });
  it('dokunulmamış seçimin hedefi kalkarsa düşer; diğer dokunulmuş cevaplar korunur', () => {
    expect(applyChoiceTargetDefaults({ 'p-gr': '50GR', 'p-flag': true }, {}, new Set(['p-flag']))).toEqual({ 'p-flag': true });
  });
  it('değişiklik yoksa aynı nesne döner (gereksiz render yok)', () => {
    const prev = { 'p-gr': '50GR' };
    expect(applyChoiceTargetDefaults(prev, d, new Set())).toBe(prev);
  });
});
