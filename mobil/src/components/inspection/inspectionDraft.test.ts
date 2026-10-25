// K4P-TABLET — muayene taslağı (saf): ekle/geri al/temizle, sabit puan, boyut puanı, tekrar reddi, sayım.
import { EMPTY_DRAFT, draftCounts, draftPointsOf, inspectionDraftReducer as r, isDraftEmpty, type InspectionDraft } from './inspectionDraft';
import { draftToWireDefects } from './inspectionWire';

type Extra = { sizeClass?: 'S1' | 'S2' | 'S3' | 'S4'; fixedPoints?: number | null };
const add = (d: InspectionDraft, id: string, at: [typeId: string, meter: number | null], extra: Extra = {}) =>
  r(d, { type: 'add', id, defectTypeId: at[0], meter: at[1], ...extra });

describe('inspectionDraft', () => {
  it('boyut sınıfı puanı 1–4; sabit puanlı tür boyuttan bağımsız', () => {
    expect(draftPointsOf('S1', null)).toBe(1);
    expect(draftPointsOf('S4', undefined)).toBe(4);
    expect(draftPointsOf(undefined, 4)).toBe(4);
    expect(draftPointsOf('S1', 3)).toBe(3);
    expect(draftPointsOf(undefined, null)).toBeNull();
  });

  it('ekle → sayım özeti (hata sayısı + puan toplamı)', () => {
    let d = add(EMPTY_DRAFT, 'a', ['leke', 37.5], { sizeClass: 'S2' });
    d = add(d, 'b', ['atki', null], { sizeClass: 'S1' });
    d = add(d, 'c', ['delik', 12], { fixedPoints: 4 });
    expect(draftCounts(d)).toEqual({ defectCount: 3, totalPoints: 7 });
    expect(d.defects[2]).toMatchObject({ sizeClass: null, points: 4 });
  });

  it('boyutsuz ve sabit puansız kayıt düşmez', () => {
    expect(add(EMPTY_DRAFT, 'a', ['leke', 5])).toBe(EMPTY_DRAFT);
  });

  it('aynı metre + aynı tür reddedilir; konumsuz tekrar ve farklı tür serbest', () => {
    let d = add(EMPTY_DRAFT, 'a', ['leke', 10], { sizeClass: 'S1' });
    expect(add(d, 'b', ['leke', 10.0001], { sizeClass: 'S3' })).toBe(d);
    d = add(d, 'c', ['atki', 10], { sizeClass: 'S1' });
    d = add(d, 'd', ['leke', null], { sizeClass: 'S1' });
    d = add(d, 'e', ['leke', null], { sizeClass: 'S1' });
    expect(d.defects.map((x) => x.id)).toEqual(['a', 'c', 'd', 'e']);
  });

  it('geri al son kaydı siler; sil id ile; temizle boş taslağa döner', () => {
    let d = add(EMPTY_DRAFT, 'a', ['leke', 1], { sizeClass: 'S1' });
    d = add(d, 'b', ['leke', 2], { sizeClass: 'S2' });
    d = r(d, { type: 'undoLast' });
    expect(d.defects.map((x) => x.id)).toEqual(['a']);
    expect(r(EMPTY_DRAFT, { type: 'undoLast' })).toBe(EMPTY_DRAFT);
    d = r(d, { type: 'setNote', note: 'kenar' });
    expect(r(d, { type: 'remove', id: 'a' }).defects).toEqual([]);
    expect(r(d, { type: 'clear' })).toBe(EMPTY_DRAFT);
  });

  it('not ve muayene uzunluğu; boş taslak ölçümü', () => {
    let d = r(EMPTY_DRAFT, { type: 'setInspectedLength', value: 90 });
    expect(d.inspectedLengthM).toBe(90);
    expect(isDraftEmpty(d)).toBe(false);
    d = r(d, { type: 'setInspectedLength', value: 0 });
    expect(d.inspectedLengthM).toBeNull();
    expect(isDraftEmpty(d)).toBe(true);
  });

  it('tel biçimi: S1–S4 → sunucu FourPointSize, sabit puan → null', () => {
    let d = add(EMPTY_DRAFT, 'a', ['leke', 37.5], { sizeClass: 'S2' });
    d = add(d, 'b', ['delik', null], { fixedPoints: 4 });
    expect(draftToWireDefects(d)).toEqual([
      { defectTypeId: 'leke', sizeClass: 'IN_3_TO_6', startMeter: 37.5 },
      { defectTypeId: 'delik', sizeClass: null, startMeter: null },
    ]);
  });
});
