// Ekranın özellik cevap durumu: top açılınca İE hedefi seçili gelir, elle seçim aynı topta ezilmez, top değişince
// yeniden hedefe döner, hedef yoksa seçimsiz (zorunluluk uyarısı ekranda kalır).
import { act, renderHook } from '@testing-library/react-native';
import type { ChoiceTargetProp } from './choiceTargetDefaults';
import { usePropAnswers } from './usePropAnswers';

const PROPS: ChoiceTargetProp[] = [
  { propertyId: 'kursun', mode: 'REQUIRED', valueType: 'FLAG' },
  { propertyId: 'gramaj', mode: 'REQUIRED', valueType: 'CHOICE', values: [{ code: '25GR' }, { code: '50GR' }, { code: '70GR' }] },
];
type T = { propertyId: string; valueCode: string }[] | undefined;

function setup(targets: T, rollKey = 'kart|top-1') {
  return renderHook((p: { targets: T; rollKey: string }) => usePropAnswers(PROPS, p.targets, p.rollKey), {
    initialProps: { targets, rollKey },
  });
}
const HEDEF = [{ propertyId: 'gramaj', valueCode: '50GR' }];

it('⭐ İE hedefi varsa top açılınca hedef değer zaten seçili', () => {
  const { result } = setup(HEDEF);
  expect(result.current.answers).toEqual({ gramaj: '50GR' });
});

it('⭐ hedef yoksa seçimsiz', () => {
  expect(setup([]).result.current.answers).toEqual({});
  expect(setup(undefined).result.current.answers).toEqual({});
});

it('⭐ elle değiştirilen seçim aynı topta (hedef tazelense de) ezilmez; top değişince hedefe döner', () => {
  const { result, rerender } = setup(HEDEF);
  act(() => result.current.pickValue('gramaj', '70GR'));
  expect(result.current.answers).toEqual({ gramaj: '70GR' });
  rerender({ targets: [{ propertyId: 'gramaj', valueCode: '50GR' }], rollKey: 'kart|top-1' });
  expect(result.current.answers).toEqual({ gramaj: '70GR' });
  rerender({ targets: [{ propertyId: 'gramaj', valueCode: '25GR' }], rollKey: 'kart|top-1' });
  expect(result.current.answers).toEqual({ gramaj: '70GR' });
  rerender({ targets: HEDEF, rollKey: 'kart|top-2' });
  expect(result.current.answers).toEqual({ gramaj: '50GR' });
});

it('hedef sonradan gelirse (refetch) dokunulmamış özellik seçilir; BAYRAK top değişince sıfırlanır', () => {
  const { result, rerender } = setup([]);
  act(() => result.current.toggleFlag('kursun'));
  rerender({ targets: HEDEF, rollKey: 'kart|top-1' });
  expect(result.current.answers).toEqual({ kursun: true, gramaj: '50GR' });
  rerender({ targets: HEDEF, rollKey: 'kart|top-2' });
  expect(result.current.answers).toEqual({ gramaj: '50GR' });
});

it('seçili hedefe tekrar basmak seçimi kaldırır ve geri gelmez', () => {
  const { result, rerender } = setup(HEDEF);
  act(() => result.current.pickValue('gramaj', '50GR'));
  expect(result.current.answers).toEqual({});
  rerender({ targets: [...HEDEF], rollKey: 'kart|top-1' });
  expect(result.current.answers).toEqual({});
});
