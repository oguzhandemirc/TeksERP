import { healedWindow } from './windowHeal';

const win = (width: number, height: number) => ({ width, height, scale: 1.5, fontScale: 1 });

describe('healedWindow — bayat pencere ölçüsü', () => {
  it('tarayıcı dönüşü: kök yatay (1280×800), pencere dikey kalmış (800×1280) → yatay onarılır', () => {
    expect(healedWindow({ width: 1280, height: 800 }, win(800, 1280))).toEqual(win(1280, 800));
  });
  it('telefon dikey, ölçüler tutarlı → dokunulmaz', () => {
    expect(healedWindow({ width: 411, height: 914 }, win(411, 914))).toBeNull();
  });
  it('tablet yatay, sistem çubuğu kadar fark → dokunulmaz (yalnız yön ayrışması onarılır)', () => {
    expect(healedWindow({ width: 1280, height: 776 }, win(1280, 800))).toBeNull();
  });
  it('çerçeve henüz ölçülmedi → dokunulmaz', () => {
    expect(healedWindow(null, win(800, 1280))).toBeNull();
    expect(healedWindow({ width: 0, height: 0 }, win(800, 1280))).toBeNull();
  });
});
