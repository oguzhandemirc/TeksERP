// Uyarı türü → BÜYÜK HARFLİ kısa başlık + değer; açıklama kuyruğu düşer; bilinmeyen tür kısaltılır.
import { OTHER_VALUE_MAX, OTHER_WARNING_TITLE, warningLines } from './warningLines';

describe('warningLines', () => {
  it('bilinen türler, eksik alan ve bilinmeyen tür; eylemli iletiler modala girmez', () => {
    const long = 'x'.repeat(100);
    const lines = warningLines([
      { key: 'capraz-METER_VALUES_DIFFER', tone: 'warn', code: 'METER_VALUES_DIFFER', text: 'Belgede iki farklı metre: 238 / 241 — kaynak metreyi belgeyle karşılaştırın' },
      { key: 'eksik-alan', tone: 'warn', text: 'Belgede bulunamadı: Müşteri — formda kontrol edin.', fields: ['Müşteri', 'Parti no'] },
      { key: 'capraz-YENI_KOD', tone: 'warn', code: 'YENI_KOD', text: long },
      { key: 'kismi', tone: 'warn', text: 'Bazı sayfalar okunamadı.', action: 'reread' },
    ]);
    expect(lines.map((l) => `${l.title}: ${l.value}`)).toEqual([
      'İKİ FARKLI METRE TESPİT EDİLDİ: 238 / 241',
      'BELGEDE BULUNAMADI: Müşteri, Parti no',
      `${OTHER_WARNING_TITLE}: ${'x'.repeat(OTHER_VALUE_MAX - 1)}…`,
    ]);
  });
});
