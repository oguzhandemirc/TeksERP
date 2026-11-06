import { COLUMNS, DEFAULT_VISIBLE, REQUIRED_COLUMNS, columnsStorageKey, normalizeColumns, parseStoredColumns, serializeColumns, toggleColumn } from './columns';

describe('İş Emirleri sütun tercihleri', () => {
  it('zorunlu sütunlar İE no + Şu an nerede; varsayılan: no, müşteri, kumaş, konum, durum (görüntü sırasında)', () => {
    expect([...REQUIRED_COLUMNS].sort()).toEqual(['konum', 'no']);
    expect(parseStoredColumns(null)).toEqual(['no', 'musteri', 'kumas', 'konum', 'durum']);
    expect([...DEFAULT_VISIBLE].sort()).toEqual(['durum', 'konum', 'kumas', 'musteri', 'no']);
    for (const k of ['parti', 'topMetre', 'tarih']) expect(parseStoredColumns(null)).not.toContain(k);
  });

  it('zorunlu sütun kapatılamaz; açık/kapalı geçiş görüntü sırasını korur', () => {
    const v = parseStoredColumns(null);
    expect(toggleColumn(v, 'no')).toEqual(v);
    expect(toggleColumn(v, 'konum')).toEqual(v);
    expect(toggleColumn(v, 'musteri')).toEqual(['no', 'kumas', 'konum', 'durum']);
    expect(toggleColumn(v, 'tarih')).toEqual(['no', 'musteri', 'kumas', 'konum', 'durum', 'tarih']);
    expect(toggleColumn(v, 'parti')).toEqual(['no', 'musteri', 'kumas', 'parti', 'konum', 'durum']);
  });

  it('kayıt gidiş-dönüş; bilinmeyen anahtar atılır, zorunlu eklenir; bozuk/eski biçim varsayılana düşer', () => {
    const v = ['no', 'konum', 'tarih'] as const;
    expect(parseStoredColumns(serializeColumns([...v]))).toEqual(['no', 'konum', 'tarih']);
    expect(parseStoredColumns(JSON.stringify({ v: 1, visible: ['tarih', 'yok', 7] }))).toEqual(['no', 'konum', 'tarih']);
    expect(parseStoredColumns('{bozuk')).toEqual(parseStoredColumns(null));
    expect(parseStoredColumns(JSON.stringify(['tarih']))).toEqual(parseStoredColumns(null));
    expect(normalizeColumns([])).toEqual(['no', 'konum']);
  });

  it('anahtar kullanıcı başına ve SecureStore alfabesinde', () => {
    expect(columnsStorageKey('a1-b2')).toBe('isEmirleri.columns.a1-b2');
    expect(columnsStorageKey('x y/z')).toBe('isEmirleri.columns.x_y_z');
    expect(columnsStorageKey(null)).toBe('isEmirleri.columns.anon');
    expect(columnsStorageKey('u1')).not.toBe(columnsStorageKey('u2'));
  });

  it('her sütunun etiketi ve pozitif genişliği var', () => {
    for (const c of COLUMNS) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.flex).toBeGreaterThan(0);
    }
  });
});
