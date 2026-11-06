import { boardSackUnits, boardUnitText, loadKgText, isLooseUnit, loadUnitIcon, loadUnitTitle } from './loadUnit';

describe('yük birimi adı', () => {
  it('dökme / araba / çuval ve eski sunucu (alan yok)', () => {
    expect(loadUnitTitle({ unitKind: 'BULK', sackNo: 'CV1' })).toBe('Dökme');
    expect(loadUnitTitle({ unitKind: 'CART', unitLabel: 'A-12', sackNo: 'CV2' })).toBe('Araba A-12');
    expect(loadUnitTitle({ unitKind: 'SACK', sackNo: 'CV3' })).toBe('CV3');
    expect(loadUnitTitle({ sackNo: '', seq: 4 })).toBe('#4');
  });
  it('yalnız dökme/araba gevşek birimdir', () => {
    expect(isLooseUnit({ unitKind: 'BULK' })).toBe(true);
    expect(isLooseUnit({ unitKind: 'CART' })).toBe(true);
    expect(isLooseUnit({ unitKind: 'SACK' })).toBe(false);
    expect(isLooseUnit({})).toBe(false);
    expect(loadUnitIcon({})).toBe('sack');
  });
});

describe('sevk kapısı kart yük özeti', () => {
  it('çuval / dökme / araba / karışık', () => {
    expect(boardUnitText({ sackCount: 3, cartCount: 0, bulkCount: 0 })).toBe('3 çuval');
    expect(boardUnitText({ sackCount: 1, cartCount: 0, bulkCount: 1 })).toBe('Dökme');
    expect(boardUnitText({ sackCount: 2, cartCount: 2, bulkCount: 0 })).toBe('2 araba');
    expect(boardUnitText({ sackCount: 3, cartCount: 1, bulkCount: 0 })).toBe('2 çuval · 1 araba');
    expect(boardUnitText({ sackCount: 0 })).toBe('Yük yok');
  });
  it('eski sunucu (tür sayıları yok) hepsini çuval sayar', () => {
    expect(boardUnitText({ sackCount: 4 })).toBe('4 çuval');
    expect(boardSackUnits({ sackCount: 4 })).toBe(4);
  });
  it('dökme/araba sevkiyatında çıkarılabilir çuval yok', () => {
    expect(boardSackUnits({ sackCount: 1, cartCount: 0, bulkCount: 1 })).toBe(0);
    expect(boardSackUnits({ sackCount: 2, cartCount: 2, bulkCount: 0 })).toBe(0);
    expect(boardSackUnits({ sackCount: 3, cartCount: 1, bulkCount: 0 })).toBe(2);
  });
});

describe('araba no ve kg metni (demo ekran denetimi 2026-11-06)', () => {
  it('araba no biliniyorsa yazılır, çoksa sayı', () => {
    expect(boardUnitText({ sackCount: 1, cartCount: 1, bulkCount: 0, cartLabels: ['A-12'] })).toBe('Araba A-12');
    expect(boardUnitText({ sackCount: 2, cartCount: 2, bulkCount: 0, cartLabels: ['A-1', 'A-2'] })).toBe('Araba A-1, A-2');
    expect(boardUnitText({ sackCount: 4, cartCount: 4, bulkCount: 0, cartLabels: ['1', '2', '3', '4'] })).toBe('4 araba');
  });
  it('kg yalnız çuvallarda; karışıkta "(çuvallar)", dökme/arabada boş', () => {
    expect(loadKgText({ sackCount: 2, totalKg: 96.7 })).toBe('96,7 kg');
    expect(loadKgText({ sackCount: 2, cartCount: 1, bulkCount: 0, totalKg: 96.7 })).toBe('96,7 kg (çuvallar)');
    expect(loadKgText({ sackCount: 1, cartCount: 0, bulkCount: 1, totalKg: 0 })).toBe('');
    expect(loadKgText({ sackCount: 1, cartCount: 1, bulkCount: 0, totalKg: 12 })).toBe('');
  });
});

