import { onBeamFailed, onBeamSucceeded, planFingerprint, tokenForBeam, windFingerprint } from './devereAttempt';
import { INFLIGHT_REUSE_WINDOW_MS } from '../../../offline/entryAttempt';

const fp = planFingerprint({ warpSpecId: 's1', originKind: 'IN_HOUSE', plannedLengthM: 1200 });
const gen = () => 'yeni-token';

// ⭐ NEGATİF SONDA (ölçüldü 2026-09-14): `tokenForBeam` her çağrıda `gen()` dönünce §2 KIRMIZI;
//    `onBeamFailed` 4xx'te de yapışınca §4 KIRMIZI.
describe('planFingerprint / windFingerprint — backend replay alanlarının aynası', () => {
  it('plan: çözgü kartı · köken · planlanan metre kimliğe girer', () => {
    expect(planFingerprint({ warpSpecId: 's2', originKind: 'IN_HOUSE', plannedLengthM: 1200 })).not.toBe(fp);
    expect(planFingerprint({ warpSpecId: 's1', originKind: 'PURCHASED', plannedLengthM: 1200 })).not.toBe(fp);
    expect(planFingerprint({ warpSpecId: 's1', originKind: 'IN_HOUSE', plannedLengthM: 1201 })).not.toBe(fp);
  });
  it('⭐ metal levent no / not kimliğe GİRMEZ — düzeltip yeniden göndermek aynı plandır', () => {
    const genis = { warpSpecId: 's1', originKind: 'IN_HOUSE', plannedLengthM: 1200, physicalBeamNo: 'L-1', notes: 'x' };
    expect(planFingerprint(genis)).toBe(fp);
  });
  it('sarım: levent + metre; iplik satırları/makine kimliğe GİRMEZ; plan ile çakışmaz', () => {
    const w = windFingerprint({ beamId: 'b1', lengthM: 1180 });
    expect(windFingerprint({ beamId: 'b1', lengthM: 1180, machineId: 'm9' } as never)).toBe(w);
    expect(windFingerprint({ beamId: 'b2', lengthM: 1180 })).not.toBe(w);
    expect(w).not.toBe(fp);
  });
});

describe('tokenForBeam — belirsiz hatada aynı token, kesin hatada taze', () => {
  it('düşmüş deneme yokken taze token', () => {
    expect(tokenForBeam(null, fp, 0, gen)).toBe('yeni-token');
  });
  it('⭐ SAHA: zaman aşımı → operatör yeniden basar → AYNI token (mükerrer levent doğmaz)', () => {
    const prev = onBeamFailed('t1', fp, { status: undefined }, 1000);
    expect(prev).not.toBeNull();
    expect(tokenForBeam(prev, fp, 1000 + 30_000, gen)).toBe('t1');
  });
  it('5xx de belirsizdir', () => {
    expect(onBeamFailed('t1', fp, { status: 503 }, 0)).not.toBeNull();
  });
  it("⭐ KESİN 4xx'te yapışmaz (400 doğrulama · 409 çakışma → operatör yükü değiştirir)", () => {
    expect(onBeamFailed('t1', fp, { status: 400 }, 0)).toBeNull();
    expect(onBeamFailed('t1', fp, { status: 409 }, 0)).toBeNull();
  });
  it('pencere dolunca taze token; sınırda hâlâ korur', () => {
    const prev = onBeamFailed('t1', fp, {}, 0);
    expect(tokenForBeam(prev, fp, INFLIGHT_REUSE_WINDOW_MS, gen)).toBe('t1');
    expect(tokenForBeam(prev, fp, INFLIGHT_REUSE_WINDOW_MS + 1, gen)).toBe('yeni-token');
  });
  it('başarı yapışkanlığı bitirir', () => {
    expect(onBeamSucceeded()).toBeNull();
  });
});
