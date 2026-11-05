// Bekçi: makine çiplerinde ortak önek ayıklanır; önek yoksa/sonek boş kalacaksa tam ad döner.
import { splitCommonPrefix } from './commonPrefix';

describe('splitCommonPrefix', () => {
  it('kelime düzeyinde ortak öneki ayırır', () => {
    expect(splitCommonPrefix(['KURŞUN MAKİNESİ 10', 'KURŞUN MAKİNESİ 1', 'KURŞUN MAKİNESİ 3']))
      .toEqual({ prefix: 'KURŞUN MAKİNESİ', labels: ['10', '1', '3'] });
  });
  it('ortak önek yoksa tam adlar', () => {
    expect(splitCommonPrefix(['KURŞUN MAKİNESİ 10', 'K-3 Yeni'])).toEqual({ prefix: null, labels: ['KURŞUN MAKİNESİ 10', 'K-3 Yeni'] });
  });
  it('bir ad önekin kendisiyse sonek boş kalmaz', () => {
    const r = splitCommonPrefix(['Ram 2', 'Ram 2 Yeni']);
    expect(r.prefix).toBe('Ram');
    expect(r.labels).toEqual(['2', '2 Yeni']);
  });
  it('tek ad ve harf büyüklüğü farkı (ham karşılaştırma)', () => {
    expect(splitCommonPrefix(['Makine 1'])).toEqual({ prefix: null, labels: ['Makine 1'] });
    expect(splitCommonPrefix(['makine 1', 'Makine 2']).prefix).toBeNull();
  });
});
