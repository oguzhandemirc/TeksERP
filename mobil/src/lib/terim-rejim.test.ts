import { TERIM, terimDokumaAyarla } from './terim';
import { applyTermRegime } from './terim-rejim';

// K20: tablette WorkOrder adı dokuma rejiminden — kapalı "İş Emri", açık/bilinmiyor "Terbiye İş Emri".
describe('terim rejimi (K20)', () => {
  afterEach(() => {
    terimDokumaAyarla(true);
  });

  it('varsayılan bugünkü ad', () => {
    expect(TERIM.terbiyeIsEmri.tekil).toBe('Terbiye İş Emri');
  });

  it('dokuma kapalı → İş Emri; büyük harf ve cümle başı biçimleri', () => {
    expect(applyTermRegime({ productionEnabled: true, dokumaEnabled: false })).toBe(true);
    expect(`${TERIM.terbiyeIsEmri.tekil} oluştur`).toBe('İş Emri oluştur');
    expect(`${TERIM.terbiyeIsEmri.tekilBuyuk}Nİ BAŞLAT`).toBe('İŞ EMRİNİ BAŞLAT');
    expect(TERIM.terbiyeIsEmri.cumleBasi.bulunma).toBe('İş emrinde');
  });

  it('dokuma açık → Terbiye İş Emri; alanı tanımayan yanıt dokunmaz', () => {
    applyTermRegime({ productionEnabled: true, dokumaEnabled: false });
    applyTermRegime({ productionEnabled: true, dokumaEnabled: true });
    expect(TERIM.terbiyeIsEmri.cogul).toBe('Terbiye İş Emirleri');
    expect(applyTermRegime(undefined)).toBe(false);
    expect(TERIM.terbiyeIsEmri.tekil).toBe('Terbiye İş Emri');
  });
});
