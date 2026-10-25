// KQ-D3 bekçisi — istasyon ekranının panel düzen tablosu (plan §4.1).
// Negatif sonda: composeStationPanels inspectionEnabled'ı görmezden gelirse
// (hep true) "yalnız kurşun" satırı kırmızı.
import {
  composeStationPanels,
  dativeTr,
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
    // TAP_VALUE dalını D5 açar.
    expect(p.completion).toBe('BUTTON');
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
