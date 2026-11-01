// KQ-D3 bekçisi — istasyon ekranının panel düzen tablosu (plan §4.1).
// Negatif sonda: composeStationPanels inspectionEnabled'ı görmezden gelirse
// (hep true) "yalnız kurşun" satırı kırmızı.
import {
  composeStationPanels,
  dativeTr,
  emptyRollHint,
  finishStepLabel,
} from './stationPanels';

const KURSUN = { mode: 'REQUIRED' as const };
const GRAMAJ = { mode: 'OPTIONAL' as const };

describe('composeStationPanels — düzen tablosu', () => {
  const rows: {
    ad: string;
    girdi: Parameters<typeof composeStationPanels>[0];
    kalite: boolean;
    islem: boolean;
    etiket: string;
  }[] = [
    { ad: '(a) yalnız kalite', girdi: { inspectionEnabled: true, properties: [] }, kalite: true, islem: false, etiket: 'KK2 Tamamla' },
    { ad: '(b) yalnız kurşun', girdi: { inspectionEnabled: false, properties: [KURSUN, GRAMAJ] }, kalite: false, islem: true, etiket: 'Tamamla' },
    { ad: '(c) kurşun + kalite', girdi: { inspectionEnabled: true, properties: [KURSUN, GRAMAJ] }, kalite: true, islem: true, etiket: 'KK2 Tamamla' },
    { ad: 'eski backend (alan yok) — bugünkü düzen', girdi: { properties: [{ mode: 'AUTO' }] }, kalite: true, islem: true, etiket: 'KK2 Tamamla' },
    { ad: 'eski backend, özellik yok', girdi: { properties: [] }, kalite: true, islem: false, etiket: 'KK2 Tamamla' },
  ];
  it.each(rows)('$ad', ({ girdi, kalite, islem, etiket }) => {
    const p = composeStationPanels(girdi);
    expect(p.qualityPanel).toBe(kalite);
    expect(p.processPanel).toBe(islem);
    expect(p.completeLabel).toBe(etiket);
    // Çeşit bağı (variantOfPropertyId) olmayan girdi → tek dokunuş yok.
    expect(p.completion).toBe('BUTTON');
  });
});

describe('tek dokunuş (TAP_VALUE) — KQ-D5, K9', () => {
  const VALUES = [{ code: '25GR', name: '25 gr' }, { code: '50GR', name: '50 gr' }];
  const flag = (mode: 'AUTO' | 'OPTIONAL' | 'REQUIRED') =>
    ({ propertyId: 'kursun', valueType: 'FLAG' as const, mode });
  const gramaj = (mode: 'AUTO' | 'OPTIONAL' | 'REQUIRED', id = 'gramaj', of = 'kursun') =>
    ({ propertyId: id, valueType: 'CHOICE' as const, mode, variantOfPropertyId: of, values: VALUES });
  const ekIsaret = { propertyId: 'yikama', valueType: 'FLAG' as const, mode: 'OPTIONAL' as const };
  const rows: {
    ad: string;
    girdi: Parameters<typeof composeStationPanels>[0];
    beklenen: 'BUTTON' | 'TAP_VALUE';
  }[] = [
    { ad: 'yalnız kurşun: KURSUN zorunlu + gramaj zorunlu', girdi: { inspectionEnabled: false, properties: [flag('REQUIRED'), gramaj('REQUIRED')] }, beklenen: 'TAP_VALUE' },
    { ad: 'yalnız kurşun: KURSUN opsiyonel + gramaj', girdi: { inspectionEnabled: false, properties: [flag('OPTIONAL'), gramaj('OPTIONAL')] }, beklenen: 'TAP_VALUE' },
    { ad: 'yalnız kurşun + AUTO ek özellik', girdi: { inspectionEnabled: false, properties: [flag('AUTO'), gramaj('REQUIRED'), { ...ekIsaret, mode: 'AUTO' }] }, beklenen: 'TAP_VALUE' },
    { ad: 'kalite paneli varken (birleşik c)', girdi: { inspectionEnabled: true, properties: [flag('REQUIRED'), gramaj('REQUIRED')] }, beklenen: 'BUTTON' },
    { ad: 'eski backend (inspectionEnabled yok)', girdi: { properties: [flag('REQUIRED'), gramaj('REQUIRED')] }, beklenen: 'BUTTON' },
    { ad: 'iki çeşit özelliği', girdi: { inspectionEnabled: false, properties: [flag('REQUIRED'), gramaj('REQUIRED'), gramaj('REQUIRED', 'renk', 'kursun')] }, beklenen: 'BUTTON' },
    { ad: 'ek işaret (OPSİYONEL bayrak) var', girdi: { inspectionEnabled: false, properties: [flag('REQUIRED'), gramaj('REQUIRED'), ekIsaret] }, beklenen: 'BUTTON' },
    { ad: 'gramaj AUTO (dokunulacak değer yok)', girdi: { inspectionEnabled: false, properties: [flag('REQUIRED'), gramaj('AUTO')] }, beklenen: 'BUTTON' },
    { ad: 'çeşit yok, yalnız bayrak', girdi: { inspectionEnabled: false, properties: [flag('REQUIRED')] }, beklenen: 'BUTTON' },
  ];
  it.each(rows)('$ad → $beklenen', ({ girdi, beklenen }) => {
    const p = composeStationPanels(girdi);
    expect(p.completion).toBe(beklenen);
    expect(p.tap !== null).toBe(beklenen === 'TAP_VALUE');
  });
  it('yapılandırma çeşidi ve bağlı bayrağı taşır', () => {
    const p = composeStationPanels({ inspectionEnabled: false, properties: [flag('OPTIONAL'), gramaj('REQUIRED')] });
    expect(p.tap).toEqual({ variantPropertyId: 'gramaj', variantMode: 'REQUIRED', flagPropertyId: 'kursun', flagMode: 'OPTIONAL' });
    expect(p.completeLabel).toBe('Değere dokun');
  });
});

describe('sonraki istasyon metni', () => {
  it.each([
    ['Tambur', "Tambur'a"],
    ['KK Masa 2', "KK Masa 2'ye"],
    ['Kurşun 1', "Kurşun 1'e"],
    ['Hat 6', "Hat 6'ya"],
    ['Hat 10', "Hat 10'a"],
    ['Hat 20', "Hat 20'ye"],
    ['Zımpara', "Zımpara'ya"],
    ['Ram', "Ram'a"],
    ['Boyahane', "Boyahane'ye"],
    ['KK', "KK'ya"],
    // Ünlü uyumuna uymayan alıntılar + istisna olmayan komşuları (Kanal'a).
    ['Kontrol', "Kontrol'e"],
    ['Kalite Kontrol', "Kalite Kontrol'e"],
    ['KONTROL', "KONTROL'e"],
    ['Saat', "Saat'e"],
    ['Kanal', "Kanal'a"],
    ['Kontrolcü Masa', "Kontrolcü Masa'ya"],
    ['KK1', "KK1'e"],
    ['Excel', "Excel'e"],
  ])('%s → %s', (ad, beklenen) => {
    expect(dativeTr(ad)).toBe(beklenen);
  });

  it('eski backend (alan yok) bugünkü metni çizer', () => {
    expect(finishStepLabel(undefined)).toBe("Adımı Kapat — Toplar Tambur'a");
  });
  it('son adımda yönsüz metin', () => {
    expect(finishStepLabel(null)).toBe('Adımı Kapat');
  });
  it('sonraki istasyon adından', () => {
    expect(finishStepLabel('Paketleme')).toBe("Adımı Kapat — Toplar Paketleme'ye");
  });
});

describe('top seçilmedi ipucu', () => {
  it('tablette kuyruk sağda', () => {
    expect(emptyRollHint(false)).toBe('Sağdaki top kuyruğundan birini seçin');
  });
  it('telefonda kuyruk üst şeritteki çekmecede — "Sağdaki" demez', () => {
    const hint = emptyRollHint(true);
    expect(hint).toContain('Açık İşler');
    expect(hint).not.toMatch(/Sağ/);
  });
});

// D4-D4: `Teks-Erp/scripts/brode-kurulum.ts`in kurduğu iç brode istasyonu (bayrak AUTO + desen
// REQUIRED, muayene kapalı) tabletde desen düğmesi verir; aynı istasyona gramaj da bağlanırsa
// (iki çeşit) düğme düzeni bozulur — kurulum brode'yi ayrı istasyon yapar (DALGA4 §5.8).
describe('iç brode istasyonu (D4-D4 kurulum şekli)', () => {
  const DESENLER = [{ code: 'LALE', name: 'Desen Lale' }, { code: 'PAPATYA', name: 'Desen Papatya' }];
  const brode = { propertyId: 'brode', valueType: 'FLAG' as const, mode: 'AUTO' as const };
  const desen = { propertyId: 'desen', valueType: 'CHOICE' as const, mode: 'REQUIRED' as const, variantOfPropertyId: 'brode', values: DESENLER };
  it('bayrak AUTO + desen REQUIRED → desen düğmesi (TAP_VALUE)', () => {
    const p = composeStationPanels({ inspectionEnabled: false, properties: [brode, desen] });
    expect(p.completion).toBe('TAP_VALUE');
    expect(p.tap).toEqual({ variantPropertyId: 'desen', variantMode: 'REQUIRED', flagPropertyId: 'brode', flagMode: 'AUTO' });
  });
  it('aynı istasyonda kurşun gramajı da varsa → BUTTON', () => {
    const kursun = { propertyId: 'kursun', valueType: 'FLAG' as const, mode: 'AUTO' as const };
    const gramaj = { propertyId: 'gramaj', valueType: 'CHOICE' as const, mode: 'REQUIRED' as const, variantOfPropertyId: 'kursun', values: [{ code: '25GR', name: '25 gr' }] };
    expect(composeStationPanels({ inspectionEnabled: false, properties: [brode, desen, kursun, gramaj] }).completion).toBe('BUTTON');
  });
});
