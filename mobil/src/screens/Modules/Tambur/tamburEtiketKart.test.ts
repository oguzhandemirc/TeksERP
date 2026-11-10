// "Etikette" kartı + emanet alıcısı saf mantığı (2026-11-10): K2 kg görünürlüğü, K5 "kimin için" hiç boş değil,
// şablon dışı alan gösterilmez, kg kaynağı tartıdan sapınca MANUAL, sahip kilidi, alıcı tohumu.
import { backToOwnerText, consigneeChoiceText, dativeOf, labelPickerSections } from './consignee';
import { kgFieldVisible, labelCardRows, widthFieldVisible, type LabelCardValues } from './labelCard';
import { kgSource, parseWidthCm } from './finalLabel';
import { ownerLockOf } from './ownerTarget';
import { initialLabelTexts, withConsignee, withSeed } from './labelTexts';

const V: LabelCardValues = {
  itemName: 'SULTAN', colorName: 'EKRU', batchNo: null, consigneeName: 'ABC TEKSTİL', qualityName: 'A',
  meters: '50', kg: '12,5', widthCm: null, customerName: 'HHL MC',
};

describe('consignee metinleri (K5)', () => {
  it('alıcı yoksa sahip "(malın sahibi)" ile görünür; boş/boşluk alıcı da sahibe düşer', () => {
    expect(consigneeChoiceText('HHL MC', null)).toBe('HHL MC (malın sahibi)');
    expect(consigneeChoiceText('HHL MC', '   ')).toBe('HHL MC (malın sahibi)');
    expect(consigneeChoiceText('HHL MC', 'ABC')).toBe('ABC');
  });
  it('yönelme eki: kısaltma ünsüzle biterse "-ye"; kelime ünlü uyumuyla', () => {
    expect(dativeOf('HHL MC')).toBe("HHL MC'ye");
    expect(dativeOf('Ayhan')).toBe("Ayhan'a");
    expect(dativeOf('Kaya')).toBe("Kaya'ya");
    expect(dativeOf('Yeşil Örme')).toBe("Yeşil Örme'ye");
    expect(backToOwnerText('HHL MC')).toBe("HHL MC'ye dön");
  });
  it('seçici bölümleri: beyan ÖNCE, tekrar edilen beyan "Daha önce basılan"da yinelenmez', () => {
    const r = labelPickerSections({ declared: 'SULTAN', recent: ['PERDE', 'sultan', 'TÜL'] });
    expect(r.sections.map((x) => x.title)).toEqual(['Gelen belgede', 'Daha önce basılan']);
    expect(r.sections[0]!.items).toEqual(['SULTAN']);
    expect(r.sections[1]!.items).toEqual(['PERDE', 'TÜL']);
    expect(r.newValue).toBeNull();
  });
  it('arama: Türkçe katlamayla süzer; birebir eşleşme yoksa yazılan yeni değerdir', () => {
    const r = labelPickerSections({ declared: 'SULTAN', recent: ['TÜL PERDE'], search: 'tul' });
    expect(r.sections).toEqual([{ title: 'Daha önce basılan', items: ['TÜL PERDE'] }]);
    expect(r.newValue).toBe('tul');
    expect(labelPickerSections({ recent: ['TÜL'], search: 'tül' }).newValue).toBeNull();
  });
});

describe('labelCardRows — şablon alanları', () => {
  it('yalnız şablonun alanları, şablon sırasıyla; değersiz alan soluk "—"', () => {
    const rows = labelCardRows(
      [{ key: 'consigneeName', label: 'Alıcı' }, { key: 'weightKg', label: 'Kg' }, { key: 'widthCm', label: 'En' }],
      V,
    );
    expect(rows.map((r) => r.key)).toEqual(['consigneeName', 'weightKg', 'widthCm']);
    expect(rows[0]).toEqual({ key: 'consigneeName', label: 'Alıcı', value: 'ABC TEKSTİL', muted: false });
    expect(rows[2]).toEqual({ key: 'widthCm', label: 'En', value: '—', muted: true });
    // Şablonda olmayan ad/renk/metre kartta YOK.
    expect(rows.some((r) => r.value === 'SULTAN' || r.value === '50')).toBe(false);
  });
  it('tanınmayan anahtar boş görünür (uydurma değer yok)', () => {
    expect(labelCardRows([{ key: 'xyz', label: 'X' }], V)[0]!.muted).toBe(true);
  });
});

describe('K2 kg / K7 en görünürlüğü', () => {
  it('kg kutusu: şablon kg basıyorsa ya da tartım zorunluysa', () => {
    expect(kgFieldVisible([{ key: 'weightKg' }], false)).toBe(true);
    expect(kgFieldVisible([{ key: 'itemName' }], false)).toBe(false);
    expect(kgFieldVisible([{ key: 'itemName' }], true)).toBe(true);
    expect(kgFieldVisible(null, false)).toBe(false);
  });
  it('en kutusu yalnız şablon en basıyorsa', () => {
    expect(widthFieldVisible([{ key: 'widthCm' }])).toBe(true);
    expect(widthFieldVisible(null)).toBe(false);
  });
});

describe('kgSource / parseWidthCm', () => {
  it('tartılan değer aynen duruyorsa tartının kaynağı; elle değişince MANUAL; kg yoksa yok', () => {
    expect(kgSource({ kg: 12.5, source: 'SCALE' }, '12,5')).toBe('SCALE');
    expect(kgSource({ kg: 12.5, source: 'SIMULATED' }, '12,5')).toBe('SIMULATED');
    expect(kgSource({ kg: 12.5, source: 'SCALE' }, '13')).toBe('MANUAL');
    expect(kgSource(null, '13')).toBe('MANUAL');
    expect(kgSource({ kg: 12.5, source: 'SCALE' }, '')).toBeUndefined();
  });
  it('en: boş → null, virgüllü ondalık, aralık dışı NaN', () => {
    expect(parseWidthCm('')).toBeNull();
    expect(parseWidthCm('150,25')).toBe(150.3);
    expect(parseWidthCm('0')).toBeNaN();
    expect(parseWidthCm('abc')).toBeNaN();
  });
});

describe('ownerLockOf / alıcı tohumu', () => {
  const owner = { id: 'o1', name: 'HHL MC' };
  it('sahip varsa kilitli (eski backend ownerLocked göndermez → kilitli); açıkça false → kilitsiz', () => {
    expect(ownerLockOf({ ownerCustomer: owner })).toEqual(owner);
    expect(ownerLockOf({ ownerCustomer: owner, ownerLocked: false })).toBeNull();
    expect(ownerLockOf({ ownerCustomer: null })).toBeNull();
    expect(ownerLockOf(null)).toBeNull();
  });
  it('tohum alıcıyı yalnız id ile taşır; withConsignee(null) sahibe döner', () => {
    const s = withSeed(initialLabelTexts('k'), { itemName: null, colorName: null, batchNo: null, consigneeId: 'c1', consigneeName: 'ABC' });
    expect([s.consigneeId, s.consigneeName]).toEqual(['c1', 'ABC']);
    const noId = withSeed(initialLabelTexts('k'), { itemName: null, colorName: null, batchNo: null, consigneeName: 'ABC' });
    expect(noId.consigneeName).toBeNull();
    expect(withConsignee(s, null).consigneeId).toBeNull();
  });
});

describe('K1 — İE hedef değerleri ana ekranda değil, İE detayında', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const src: string = require('fs').readFileSync(require('path').join(__dirname, 'TamburScreen.tsx'), 'utf8');
  it('ekran hedef çipi çizmez; aktif sekmeye tekrar dokunmak İE detayını açar', () => {
    expect(src).not.toMatch(/stepSummary\.targetValues/);
    expect(src).toMatch(/job\.cardId === activeCardId \? setWoDetailId\(/);
    expect(src).toMatch(/<WorkOrderDetailSheet workOrderId=\{woDetailId\}/);
  });
});
