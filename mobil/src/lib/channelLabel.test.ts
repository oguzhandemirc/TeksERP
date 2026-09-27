import { resolveChannelLabel } from './channelLabel';

describe('resolveChannelLabel — görünür kanal etiketi', () => {
  it('üretim kanalı (extra yok) → null: bugünkü görünüm birebir', () => {
    expect(resolveChannelLabel({})).toBeNull();
    expect(resolveChannelLabel(null)).toBeNull();
    expect(resolveChannelLabel(undefined)).toBeNull();
    expect(resolveChannelLabel({ extra: {} })).toBeNull();
  });

  it('hazırlık kanalı → etiket (kırpılmış)', () => {
    expect(resolveChannelLabel({ extra: { gorunurEtiket: 'TEST FABRİKA' } })).toBe('TEST FABRİKA');
    expect(resolveChannelLabel({ extra: { gorunurEtiket: '  TEST  ' } })).toBe('TEST');
  });

  it('boş ya da metin olmayan değer etiket SAYILMAZ', () => {
    expect(resolveChannelLabel({ extra: { gorunurEtiket: '   ' } })).toBeNull();
    expect(resolveChannelLabel({ extra: { gorunurEtiket: 1 } })).toBeNull();
    expect(resolveChannelLabel({ extra: 'x' })).toBeNull();
  });
});
