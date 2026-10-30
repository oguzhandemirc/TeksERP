import { buildClassifyPayload, buildOpenStopPayload, classifyStopFailure, formatElapsed, stopFingerprint, validateClassify } from './stopPayload';

const CTX = { machineId: 'm1', startedAtIso: '2026-09-14T10:00:00.000Z', clientToken: 't1' };

describe('stopPayload — backend openSchema/classifySchema ile birebir', () => {
  it('açılış: sebep isteğe bağlı → kod null, not null; beamSlot HİÇ gönderilmez', () => {
    const p = buildOpenStopPayload({ code: null, text: '  ' }, CTX);
    expect(p).toEqual({ machineId: 'm1', startedAt: CTX.startedAtIso, reasonCode: null, reasonNote: null, clientToken: 't1' });
    expect('beamSlot' in p).toBe(false);
  });

  it('açılış: chip + not → kod gerçek katalog kodu, not kırpılır ve 300 ile sınırlanır', () => {
    const p = buildOpenStopPayload({ code: 'COZGU_KOPUSU', text: ' sol kenar ' + 'x'.repeat(400) }, CTX);
    expect(p.reasonCode).toBe('COZGU_KOPUSU');
    expect(p.reasonNote?.length).toBe(300);
    expect(p.reasonNote?.startsWith('sol kenar')).toBe(true);
  });

  it('sebep atama: kod zorunlu — kod uydurulmaz', () => {
    expect(validateClassify({ code: null, text: 'bir şey' }).ok).toBe(false);
    expect(validateClassify({ code: 'MOLA', text: '' }).ok).toBe(true);
    expect(buildClassifyPayload({ code: 'MOLA', text: '' })).toEqual({ reasonCode: 'MOLA', reasonNote: null });
  });

  it('parmak izi: makine + sebep; saat GİRMEZ (kimlik token)', () => {
    expect(stopFingerprint({ machineId: 'm1', reasonCode: null })).toBe('m1|');
    expect(stopFingerprint({ machineId: 'm1', reasonCode: 'MOLA' })).not.toBe(stopFingerprint({ machineId: 'm1', reasonCode: 'TAHAR' }));
  });

  it('geçen süre: dakika/saat biçimi, ileri damga 0a kırpılır, bozuk tarih —', () => {
    const t0 = Date.parse('2026-09-14T10:00:00.000Z');
    expect(formatElapsed('2026-09-14T10:00:00.000Z', t0 + 30_000)).toBe('<1 dk');
    expect(formatElapsed('2026-09-14T10:00:00.000Z', t0 + 12 * 60_000)).toBe('12 dk');
    expect(formatElapsed('2026-09-14T10:00:00.000Z', t0 + 65 * 60_000)).toBe('1 sa 05 dk');
    expect(formatElapsed('2026-09-14T10:00:00.000Z', t0 - 60_000)).toBe('<1 dk');
    expect(formatElapsed('bozuk', t0)).toBe('—');
  });

  it('409/400 kodları → ekran eylemi', () => {
    const f = (code: string) => classifyStopFailure({ message: 'm', details: { code } }, 'f');
    expect(f('STOP_ALREADY_OPEN').kind).toBe('refresh-stops');
    expect(f('STOP_REVOKED').kind).toBe('refresh-stops');
    expect(f('REASON_CODE_INVALID').kind).toBe('refresh-presets');
    expect(f('SHIFT_CANCELLED').kind).toBe('shift-cancelled');
    expect(f('SHIFT_SEALED').kind).toBe('shift-cancelled');
    expect(f('CLIENT_TOKEN_COLLISION').kind).toBe('token-collision');
    expect(f('STOP_END_BEFORE_START').kind).toBe('plain');
    expect(classifyStopFailure(undefined, 'yedek')).toEqual({ kind: 'plain', message: 'yedek' });
  });
});
