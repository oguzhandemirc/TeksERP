import { TERIM, terimDokumaAyarla } from '../../../../lib/terim';
import { applyTermRegime } from '../../../../lib/terim-rejim';
import {
  anahtarAdlari,
  dokumaAnahtariGorunur,
  dokumaBosDurum,
  dokumaSorgusu,
  etkinIsEmriTuru,
  metreMetni,
  parseIsEmriTuru,
  tezgahMetni,
  DOKUMA_VARSAYILAN_FILTRE,
} from './dokumaListe';

const izin = (...codes: string[]) => (c: string) => codes.includes(c);
const ACIK = { productionEnabled: true, dokumaEnabled: true };

afterEach(() => terimDokumaAyarla(true));

describe('Dokuma anahtarı görünürlüğü', () => {
  it('dokuma açık + okuma izni → görünür (iki izin de yeter)', () => {
    expect(dokumaAnahtariGorunur(ACIK, izin('mobile:dokuma'))).toBe(true);
    expect(dokumaAnahtariGorunur(ACIK, izin('weavingorder:read'))).toBe(true);
  });

  it('dokuma kapalı / üretim kapalı / bayrak yüklenmedi → görünmez (fail-closed)', () => {
    expect(dokumaAnahtariGorunur({ productionEnabled: true, dokumaEnabled: false }, izin('mobile:dokuma'))).toBe(false);
    expect(dokumaAnahtariGorunur({ productionEnabled: false, dokumaEnabled: true }, izin('mobile:dokuma'))).toBe(false);
    expect(dokumaAnahtariGorunur(undefined, izin('mobile:dokuma'))).toBe(false);
    expect(dokumaAnahtariGorunur({ productionEnabled: true }, izin('mobile:dokuma'))).toBe(false);
  });

  it('izin yok ya da yalnız mobile:kk1 (genel bakışı açmaz) → görünmez', () => {
    expect(dokumaAnahtariGorunur(ACIK, izin())).toBe(false);
    expect(dokumaAnahtariGorunur(ACIK, izin('mobile:kk1', 'mobile:hizli-is-emri'))).toBe(false);
  });

  it('dokuma kapalı fabrikada başlık "İş Emirleri" (Terbiye değil) ve anahtar yok — Gülkesim', () => {
    const flags = { productionEnabled: true, dokumaEnabled: false };
    applyTermRegime(flags);
    expect(dokumaAnahtariGorunur(flags, izin('mobile:dokuma'))).toBe(false);
    expect(TERIM.terbiyeIsEmri.cogul).toBe('İş Emirleri');
  });
});

describe('Seçim', () => {
  it('kayıt yalnız birebir "dokuma" ise dokuma; bozuk/yok → terbiye', () => {
    expect(parseIsEmriTuru('dokuma')).toBe('dokuma');
    expect(parseIsEmriTuru('terbiye')).toBe('terbiye');
    expect(parseIsEmriTuru(null)).toBe('terbiye');
    expect(parseIsEmriTuru('DOKUMA')).toBe('terbiye');
  });

  it('anahtar görünmüyorsa kayıtlı dokuma seçimi terbiyeye düşer', () => {
    expect(etkinIsEmriTuru('dokuma', true)).toBe('dokuma');
    expect(etkinIsEmriTuru('dokuma', false)).toBe('terbiye');
    expect(etkinIsEmriTuru('terbiye', true)).toBe('terbiye');
  });

  it('adlar TERIM\'den, sabit sırada; kısa ad ilk kelime', () => {
    const a = anahtarAdlari();
    expect(a.map((x) => x.tur)).toEqual(['terbiye', 'dokuma']);
    expect(a.map((x) => x.ad)).toEqual(['Terbiye İş Emirleri', 'Dokuma İş Emirleri']);
    expect(a.map((x) => x.kisa)).toEqual(['Terbiye', 'Dokuma']);
  });
});

describe('Süzgeç → sunucu parametreleri', () => {
  it('varsayılan = açık işler (PLANNED,IN_PROGRESS), arama yok', () => {
    expect(dokumaSorgusu(DOKUMA_VARSAYILAN_FILTRE)).toEqual({ status: 'PLANNED,IN_PROGRESS' });
  });
  it('Tümü → status gönderilmez; tek durum; kısa arama gitmez, uzun arama kırpılıp gider', () => {
    expect(dokumaSorgusu({ search: '', durum: 'ALL' })).toEqual({});
    expect(dokumaSorgusu({ search: ' a ', durum: 'COMPLETED' })).toEqual({ status: 'COMPLETED' });
    expect(dokumaSorgusu({ search: '  DK-12 ', durum: 'ALL' })).toEqual({ search: 'DK-12' });
  });
  it('boş liste: arama → temizle · durum süzgeci → tüm durumlar · Tümü → çıkışsız', () => {
    expect(dokumaBosDurum({ search: 'abc', durum: 'OPEN' }).action).toBe('clearFilters');
    expect(dokumaBosDurum({ search: '', durum: 'OPEN' }).action).toBe('showAllStatuses');
    expect(dokumaBosDurum({ search: '', durum: 'ALL' }).action).toBeNull();
  });
});

describe('Hücre metinleri', () => {
  const t = (n: string) => ({ id: n, code: n, name: `Tezgah ${n}` });
  it('tezgah: tek · çok (+N) · yok · eski sunucu (alan yok) · fason', () => {
    expect(tezgahMetni({ executionKind: 'IN_HOUSE', subcontractor: null, openRunMachines: [t('7')] })).toBe('Tezgah 7');
    expect(tezgahMetni({ executionKind: 'IN_HOUSE', subcontractor: null, openRunMachines: [t('7'), t('9')] })).toBe('Tezgah 7 +1');
    expect(tezgahMetni({ executionKind: 'IN_HOUSE', subcontractor: null, openRunMachines: [] })).toBe('—');
    expect(tezgahMetni({ executionKind: 'IN_HOUSE', subcontractor: null, openRunCount: 2 })).toBe('2 açık koşum');
    expect(tezgahMetni({ executionKind: 'SUBCONTRACTED', subcontractor: { id: 's', code: 's', name: 'Ahmet Dokuma' } })).toBe('Fason · Ahmet Dokuma');
  });
  it('metre: ölçülmemiş "—" (0 uydurulmaz), hedefsiz "açık uçlu"', () => {
    expect(metreMetni({ plannedM: 1500, producedM: 155.4 })).toBe('155 / 1.500 m');
    expect(metreMetni({ plannedM: 500, producedM: null })).toBe('— / 500 m');
    expect(metreMetni({ plannedM: null, producedM: undefined })).toBe('— / açık uçlu');
  });
});
