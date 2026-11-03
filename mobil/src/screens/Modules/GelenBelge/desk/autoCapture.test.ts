// Belge masası otomatik çekim kararı (K26): boş masa / hareketli / sabit kağıt / sonraki sayfa / tekrar çek.
import { afterManualCapture, initialAutoState, rearm, stepAutoCapture, type AutoAction, type AutoCaptureState } from './autoCapture';

function run(sizes: number[], start: AutoCaptureState = initialAutoState()): { actions: AutoAction[]; state: AutoCaptureState } {
  let state = start;
  const actions: AutoAction[] = [];
  for (const n of sizes) {
    const d = stepAutoCapture(state, n);
    actions.push(d.action);
    state = d.state;
  }
  return { actions, state };
}

const EMPTY = 40_000;
const PAPER = 90_000;
const calibrated = () => run([EMPTY, EMPTY + 300, EMPTY - 200]).state;

describe('stepAutoCapture', () => {
  it('ilk sabit boş masa referans olur; çekim yok', () => {
    const r = run([EMPTY, EMPTY + 300, EMPTY - 200]);
    expect(r.actions).toEqual(['wait', 'wait', 'calibrated']);
    expect(r.state.baseline).toBeCloseTo(EMPTY, -2);
  });

  it('boş masa sürdükçe çekim yok', () => {
    expect(run([EMPTY, EMPTY + 500, EMPTY - 400, EMPTY], calibrated()).actions).not.toContain('capture');
  });

  it('hareketli sahne (el, kayan kağıt) çekilmez', () => {
    expect(run([70_000, 95_000, 60_000, 100_000, 75_000], calibrated()).actions).not.toContain('capture');
  });

  it('kağıt konup hareket durunca TEK çekim', () => {
    const r = run([70_000, PAPER, PAPER + 500, PAPER - 300, PAPER, PAPER + 200], calibrated());
    expect(r.actions.filter((a) => a === 'capture')).toHaveLength(1);
    expect(r.actions.indexOf('capture')).toBe(3);
  });

  it('kağıt kaldırılıp yenisi konunca ikinci çekim', () => {
    const first = run([PAPER, PAPER, PAPER], calibrated());
    expect(first.actions).toEqual(['wait', 'wait', 'capture']);
    const second = run([EMPTY, EMPTY, EMPTY, 120_000, 120_000, 120_000], first.state);
    expect(second.actions.filter((a) => a === 'capture')).toHaveLength(1);
  });

  it('önceki sayfanın üstüne belirgin farklı sayfa konunca çekilir, aynı sayfa çekilmez', () => {
    const first = run([PAPER, PAPER, PAPER], calibrated());
    expect(run([PAPER, PAPER, PAPER], first.state).actions).not.toContain('capture');
    expect(run([130_000, 130_000, 130_000], first.state).actions).toContain('capture');
  });

  it('elle Okut sonrası aynı kağıt otomatik ikinci kez çekilmez; Tekrar çek yeniden çeker', () => {
    const seen = run([PAPER, PAPER], calibrated()).state;
    const manual = afterManualCapture(seen);
    expect(run([PAPER, PAPER, PAPER], manual).actions).not.toContain('capture');
    expect(run([PAPER, PAPER, PAPER], rearm(manual)).actions).toContain('capture');
  });
});
