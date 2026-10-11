// Alarm eylemi token kuralı: deneme başına bir token; belirsiz hatada (ağ/5xx) AYNI token yapışır,
// kesin 4xx'te (409 "başkası üstlendi") ve başarıda yenisi doğar.
import { runAlarmAction } from './useLoomAlarmActions';
import { createAttemptToken } from '../offline/attemptToken';
import type { LoomAlarmActionResult } from '../types/loomAlarm';

jest.mock('react-native-toast-message', () => ({ show: jest.fn(), hide: jest.fn() }));

const RESULT = { alarmId: 'a' } as LoomAlarmActionResult;
const fail = (status?: number) => Object.assign(new Error('x'), status === undefined ? {} : { status });

function setup() {
  let n = 0;
  const gen = () => `t${++n}`;
  const byKind = { ack: createAttemptToken(gen), note: createAttemptToken(gen) };
  const seen: string[] = [];
  const run = (outcome: 'ok' | Error, kind: 'ack' | 'note' = 'ack', sub?: string) =>
    runAlarmAction(byKind[kind], sub, async (t) => {
      seen.push(t);
      if (outcome === 'ok') return RESULT;
      throw outcome;
    }).catch(() => null);
  return { run, seen };
}

describe('runAlarmAction — clientToken kuralı', () => {
  it('ağ hatası (status yok) → yeniden denemede AYNI token', async () => {
    const { run, seen } = setup();
    await run(fail());
    await run('ok');
    expect(seen).toEqual(['t1', 't1']);
  });

  it('5xx → aynı token; 409 → yeni token', async () => {
    const { run, seen } = setup();
    await run(fail(503));
    await run(fail(409));
    await run('ok');
    expect(seen).toEqual(['t1', 't1', 't2']);
  });

  it('başarıdan sonra yeni eylem yeni token', async () => {
    const { run, seen } = setup();
    await run('ok');
    await run('ok');
    expect(seen).toEqual(['t1', 't2']);
  });

  it('parametreli eylem: farklı not metni ayrı alt token, aynı metin aynı token', async () => {
    const { run, seen } = setup();
    await run(fail(), 'note', 'birinci');
    await run(fail(), 'note', 'ikinci');
    await run(fail(), 'note', 'birinci');
    expect(seen).toEqual(['t1', 't2', 't1']);
  });

  it('eylemler birbirinin denemesini taşımaz', async () => {
    const { run, seen } = setup();
    await run(fail(), 'ack');
    await run(fail(), 'note', 'x');
    expect(seen[0]).not.toBe(seen[1]);
  });
});
