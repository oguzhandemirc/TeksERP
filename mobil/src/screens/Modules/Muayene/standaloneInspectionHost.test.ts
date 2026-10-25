// K4P-EKRAN — bağımsız muayene konağının saf yarısı: kapı, taslak anahtarı, gövde, hata metinleri, şerit.
import {
  activeInspectionText, rollStripParts, saveBlockReason, saveErrorText, standaloneCreateBody, standaloneDraftKey, standaloneInspectionVisible,
} from './standaloneInspectionHost';
import { kk1InspectionDraftKey } from '../KK1/kk1InspectionHost';

const draft = {
  defects: [
    { id: 'a', defectTypeId: 't1', sizeClass: 'S2' as const, meter: 12.5, points: 2 },
    { id: 'b', defectTypeId: 't2', sizeClass: null, meter: null, points: 4 },
  ],
  note: '  kenar dalgalı ',
  inspectedLengthM: null,
};

describe('standaloneInspectionHost', () => {
  it('kapı: modül ∧ mobile:muayene (inspection:write tek başına AÇMAZ)', () => {
    const has = (set: string[]) => (c: string) => set.includes(c);
    expect(standaloneInspectionVisible({ moduleEnabled: true, hasPermission: has(['mobile:muayene']) })).toBe(true);
    expect(standaloneInspectionVisible({ moduleEnabled: false, hasPermission: has(['mobile:muayene']) })).toBe(false);
    expect(standaloneInspectionVisible({ moduleEnabled: true, hasPermission: has(['inspection:write']) })).toBe(false);
  });

  it('taslak anahtarı top başına; KK1 doğuş anahtarıyla çakışmaz', () => {
    expect(standaloneDraftKey('r1')).toBe('standalone|r1');
    expect(standaloneDraftKey('r1')).not.toBe(standaloneDraftKey('r2'));
    expect(standaloneDraftKey('r1')).not.toBe(kk1InspectionDraftKey('r1'));
  });

  it('gövde: aşama YOK (sunucu türetir), not kırpılır, token gider; istasyon yalnız muayeneye açıksa', () => {
    const b = standaloneCreateBody('r1', draft, 'tok-1', { id: 's1', canInspect: true });
    expect(b).toEqual({
      rollId: 'r1',
      defects: [
        { defectTypeId: 't1', sizeClass: 'IN_3_TO_6', startMeter: 12.5 },
        { defectTypeId: 't2', sizeClass: null, startMeter: null },
      ],
      note: 'kenar dalgalı',
      stationId: 's1',
      clientToken: 'tok-1',
    });
    expect('phase' in b).toBe(false);
    expect(standaloneCreateBody('r1', draft, 't', { id: 's1', canInspect: false }).stationId).toBeUndefined();
    expect(standaloneCreateBody('r1', draft, 't', { id: 's1' }).stationId).toBeUndefined();
    expect(standaloneCreateBody('r1', draft, 't', null).stationId).toBeUndefined();
  });

  it('hata metinleri details.code’tan', () => {
    expect(saveErrorText({ status: 409, message: 'x', details: { code: 'INSPECTION_ALREADY_ACTIVE' } })).toBe('Bu topun muayenesi var — panelden düzeltilir');
    expect(saveErrorText({ status: 403, message: 'x', details: { code: 'MODULE_DISABLED' } })).toBe('Kalite güvence modülü kapalı');
    expect(saveErrorText({ message: 'Network Error' })).toMatch(/ulaşılamadı/);
    expect(saveErrorText({ status: 502, message: 'Bad' })).toMatch(/ulaşılamadı/);
    expect(saveErrorText({ status: 400, message: 'Metre topun boyunu aşıyor' })).toBe('Metre topun boyunu aşıyor');
    expect(activeInspectionText({ revision: 2 })).toBe('Bu topun r2 muayenesi var — panelden düzeltilir');
  });

  it('kayıt engeli: top yok · aktif muayene · çevrimdışı · uçuşta', () => {
    expect(saveBlockReason({ rollId: null, isOnline: true, active: null, busy: false })).toBe('Önce top okutun');
    expect(saveBlockReason({ rollId: 'r', isOnline: true, active: { id: 'i' }, busy: false })).toBe('Aktif muayene var');
    expect(saveBlockReason({ rollId: 'r', isOnline: false, active: null, busy: false })).toBe('Çevrimdışı');
    expect(saveBlockReason({ rollId: 'r', isOnline: true, active: null, busy: true })).toBe('Kaydediliyor');
    expect(saveBlockReason({ rollId: 'r', isOnline: true, active: null, busy: false })).toBeNull();
  });

  it('şerit: barkod · kumaş · metre (virgül) · en (kaynak) · kalite', () => {
    const roll = { barcode: 'T240001', currentQty: 96, qualityGrade: '1.KALİTE', item: { name: 'PANAMA' } };
    expect(rollStripParts(roll, { widthCm: '280.00', widthSource: 'ITEM_CARD' })).toEqual(['T240001', 'PANAMA', '96,0 m', 'en 280 (kart)', '1.KALİTE']);
    expect(rollStripParts(roll, { widthCm: null, widthSource: 'UNKNOWN' })[3]).toBe('en bilinmiyor');
    expect(rollStripParts(roll, null)[3]).toBe('en …');
  });
});
