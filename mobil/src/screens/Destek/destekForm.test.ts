import {
  dataUriBase64,
  formuDogrula,
  tokenAfterError,
  hasNoErrors,
  KONU_AZAMI,
  buildTicketBody,
  isReplyValid,
  yeniToken,
} from './destekForm';

const gecerli = { tur: 'BUG' as const, konu: ' Etiket basmıyor ', mesaj: ' Tambur ekranında boş çıkıyor ' };

describe('form doğrulama', () => {
  it('geçerli form hatasızdır', () => {
    expect(hasNoErrors(formuDogrula(gecerli))).toBe(true);
  });

  it('tür, konu ve mesaj zorunlu; boşluk sayılmaz', () => {
    const h = formuDogrula({ tur: null, konu: '   ', mesaj: '\n ' });
    expect(h.tur).toBeTruthy();
    expect(h.konu).toBeTruthy();
    expect(h.mesaj).toBeTruthy();
    expect(hasNoErrors(h)).toBe(false);
  });

  it('konu 200 karakteri aşamaz', () => {
    expect(formuDogrula({ ...gecerli, konu: 'a'.repeat(KONU_AZAMI + 1) }).konu).toBeTruthy();
    expect(formuDogrula({ ...gecerli, konu: 'a'.repeat(KONU_AZAMI) }).konu).toBeUndefined();
  });

  it('yanıt kutusu: boş değil, 20 000 karakteri aşmaz', () => {
    expect(isReplyValid('  ')).toBe(false);
    expect(isReplyValid('tamam')).toBe(true);
    expect(isReplyValid('a'.repeat(20_001))).toBe(false);
  });
});

describe('clientToken — mantıksal deneme başına bir kez', () => {
  let sayac = 0;
  const gen = () => `tok-${++sayac}`;
  beforeEach(() => {
    sayac = 0;
  });

  it('ağ hatası (status yok) → AYNI token', () => {
    expect(tokenAfterError('tok-0', new Error('ağ'), gen)).toBe('tok-0');
  });

  it('5xx / 502 / 504 → AYNI token', () => {
    for (const status of [500, 502, 504]) {
      expect(tokenAfterError('tok-0', { status }, gen)).toBe('tok-0');
    }
  });

  it('429 → AYNI token (istek geçerli, yalnız erken)', () => {
    expect(tokenAfterError('tok-0', { status: 429 }, gen)).toBe('tok-0');
  });

  it('kesin 4xx (400/403/413) → TAZE token', () => {
    expect(tokenAfterError('tok-0', { status: 400 }, gen)).toBe('tok-1');
    expect(tokenAfterError('tok-0', { status: 413 }, gen)).toBe('tok-2');
  });

  it('üretilen token sözleşme biçimine uyar ([A-Za-z0-9_.:-]{1,100})', () => {
    expect(yeniToken()).toMatch(/^[A-Za-z0-9_.:-]{1,100}$/);
  });
});

describe('POST gövdesi', () => {
  it('kırpılmış metin, token ve bağlam taşır; kimlik alanı YOK', () => {
    const g = buildTicketBody({ form: gecerli, clientToken: 'tok', baglam: { screen: 'Tambur' }, ekranJpegBase64: null });
    expect(g).toEqual({
      type: 'BUG',
      subject: 'Etiket basmıyor',
      message: 'Tambur ekranında boş çıkıyor',
      clientToken: 'tok',
      context: { screen: 'Tambur' },
    });
    expect(g).not.toHaveProperty('user');
    expect(g).not.toHaveProperty('tenant');
    expect(g).not.toHaveProperty('files');
  });

  it('ekran görüntüsü tek JPEG dosyası olarak gider', () => {
    const g = buildTicketBody({ form: gecerli, clientToken: 't', baglam: {}, ekranJpegBase64: 'QUJD' });
    expect(g.files).toEqual([{ name: 'ekran.jpg', contentType: 'image/jpeg', dataBase64: 'QUJD' }]);
  });

  it('data-uri öneki atılır (sözleşme: düz base64)', () => {
    expect(dataUriBase64('data:image/jpeg;base64,QU\nJD')).toBe('QUJD');
    expect(dataUriBase64('file:///tmp/a.jpg')).toBeNull();
    expect(dataUriBase64(null)).toBeNull();
  });
});
