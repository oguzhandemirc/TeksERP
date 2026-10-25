// K4P-TABLET — KK1 muayene konağı: gösterim kapısı doğruluk tablosu, gövde parçası, taslak anahtarı, uyarı.
import { EMPTY_DRAFT, inspectionDraftReducer } from '../../../components/inspection/inspectionDraft';
import { inspectionDraftKey } from '../../../components/inspection/inspectionDraftStore';
import {
  inspectionNotSavedToast,
  kk1BirthInspectionPayload,
  kk1InspectionDraftKey,
  kk1InspectionVisible,
  withoutInspectionWarning,
} from './kk1InspectionHost';

const perms = (...codes: string[]) => (c: string) => codes.includes(c);

describe('kk1InspectionVisible — TEK yüklem', () => {
  const cases: [string, boolean, string[], { canInspect?: unknown } | null | undefined, boolean][] = [
    ['hepsi açık', true, ['inspection:write'], { canInspect: true }, true],
    ['modül kapalı', false, ['inspection:write'], { canInspect: true }, false],
    ['izin yok', true, ['inspection:read'], { canInspect: true }, false],
    ['istasyon muayeneye kapalı', true, ['inspection:write'], { canInspect: false }, false],
    ['eski sunucu (alan yok)', true, ['inspection:write'], {}, false],
    ['oturum yok', true, ['inspection:write'], null, false],
    ['alan doğru-benzeri ama boolean değil', true, ['inspection:write'], { canInspect: 'true' }, false],
  ];
  it.each(cases)('%s', (...row) => {
    const [, moduleEnabled, codes, station, expected] = row;
    expect(kk1InspectionVisible({ moduleEnabled, hasPermission: perms(...codes), station })).toBe(expected);
  });
});

describe('kk1BirthInspectionPayload', () => {
  const draft = inspectionDraftReducer(
    inspectionDraftReducer(EMPTY_DRAFT, { type: 'add', id: 'a', defectTypeId: 'leke', meter: 37.5, sizeClass: 'S2' }),
    { type: 'setNote', note: '  kenar  ' },
  );
  it('kapı kapalı ya da taslak boş → BOŞ (bugünkü gövde)', () => {
    expect(kk1BirthInspectionPayload(draft, false)).toEqual({});
    expect(kk1BirthInspectionPayload(EMPTY_DRAFT, true)).toEqual({});
  });
  it('taslak → inspection {defects, note}; uzunluk yalnız girildiyse', () => {
    expect(kk1BirthInspectionPayload(draft, true)).toEqual({
      inspection: { defects: [{ defectTypeId: 'leke', sizeClass: 'IN_3_TO_6', startMeter: 37.5 }], note: 'kenar' },
    });
    const withLen = inspectionDraftReducer(draft, { type: 'setInspectedLength', value: 90 });
    expect(kk1BirthInspectionPayload(withLen, true).inspection?.inspectedLengthM).toBe(90);
  });
});

describe('taslak anahtarı', () => {
  it('konak + istasyon ayırır; ayraç parçadan sızamaz', () => {
    expect(kk1InspectionDraftKey('s1')).not.toBe(kk1InspectionDraftKey('s2'));
    expect(kk1InspectionDraftKey(null)).toBe(kk1InspectionDraftKey(undefined));
    expect(inspectionDraftKey('a|b', 'c')).not.toBe(inspectionDraftKey('a', 'b|c'));
    expect(inspectionDraftKey('kk1-birth', 'roll:X')).not.toBe(kk1InspectionDraftKey('X'));
  });
});

describe('INSPECTION_NOT_SAVED', () => {
  const ns = { code: 'INSPECTION_NOT_SAVED', reason: 'STATION_NO_QUALITY', message: 'Muayene kaydedilmedi: bu istasyonda kalite muayenesi kapalı. Top kaydedildi.' };
  it('turuncu toast metni "kaydedilmedi" + sebep', () => {
    expect(inspectionNotSavedToast(ns, 'T1')).toEqual({ text1: 'Muayene kaydedilmedi: bu istasyonda muayene kapalı', text2: 'T1 — top kaydedildi, muayeneyi panelden girin' });
    expect(inspectionNotSavedToast(undefined)).toBeNull();
    expect(inspectionNotSavedToast({ code: 'OTHER' })).toBeNull();
  });
  it('genel uyarı kanalından muayene metni düşer (çift mesaj yok)', () => {
    expect(withoutInspectionWarning(['levent', ns.message], ns)).toEqual(['levent']);
    expect(withoutInspectionWarning(['levent'], undefined)).toEqual(['levent']);
    expect(withoutInspectionWarning(undefined, ns)).toBeUndefined();
  });
});
