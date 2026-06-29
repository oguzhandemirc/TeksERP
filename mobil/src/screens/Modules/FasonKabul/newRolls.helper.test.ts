import { makeNewRollRow, rebuildPrefilledNewRolls } from './newRolls.helper';

describe('rebuildPrefilledNewRolls — fason kabul kısmi-kabul fazladan-doğum guard', () => {
  it('tam kabul: 2 işaretli top → 2 ön-dolu parça (metreler korunur)', () => {
    const out = rebuildPrefilledNewRolls([], [100, 120]);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.prefilled)).toBe(true);
    expect(out.map((r) => r.qty)).toEqual(['100', '120']);
  });

  it('REGRESYON: kısmi kabul (1 top işaretten çıkınca) ön-dolu parça da 2→1 düşer', () => {
    // 1 sevk / 2 top → parti seçilince 2 ön-dolu satır kurulur.
    const afterApplyParty = rebuildPrefilledNewRolls([], [100, 120]);
    expect(afterApplyParty).toHaveLength(2);

    // Operatör gelmeyen ikinci topu işaretten çıkarır → işaretli yalnız [100].
    const afterUncheck = rebuildPrefilledNewRolls(afterApplyParty, [100]);

    // Bug öncesi 2 kalıyordu (→ backend 2 born roll). Artık 1 olmalı.
    expect(afterUncheck).toHaveLength(1);
    expect(afterUncheck[0].qty).toBe('100');
    expect(afterUncheck[0].prefilled).toBe(true);
  });

  it('yeniden işaretlenince ön-dolu parça geri gelir (1→2)', () => {
    const partial = rebuildPrefilledNewRolls([], [100]);
    const restored = rebuildPrefilledNewRolls(partial, [100, 120]);
    expect(restored).toHaveLength(2);
    expect(restored.map((r) => r.qty)).toEqual(['100', '120']);
  });

  it('operatörün elle girdiği satır (prefilled=false) korunur — boyahane merge/split esnekliği', () => {
    const manual = { ...makeNewRollRow('55', false), key: 'manual-1' };
    const current = [...rebuildPrefilledNewRolls([], [100, 120]), manual];

    // 1 top işaretten çıkar: ön-dolu 1'e düşer ama elle satır aynen kalır.
    const out = rebuildPrefilledNewRolls(current, [100]);
    const prefilled = out.filter((r) => r.prefilled);
    const kept = out.filter((r) => !r.prefilled);
    expect(prefilled).toHaveLength(1);
    expect(kept).toHaveLength(1);
    expect(kept[0].key).toBe('manual-1');
    expect(kept[0].qty).toBe('55');
  });

  it('hiçbir top işaretli değilken ön-dolu satır kalmaz (canSubmit zaten checkedCount>0 ister)', () => {
    const out = rebuildPrefilledNewRolls(rebuildPrefilledNewRolls([], [100, 120]), []);
    expect(out).toHaveLength(0);
  });

  it('metresi 0/eksik top → boş qty ile ön-dolu (operatör girer)', () => {
    const out = rebuildPrefilledNewRolls([], [0]);
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe('');
    expect(out[0].prefilled).toBe(true);
  });

  it('toggleAll: hepsi kaldır → ön-dolu boşalır (elle satır kalır), hepsi seç → geri gelir', () => {
    const manual = { ...makeNewRollRow('40', false), key: 'm-1' };
    const start = [...rebuildPrefilledNewRolls([], [100, 120]), manual];

    // toggleAll OFF (hiç işaretli yok)
    const allOff = rebuildPrefilledNewRolls(start, []);
    expect(allOff.filter((r) => r.prefilled)).toHaveLength(0);
    expect(allOff.filter((r) => !r.prefilled)).toHaveLength(1); // elle satır durur

    // toggleAll ON (hepsi işaretli)
    const allOn = rebuildPrefilledNewRolls(allOff, [100, 120]);
    expect(allOn.filter((r) => r.prefilled)).toHaveLength(2);
    expect(allOn.filter((r) => !r.prefilled).map((r) => r.key)).toEqual(['m-1']);
  });

  it('çoklu elle ekleme + kısmi uncheck: elle eklenenler korunur, ön-dolu işaretliye iner', () => {
    const m1 = { ...makeNewRollRow('30', false), key: 'm-1' };
    const m2 = { ...makeNewRollRow('35', false), key: 'm-2' };
    const start = [...rebuildPrefilledNewRolls([], [100, 120, 90]), m1, m2];
    expect(start.filter((r) => r.prefilled)).toHaveLength(3);

    // 3 toptan 1'i işaretten çıkar → ön-dolu 2'ye iner, 2 elle satır aynen kalır
    const out = rebuildPrefilledNewRolls(start, [100, 120]);
    expect(out.filter((r) => r.prefilled)).toHaveLength(2);
    expect(out.filter((r) => !r.prefilled).map((r) => r.key)).toEqual(['m-1', 'm-2']);
  });
});
