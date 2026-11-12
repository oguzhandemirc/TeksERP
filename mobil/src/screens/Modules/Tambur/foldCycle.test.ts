// Kat tek düğme: 2 Kat ↔ 4 Kat; ikiden fazla değer sırayla döner; seçimsiz/bilinmeyen → ilk.
import { nextFoldCode } from './foldCycle';

const two = [{ code: '2-KAT' }, { code: '4-KAT' }];
const three = [...two, { code: '6-KAT' }];

describe('nextFoldCode', () => {
  it('iki değer arasında gidip gelir', () => {
    expect(nextFoldCode(two, '2-KAT')).toBe('4-KAT');
    expect(nextFoldCode(two, '4-KAT')).toBe('2-KAT');
  });
  it('üç değerde sırayla döner', () => {
    expect(nextFoldCode(three, '4-KAT')).toBe('6-KAT');
    expect(nextFoldCode(three, '6-KAT')).toBe('2-KAT');
  });
  it('seçim yoksa ilk değer; katalog boşsa null', () => {
    expect(nextFoldCode(two, null)).toBe('2-KAT');
    expect(nextFoldCode(two, 'YOK')).toBe('2-KAT');
    expect(nextFoldCode([], '2-KAT')).toBeNull();
  });
});
