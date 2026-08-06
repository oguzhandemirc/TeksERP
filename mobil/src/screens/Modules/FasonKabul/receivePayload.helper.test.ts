import { makeNewRollRow, rebuildPrefilledNewRolls } from './newRolls.helper';
import {
  parseNewRolls,
  buildReceivePayload,
  parseAppliedWidth,
  type BuildReceivePayloadArgs,
  type PayloadRollRow,
} from './receivePayload.helper';
import type {
  FabricProperty,
  PendingReturnGroup,
  PendingReturnParty,
} from '../../../types/models';

const GROUP = {
  workOrder: { id: 'wo-1' },
  step: { id: 'step-1' },
  lastDispatch: { subcontractorId: 'sub-last' },
} as unknown as PendingReturnGroup;

const PARTY = { subcontractorId: 'sub-party' } as unknown as PendingReturnParty;

function row(rollId: string, checked: boolean): PayloadRollRow {
  return { rollId, checked, notes: '' };
}

function baseArgs(overrides: Partial<BuildReceivePayloadArgs> = {}): BuildReceivePayloadArgs {
  return {
    selectedGroup: GROUP,
    selectedParty: null,
    rows: [],
    newRolls: [],
    manifestNo: '',
    notes: '',
    appliesColor: false,
    appliedColorId: null,
    appliedProperties: [],
    appliedWidth: '',
    ...overrides,
  };
}

describe('parseNewRolls', () => {
  it('geçerli qty parse (virgül→nokta) + notes trim', () => {
    const out = parseNewRolls([
      { ...makeNewRollRow('100', true) },
      { ...makeNewRollRow('120,5', true), notes: '  ek not  ' },
    ]);
    expect(out).toEqual([
      { qty: 100, notes: null },
      { qty: 120.5, notes: 'ek not' },
    ]);
  });

  it('≤0 / NaN / boş satırlar atlanır', () => {
    const out = parseNewRolls([
      makeNewRollRow('0', true),
      makeNewRollRow('-5', true),
      makeNewRollRow('', true),
      makeNewRollRow('abc', true),
      makeNewRollRow('50', false),
    ]);
    expect(out).toEqual([{ qty: 50, notes: null }]);
  });
});

describe('buildReceivePayload — geçersiz durumlar null döner (canSubmit sözleşmesi)', () => {
  it('grup yok → null', () => {
    expect(buildReceivePayload(baseArgs({ selectedGroup: null }))).toBeNull();
  });

  it('subId yok (parti yok + lastDispatch yok) → null', () => {
    const noSub = { workOrder: { id: 'wo' }, step: { id: 's' } } as unknown as PendingReturnGroup;
    expect(
      buildReceivePayload(
        baseArgs({ selectedGroup: noSub, rows: [row('r1', true)], newRolls: [makeNewRollRow('10', true)] }),
      ),
    ).toBeNull();
  });

  it('hiç işaretli top yok → null', () => {
    expect(
      buildReceivePayload(baseArgs({ rows: [row('r1', false)], newRolls: [makeNewRollRow('10', true)] })),
    ).toBeNull();
  });

  it('geçerli newRolls yok → null', () => {
    expect(
      buildReceivePayload(baseArgs({ rows: [row('r1', true)], newRolls: [makeNewRollRow('0', true)] })),
    ).toBeNull();
  });
});

describe('buildReceivePayload — fason firma (subId) seçimi', () => {
  it('seçili parti varsa onun firması (çoklu sevk)', () => {
    const p = buildReceivePayload(
      baseArgs({ selectedParty: PARTY, rows: [row('r1', true)], newRolls: [makeNewRollRow('10', true)] }),
    );
    expect(p?.subcontractorId).toBe('sub-party');
  });

  it('parti yoksa lastDispatch firması (tekli/eski akış)', () => {
    const p = buildReceivePayload(
      baseArgs({ rows: [row('r1', true)], newRolls: [makeNewRollRow('10', true)] }),
    );
    expect(p?.subcontractorId).toBe('sub-last');
  });
});

describe('buildReceivePayload — returns YALNIZ işaretli toplar', () => {
  it('işaretsiz toplar returns dışında kalır', () => {
    const p = buildReceivePayload(
      baseArgs({
        rows: [row('r1', true), row('r2', false), row('r3', true)],
        newRolls: [makeNewRollRow('10', true), makeNewRollRow('12', true)],
      }),
    );
    expect(p?.returns.map((r) => r.rollId)).toEqual(['r1', 'r3']);
  });
});

describe("KOMPOZİT REGRESYON — saha bug'ı (kısmi kabul) ekran-mantığı seviyesinde", () => {
  // applyParty → updateRow(uncheck) → buildReceivePayload zincirini render'sız izler.
  const ROLLS = [
    { rollId: 'r1', qty: 100 },
    { rollId: 'r2', qty: 120 },
  ];

  it('2 top parti → 1 top işaretten çıkınca returns=1 VE newRolls=1 (eski kodda 1 vs 2 olurdu)', () => {
    // applyParty (istisna modu PER_ROLL): tüm toplar işaretli, ön-dolu newRolls = parti topları
    let checked = new Set(['r1', 'r2']);
    let newRolls = rebuildPrefilledNewRolls([], ROLLS.filter((r) => checked.has(r.rollId)).map((r) => r.qty), 'PER_ROLL');
    expect(newRolls).toHaveLength(2);

    // updateRow: gelmeyen 2. topu işaretten çıkar → newRolls resync
    checked = new Set(['r1']);
    newRolls = rebuildPrefilledNewRolls(newRolls, ROLLS.filter((r) => checked.has(r.rollId)).map((r) => r.qty), 'PER_ROLL');
    const rows = ROLLS.map((r) => row(r.rollId, checked.has(r.rollId)));

    const payload = buildReceivePayload(baseArgs({ selectedParty: PARTY, rows, newRolls }));
    expect(payload).not.toBeNull();
    expect(payload!.returns).toHaveLength(1);
    expect(payload!.newRolls).toHaveLength(1); // ← BUG'da 2 olurdu
    expect(payload!.newRolls[0].qty).toBe(100);
  });

  it('SINGLE (varsayılan) zinciri: uncheck sonrası tek parçanın metresi toplamla güncellenir', () => {
    // applyParty: SINGLE → tek ön-dolu satır 220 (100+120)
    let checked = new Set(['r1', 'r2']);
    let newRolls = rebuildPrefilledNewRolls([], ROLLS.filter((r) => checked.has(r.rollId)).map((r) => r.qty), 'SINGLE');
    expect(newRolls.map((r) => r.qty)).toEqual(['220']);

    // updateRow: 2. top gelmedi → tek satır 100'e iner (bayat 220 kalırsa fazla metraj doğar)
    checked = new Set(['r1']);
    newRolls = rebuildPrefilledNewRolls(newRolls, ROLLS.filter((r) => checked.has(r.rollId)).map((r) => r.qty), 'SINGLE');
    const rows = ROLLS.map((r) => row(r.rollId, checked.has(r.rollId)));

    const payload = buildReceivePayload(baseArgs({ selectedParty: PARTY, rows, newRolls }));
    expect(payload!.returns).toHaveLength(1);
    expect(payload!.newRolls).toHaveLength(1);
    expect(payload!.newRolls[0].qty).toBe(100);
  });

  it('MERGE meşru: 2 işaretli top, operatör tek parça bırakır → newRolls=1', () => {
    const rows = [row('r1', true), row('r2', true)];
    const newRolls = [makeNewRollRow('560', false)]; // operatör elle tek birleşik parça
    const payload = buildReceivePayload(baseArgs({ selectedParty: PARTY, rows, newRolls }));
    expect(payload!.returns).toHaveLength(2);
    expect(payload!.newRolls).toHaveLength(1);
  });

  it('SPLIT meşru: 1 işaretli top, operatör 2 parça açar → newRolls=2', () => {
    const rows = [row('r1', true)];
    const newRolls = [makeNewRollRow('150', true), makeNewRollRow('140', false)];
    const payload = buildReceivePayload(baseArgs({ selectedParty: PARTY, rows, newRolls }));
    expect(payload!.returns).toHaveLength(1);
    expect(payload!.newRolls).toHaveLength(2);
  });
});

describe('buildReceivePayload — appliesColor dalı', () => {
  it('appliesColor=true → appliedColorId + appliedPropertyIds eklenir', () => {
    const p = buildReceivePayload(
      baseArgs({
        rows: [row('r1', true)],
        newRolls: [makeNewRollRow('10', true)],
        appliesColor: true,
        appliedColorId: 'c1',
        appliedProperties: [
          { id: 'p1' } as unknown as FabricProperty,
          { id: 'p2' } as unknown as FabricProperty,
        ],
      }),
    );
    expect(p).toMatchObject({ appliedColorId: 'c1', appliedPropertyIds: ['p1', 'p2'] });
  });

  it('appliesColor=false → renk/özellik alanları payload\'da YOK', () => {
    const p = buildReceivePayload(
      baseArgs({ rows: [row('r1', true)], newRolls: [makeNewRollRow('10', true)] }),
    );
    expect(p).not.toHaveProperty('appliedColorId');
    expect(p).not.toHaveProperty('appliedPropertyIds');
  });
});

describe('parseAppliedWidth', () => {
  it('virgülü noktaya çevirir', () => {
    expect(parseAppliedWidth('145,5')).toBe(145.5);
  });
  it('geçerli sayıyı döner', () => {
    expect(parseAppliedWidth('280')).toBe(280);
  });
  it('boş / sıfır / negatif / anlamsız → null ("ölçülmedi")', () => {
    // 0 bilinçli olarak null: 0 cm'lik kumaş yok, 0 "ölçmedim" demektir.
    expect(parseAppliedWidth('')).toBeNull();
    expect(parseAppliedWidth('0')).toBeNull();
    expect(parseAppliedWidth('-5')).toBeNull();
    expect(parseAppliedWidth('abc')).toBeNull();
  });
});

describe('buildReceivePayload — appliedWidth (EN)', () => {
  it('geçerli en payload\'a girer', () => {
    const p = buildReceivePayload(
      baseArgs({
        rows: [row('r1', true)],
        newRolls: [makeNewRollRow('10', true)],
        appliedWidth: '145,5',
      }),
    );
    expect(p).toMatchObject({ appliedWidth: 145.5 });
  });

  it('en girilmediyse alan payload\'da HİÇ YOK (null gönderilmez)', () => {
    const p = buildReceivePayload(
      baseArgs({ rows: [row('r1', true)], newRolls: [makeNewRollRow('10', true)] }),
    );
    expect(p).not.toHaveProperty('appliedWidth');
  });

  /**
   * ⚠️ KURALIN KENDİSİ — bu test bir davranışı değil bir KARARI kilitler.
   * EN, renkten farklı olarak `appliesColor`'a BAĞLI DEĞİLDİR: renk yalnız "renk
   * veren" kategoride (boyahane) sorulur, en HER fason dönüşünde (zımpara dahil).
   * Gerekçe: topun eni sisteme ilk kez fason kabulünde giriyor — ham girişte en
   * tasarım gereği yazılmıyor. İkisi tek bir `if` altında birleştirilirse
   * zımparadan dönen top sonsuza dek ensiz kalır ve HİÇBİR HATA ÇIKMAZ.
   */
  it('appliesColor=false olsa BİLE en gönderilir (renkle aynı koşula bağlanmamalı)', () => {
    const p = buildReceivePayload(
      baseArgs({
        rows: [row('r1', true)],
        newRolls: [makeNewRollRow('10', true)],
        appliesColor: false,
        appliedWidth: '160',
      }),
    );
    expect(p).toMatchObject({ appliedWidth: 160 });
    expect(p).not.toHaveProperty('appliedColorId');
  });
});
