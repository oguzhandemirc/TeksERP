// =============================================================================
// Kalite Kontrol ekranı = KursunQc'nin kurşun kipi KAPALI hâli (kurşunsuz Detaylı KK)
// =============================================================================
// Gramaj düğmeleri, kurşun özelliği teyidi ve kurşun metni yok; kalite paneli (hata
// girişi + "Kontrolü Tamamla") aynen var. Ekran kopyalanmaz: bağlantı kaynakta ölçülür.
import { composeStationPanels, flowScreenLabels, withoutKursunProps } from './stationPanels';

const KURSUN_PROPS = [
  { propertyId: 'kursun', code: 'KURSUN', name: 'Kurşunlu', mode: 'AUTO' as const, valueType: 'FLAG' as const, values: [] },
  { propertyId: 'gramaj', code: 'KURSUN_GRAMAJI', name: 'Kurşun Gramajı', mode: 'REQUIRED' as const, valueType: 'CHOICE' as const, values: [{ code: '50GR', name: '50 gr' }], variantOfPropertyId: 'kursun' },
];
const OTHER = { propertyId: 'yikama', code: 'YIKAMA', name: 'Yıkama', mode: 'OPTIONAL' as const, valueType: 'FLAG' as const, values: [] };

describe('kurşun kipi kapalı — panel bileşimi', () => {
  it('⭐ kurşun bayrağı + çeşidi (gramaj) düşer, başka özellik kalır', () => {
    expect(withoutKursunProps([...KURSUN_PROPS, OTHER]).map((p) => p.propertyId)).toEqual(['yikama']);
  });

  it('⭐ kurşun kipi kapalı: gramaj dokunuşu ve işlem paneli yok, kalite paneli var', () => {
    const off = composeStationPanels({ inspectionEnabled: true, properties: withoutKursunProps(KURSUN_PROPS) });
    expect(off).toMatchObject({ qualityPanel: true, processPanel: false, completion: 'BUTTON', tap: null, completeLabel: 'Kontrolü Tamamla' });
    // Kıyas: aynı veri kurşun kipinde işlem panelini (gramaj) çizer.
    const on = composeStationPanels({ inspectionEnabled: true, properties: KURSUN_PROPS });
    expect(on.processPanel).toBe(true);
  });

  it('⭐ başlık "Kalite Kontrol — <ad>", metinlerde kurşun yok', () => {
    const l = flowScreenLabels('DETAYLI KK', false);
    expect(l.title).toBe('Kalite Kontrol — DETAYLI KK');
    expect(JSON.stringify(l)).not.toMatch(/[Kk]urşun/);
    expect(JSON.stringify(flowScreenLabels(null, false))).not.toMatch(/[Kk]urşun/);
    expect(flowScreenLabels(null, false).title).toBe('Kalite Kontrol');
  });

  it('kurşun kipi açık: bugünkü metin aynen', () => {
    expect(flowScreenLabels(null)).toEqual(flowScreenLabels(null, true));
    expect(flowScreenLabels(null).title).toBe('Kurşun');
  });
});

describe('ekran bağlantısı (kaynak)', () => {
  const src = jest
    .requireActual<typeof import('fs')>('fs')
    .readFileSync(require.resolve('./KursunQcScreen.tsx'), 'utf8')
    .replace(/\/\/.*$/gm, '');

  it("⭐ kip rota adından: 'KaliteKontrol' = kurşun kapalı", () => {
    expect(src).toMatch(/const kursunEnabled = useRoute\(\)\.name !== 'KaliteKontrol'/);
  });
  it('⭐ kip kapalıyken özellikler withoutKursunProps\'tan, başlık kipe bağlı', () => {
    expect(src).toMatch(/kursunEnabled \? rawStationProps : withoutKursunProps\(rawStationProps\)/);
    expect(src).toMatch(/flowScreenLabels\([^)]*, kursunEnabled\)/);
    // Gramaj paneli ve sayaç şeridi yalnız tek dokunuş düzeninde (panels.tap) çizilir.
    expect(src).toMatch(/const panels = composeStationPanels\(\{[\s\S]{0,120}properties: stationProps/);
  });
});
