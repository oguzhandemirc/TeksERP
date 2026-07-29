import { makeNewRollRow, rebuildPrefilledNewRolls } from './newRolls.helper';

// NOT: PER_ROLL, mod kavramı gelmeden önceki tek davranıştı (top başına satır).
// Kısmi-kabul fazladan-doğum regresyon testleri o moddaki sözleşmeyi kilitler;
// SINGLE (yeni varsayılan: dikili tek parça) testleri aşağıda ayrı blokta.
describe('rebuildPrefilledNewRolls — PER_ROLL: fason kabul kısmi-kabul fazladan-doğum guard', () => {
  it('tam kabul: 2 işaretli top → 2 ön-dolu parça (metreler korunur)', () => {
    const out = rebuildPrefilledNewRolls([], [100, 120], 'PER_ROLL');
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.prefilled)).toBe(true);
    expect(out.map((r) => r.qty)).toEqual(['100', '120']);
  });

  it('REGRESYON: kısmi kabul (1 top işaretten çıkınca) ön-dolu parça da 2→1 düşer', () => {
    // 1 sevk / 2 top → parti seçilince 2 ön-dolu satır kurulur.
    const afterApplyParty = rebuildPrefilledNewRolls([], [100, 120], 'PER_ROLL');
    expect(afterApplyParty).toHaveLength(2);

    // Operatör gelmeyen ikinci topu işaretten çıkarır → işaretli yalnız [100].
    const afterUncheck = rebuildPrefilledNewRolls(afterApplyParty, [100], 'PER_ROLL');

    // Bug öncesi 2 kalıyordu (→ backend 2 born roll). Artık 1 olmalı.
    expect(afterUncheck).toHaveLength(1);
    expect(afterUncheck[0].qty).toBe('100');
    expect(afterUncheck[0].prefilled).toBe(true);
  });

  it('yeniden işaretlenince ön-dolu parça geri gelir (1→2)', () => {
    const partial = rebuildPrefilledNewRolls([], [100], 'PER_ROLL');
    const restored = rebuildPrefilledNewRolls(partial, [100, 120], 'PER_ROLL');
    expect(restored).toHaveLength(2);
    expect(restored.map((r) => r.qty)).toEqual(['100', '120']);
  });

  it('operatörün elle girdiği satır (prefilled=false) korunur — boyahane merge/split esnekliği', () => {
    const manual = { ...makeNewRollRow('55', false), key: 'manual-1' };
    const current = [...rebuildPrefilledNewRolls([], [100, 120], 'PER_ROLL'), manual];

    // 1 top işaretten çıkar: ön-dolu 1'e düşer ama elle satır aynen kalır.
    const out = rebuildPrefilledNewRolls(current, [100], 'PER_ROLL');
    const prefilled = out.filter((r) => r.prefilled);
    const kept = out.filter((r) => !r.prefilled);
    expect(prefilled).toHaveLength(1);
    expect(kept).toHaveLength(1);
    expect(kept[0].key).toBe('manual-1');
    expect(kept[0].qty).toBe('55');
  });

  it('hiçbir top işaretli değilken ön-dolu satır kalmaz (canSubmit zaten checkedCount>0 ister)', () => {
    const out = rebuildPrefilledNewRolls(
      rebuildPrefilledNewRolls([], [100, 120], 'PER_ROLL'),
      [],
      'PER_ROLL',
    );
    expect(out).toHaveLength(0);
  });

  it('metresi 0/eksik top → boş qty ile ön-dolu (operatör girer)', () => {
    const out = rebuildPrefilledNewRolls([], [0], 'PER_ROLL');
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe('');
    expect(out[0].prefilled).toBe(true);
  });

  it('toggleAll: hepsi kaldır → ön-dolu boşalır (elle satır kalır), hepsi seç → geri gelir', () => {
    const manual = { ...makeNewRollRow('40', false), key: 'm-1' };
    const start = [...rebuildPrefilledNewRolls([], [100, 120], 'PER_ROLL'), manual];

    // toggleAll OFF (hiç işaretli yok)
    const allOff = rebuildPrefilledNewRolls(start, [], 'PER_ROLL');
    expect(allOff.filter((r) => r.prefilled)).toHaveLength(0);
    expect(allOff.filter((r) => !r.prefilled)).toHaveLength(1); // elle satır durur

    // toggleAll ON (hepsi işaretli)
    const allOn = rebuildPrefilledNewRolls(allOff, [100, 120], 'PER_ROLL');
    expect(allOn.filter((r) => r.prefilled)).toHaveLength(2);
    expect(allOn.filter((r) => !r.prefilled).map((r) => r.key)).toEqual(['m-1']);
  });

  it('çoklu elle ekleme + kısmi uncheck: elle eklenenler korunur, ön-dolu işaretliye iner', () => {
    const m1 = { ...makeNewRollRow('30', false), key: 'm-1' };
    const m2 = { ...makeNewRollRow('35', false), key: 'm-2' };
    const start = [...rebuildPrefilledNewRolls([], [100, 120, 90], 'PER_ROLL'), m1, m2];
    expect(start.filter((r) => r.prefilled)).toHaveLength(3);

    // 3 toptan 1'i işaretten çıkar → ön-dolu 2'ye iner, 2 elle satır aynen kalır
    const out = rebuildPrefilledNewRolls(start, [100, 120], 'PER_ROLL');
    expect(out.filter((r) => r.prefilled)).toHaveLength(2);
    expect(out.filter((r) => !r.prefilled).map((r) => r.key)).toEqual(['m-1', 'm-2']);
  });
});

describe('rebuildPrefilledNewRolls — SINGLE: varsayılan "dikili tek parça = toplam metraj"', () => {
  it('işaretli topların toplam metresiyle TEK ön-dolu satır kurar', () => {
    const out = rebuildPrefilledNewRolls([], [100, 20.5, 30], 'SINGLE');
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe('150.5');
    expect(out[0].prefilled).toBe(true);
  });

  it('yüzer-nokta gürültüsünü yuvarlar (0.1 + 0.2 → 0.3)', () => {
    const out = rebuildPrefilledNewRolls([], [0.1, 0.2], 'SINGLE');
    expect(out[0].qty).toBe('0.3');
  });

  it('pozitif olmayan metrajları toplama katmaz', () => {
    const out = rebuildPrefilledNewRolls([], [100, 0, -5], 'SINGLE');
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe('100');
  });

  it('toplam 0 ise satır boş metrajla gelir (operatör girer)', () => {
    const out = rebuildPrefilledNewRolls([], [0], 'SINGLE');
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe('');
  });

  it('hiç işaretli top yoksa ön-dolu satır üretmez', () => {
    expect(rebuildPrefilledNewRolls([], [], 'SINGLE')).toHaveLength(0);
  });

  it('REGRESYON (SINGLE karşılığı): kısmi kabulde tek satırın toplamı işaretliye iner', () => {
    // 2 top sevk edildi → tek satır 220. Biri gelmedi → tek satır 100 olmalı;
    // bayat 220 kalırsa fazladan metraj doğar (PER_ROLL saha bug'ının ikizi).
    const afterApplyParty = rebuildPrefilledNewRolls([], [100, 120], 'SINGLE');
    expect(afterApplyParty[0].qty).toBe('220');

    const afterUncheck = rebuildPrefilledNewRolls(afterApplyParty, [100], 'SINGLE');
    expect(afterUncheck).toHaveLength(1);
    expect(afterUncheck[0].qty).toBe('100');
  });

  it('elle eklenen satırları korur, ön-dolu toplam satırı başa koyar', () => {
    const manual = { ...makeNewRollRow('42', false), key: 'manual-1' };
    const out = rebuildPrefilledNewRolls([manual], [50, 50], 'SINGLE');
    expect(out).toHaveLength(2);
    expect(out[0].prefilled).toBe(true);
    expect(out[0].qty).toBe('100');
    expect(out[1].key).toBe('manual-1');
    expect(out[1].qty).toBe('42');
  });
});

describe('mod geçişleri (SINGLE ↔ PER_ROLL, iki yönlü buton)', () => {
  it('SINGLE → PER_ROLL: tek toplam satırı, top başına satırlara açılır', () => {
    const single = rebuildPrefilledNewRolls([], [40, 60], 'SINGLE');
    const out = rebuildPrefilledNewRolls(single, [40, 60], 'PER_ROLL');
    expect(out.map((r) => r.qty)).toEqual(['40', '60']);
  });

  it('PER_ROLL → SINGLE: top başına satırlar tek toplam satıra döner', () => {
    const perRoll = rebuildPrefilledNewRolls([], [40, 60], 'PER_ROLL');
    const out = rebuildPrefilledNewRolls(perRoll, [40, 60], 'SINGLE');
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe('100');
  });

  it('mod geçişinde elle eklenen satır hayatta kalır', () => {
    const manual = { ...makeNewRollRow('12,5', false), key: 'm-1' };
    const single = [...rebuildPrefilledNewRolls([], [40, 60], 'SINGLE'), manual];
    const out = rebuildPrefilledNewRolls(single, [40, 60], 'PER_ROLL');
    expect(out.filter((r) => !r.prefilled)).toHaveLength(1);
    expect(out.find((r) => !r.prefilled)?.qty).toBe('12,5');
  });
});
