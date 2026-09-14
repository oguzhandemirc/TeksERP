// =============================================================================
// TEZGAH BAĞI YÜKLERİ — Tak/Sök/Tüket/Bitir saf kuralları (Faz 3 E3)
// =============================================================================
// NEGATİF SONDALAR (2026-09-15): `validateMount`ta `methodRequired && !f.mountMethod` dalı düşürüldü → ③
//   kırmızı · `validateConsume`ta `m > remainingM` düşürüldü → ⑥ kırmızı · `buildMountPayload`ta
//   `setupStartedAt` hep null → ④ kırmızı.
// =============================================================================
import {
  EMPTY_CONSUME, EMPTY_DISMOUNT, EMPTY_EXHAUST, EMPTY_MOUNT, buildConsumePayload, buildDismountPayload, buildExhaustPayload, buildMountPayload, mountFingerprint,
  parseM, validateConsume, validateDismount, validateExhaust, validateMount,
} from './tezgahPayload';

describe('parseM', () => {
  it('boş → null, virgül ondalık, geçersiz → null', () => {
    expect(parseM('')).toBeNull();
    expect(parseM(' 12,5 ')).toBe(12.5);
    expect(parseM('abc')).toBeNull();
  });
});

describe('Tak (mount)', () => {
  it('① makine yoksa / yuva aralık dışıysa red, adıyla', () => {
    expect(validateMount(EMPTY_MOUNT, null, false)).toMatch(/Tezgah seçin/);
    expect(validateMount({ ...EMPTY_MOUNT, machineId: 'm', position: '3' }, 2, false)).toMatch(/Yuva 1\.\.2/);
    expect(validateMount({ ...EMPTY_MOUNT, machineId: 'm', position: '0' }, 2, false)).toMatch(/Yuva/);
  });
  it('② yuvasız (cağlıklı) makine red — makine kartına yönlendirir', () => {
    expect(validateMount({ ...EMPTY_MOUNT, machineId: 'm' }, 0, false)).toMatch(/yuvası yok/);
  });
  it('③ ⭐ yöntem yalnız `mountTrackingRequired` açıkken zorunlu (kapalıyken form BİREBİR eski: yöntemsiz geçer)', () => {
    const f = { ...EMPTY_MOUNT, machineId: 'm', position: '1' };
    expect(validateMount(f, 2, false)).toBeNull();
    expect(validateMount(f, 2, true)).toMatch(/yöntemi zorunlu/);
    expect(validateMount({ ...f, mountMethod: 'TYING_IN' }, 2, true)).toBeNull();
  });
  it('④ ⭐ yük backend mountSchema ile birebir; zorunlu ayarda başlangıç "şimdi", kapalıyken saat GİTMEZ', () => {
    const now = new Date('2026-09-15T05:00:00Z');
    const f = { ...EMPTY_MOUNT, machineId: 'm', position: '2', mountMethod: 'DRAWING_IN' as const, machineCounter: '1200,5' };
    expect(buildMountPayload(f, true, 'tok', now)).toEqual({ machineId: 'm', position: 2, mountMethod: 'DRAWING_IN', setupStartedAt: '2026-09-15T05:00:00.000Z', machineCounter: 1200.5, clientToken: 'tok' });
    expect(buildMountPayload(f, false, 'tok', now).setupStartedAt).toBeNull();
    expect(Object.keys(buildMountPayload(f, false, 'tok')).sort()).toEqual(['clientToken', 'machineCounter', 'machineId', 'mountMethod', 'position', 'setupStartedAt']);
  });
  it('parmak izi levent + makine + yuva', () => {
    expect(mountFingerprint({ beamId: 'b', machineId: 'm', position: 2 })).toBe('mount|b|m|2');
  });
});

describe('Sök (dismount)', () => {
  it('⑤ ölçülen kalan boş → remainingM null ve kaynak null (defterdeki kalan kalır); dolu → sayı + kaynak', () => {
    expect(validateDismount(EMPTY_DISMOUNT)).toBeNull();
    expect(buildDismountPayload(EMPTY_DISMOUNT)).toEqual({ remainingM: null, lengthSource: null, machineCounter: null });
    expect(buildDismountPayload({ remainingM: '850', lengthSource: 'DIAMETER', machineCounter: '' })).toEqual({ remainingM: 850, lengthSource: 'DIAMETER', machineCounter: null });
    expect(validateDismount({ ...EMPTY_DISMOUNT, remainingM: '-1' })).toMatch(/geçersiz/);
  });
});

describe('Tüket (consume)', () => {
  it('⑥ ⭐ 0/boş red; kalanı aşan red (sunucu 409 WARP_BEAM_REMAINING_EXCEEDED\'in ön kapısı); yük birebir + token', () => {
    expect(validateConsume(EMPTY_CONSUME, 700)).toMatch(/büyük olmalı/);
    expect(validateConsume({ ...EMPTY_CONSUME, lengthM: '800' }, 700)).toMatch(/aşıyor/);
    expect(validateConsume({ ...EMPTY_CONSUME, lengthM: '700' }, 700)).toBeNull();
    expect(buildConsumePayload({ lengthM: '300', lengthSource: 'LOOM_COUNTER', machineCounter: '4300' }, 'tok')).toEqual({ lengthM: 300, lengthSource: 'LOOM_COUNTER', machineCounter: 4300, clientToken: 'tok' });
  });
});

describe('Bitir (exhaust)', () => {
  it('⑦ artık boş → null (sunucu 0 sayar, ESTIMATED); dolu → ölçülen + kaynak; negatif red', () => {
    expect(validateExhaust(EMPTY_EXHAUST)).toBeNull();
    expect(buildExhaustPayload(EMPTY_EXHAUST)).toEqual({ residualM: null, lengthSource: null });
    expect(buildExhaustPayload({ residualM: '50', lengthSource: 'DIAMETER' })).toEqual({ residualM: 50, lengthSource: 'DIAMETER' });
    expect(validateExhaust({ ...EMPTY_EXHAUST, residualM: '-5' })).toMatch(/geçersiz/);
  });
});
