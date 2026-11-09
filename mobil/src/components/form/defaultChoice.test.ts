import { defaultChoiceText } from './defaultChoice';

describe('defaultChoiceText — varsayılan seçenek işareti (tek kaynak)', () => {
  it('⭐ varsayılan değer ★ ve "varsayılan" erişilebilirlik adı alır', () => {
    expect(defaultChoiceText('4 Kat', true)).toEqual({ label: '4 Kat ★', a11y: '4 Kat, varsayılan' });
  });
  it('varsayılan olmayan / bilinmeyen (eski sunucu) değer düz ad', () => {
    expect(defaultChoiceText('2 Kat', false)).toEqual({ label: '2 Kat', a11y: '2 Kat' });
    expect(defaultChoiceText('2 Kat')).toEqual({ label: '2 Kat', a11y: '2 Kat' });
    expect(defaultChoiceText('2 Kat', null)).toEqual({ label: '2 Kat', a11y: '2 Kat' });
  });
});
