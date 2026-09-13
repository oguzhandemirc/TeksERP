import { doffFingerprint, onDoffFailed, onDoffSucceeded, tokenForDoff } from './doffAttempt';
import { INFLIGHT_REUSE_WINDOW_MS } from '../../../offline/entryAttempt';

const fp = doffFingerprint({ machineId: 'm1', productionLineNo: 1, pieceCount: 3 });
const gen = () => 'yeni-token';

describe('doffFingerprint — indirmenin kimliği (backend resolveReplay ile aynı üç alan)', () => {
  it('makine · hat · parça sayısı kimliğe girer', () => {
    expect(doffFingerprint({ machineId: 'm1', productionLineNo: 2, pieceCount: 3 })).not.toBe(fp);
    expect(doffFingerprint({ machineId: 'm1', productionLineNo: 1, pieceCount: 4 })).not.toBe(fp);
  });
  it('⭐ sayaç ve koşum bağı kimliğe GİRMEZ — düzeltip yeniden göndermek aynı indirmedir', () => {
    // Fonksiyon yalnız üç alanı okur; fazladan alanlar yapısal tipte görmezden gelinir.
    const genis = { machineId: 'm1', productionLineNo: 1, pieceCount: 3, counterAtDoff: 999, machineRunId: 'r1' };
    expect(doffFingerprint(genis)).toBe(fp);
  });
});

describe('tokenForDoff — belirsiz hatada aynı token, kesin hatada taze', () => {
  it('düşmüş deneme yokken taze token', () => {
    expect(tokenForDoff(null, fp, 0, gen)).toBe('yeni-token');
  });
  it('⭐ SAHA: zaman aşımı → operatör yeniden basar → AYNI token (mükerrer indirme doğmaz)', () => {
    const prev = onDoffFailed('t1', fp, { status: undefined }, 1000);
    expect(prev).not.toBeNull();
    expect(tokenForDoff(prev, fp, 1000 + 30_000, gen)).toBe('t1');
  });
  it('5xx de belirsizdir', () => {
    expect(onDoffFailed('t1', fp, { status: 503 }, 0)).not.toBeNull();
  });
  it("⭐ KESİN 4xx'te yapışmaz (400 doğrulama · 409 çakışma → operatör yükü değiştirir)", () => {
    expect(onDoffFailed('t1', fp, { status: 400 }, 0)).toBeNull();
    expect(onDoffFailed('t1', fp, { status: 409 }, 0)).toBeNull();
  });
  it('⭐ FARKLI parça sayısı taze token alır (yeni indirme sessizce yutulmaz)', () => {
    const prev = onDoffFailed('t1', fp, {}, 0);
    const fp2 = doffFingerprint({ machineId: 'm1', productionLineNo: 1, pieceCount: 5 });
    expect(tokenForDoff(prev, fp2, 10, gen)).toBe('yeni-token');
  });
  it('pencere dolunca taze token; sınırda hâlâ korur', () => {
    const prev = onDoffFailed('t1', fp, {}, 0);
    expect(tokenForDoff(prev, fp, INFLIGHT_REUSE_WINDOW_MS, gen)).toBe('t1');
    expect(tokenForDoff(prev, fp, INFLIGHT_REUSE_WINDOW_MS + 1, gen)).toBe('yeni-token');
  });
  it('⭐ başarıdan sonra yapışkanlık biter', () => {
    expect(onDoffSucceeded()).toBeNull();
    expect(tokenForDoff(onDoffSucceeded(), fp, 0, gen)).toBe('yeni-token');
  });
});
