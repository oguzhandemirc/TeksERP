import { makeNewRollRow, rebuildPrefilledNewRolls } from './newRolls.helper';
import {
  parseNewRolls,
  buildReceivePayload,
  parseAppliedWidth,
  consumedTotalOf,
  resolveReturns,
  shrinkExceedsTolerance,
  shrinkInfo,
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

// ─────────────────────────────────────────────────────────────────────────────
// KISMİ KABUL (2026-08-19) — "100 gitti, 51 geldi, 49 sonra"
// ─────────────────────────────────────────────────────────────────────────────
import { partialReceivedQty } from './receivePayload.helper';

function partialRow(
  rollId: string,
  receivedQtyStr: string,
  remainingQty: number,
): PayloadRollRow {
  return { rollId, checked: true, notes: '', receivedQtyStr, remainingQty };
}

describe('partialReceivedQty — kısmi karar eşiği', () => {
  it('gelen < kalan → kısmi (değer döner)', () => {
    expect(partialReceivedQty(partialRow('r1', '51', 100))).toBe(51);
  });
  it('virgüllü giriş desteklenir', () => {
    expect(partialReceivedQty(partialRow('r1', '51,5', 100))).toBe(51.5);
  });
  it('gelen = kalan → TAM (null)', () => {
    expect(partialReceivedQty(partialRow('r1', '100', 100))).toBeNull();
  });
  it('gelen > kalan (fazla dönen) → TAM (null; backend clamp zaten var)', () => {
    expect(partialReceivedQty(partialRow('r1', '104', 100))).toBeNull();
  });
  it('0.01 m eşiği: yüzer-nokta gürültüsü kısmi SAYILMAZ', () => {
    expect(partialReceivedQty(partialRow('r1', '99.995', 100))).toBeNull();
  });
  it('parse edilemeyen / boş giriş → TAM (null)', () => {
    expect(partialReceivedQty(partialRow('r1', '', 100))).toBeNull();
    expect(partialReceivedQty(partialRow('r1', 'abc', 100))).toBeNull();
  });
  it('alanlar hiç yoksa (eski çağıran) → TAM (null)', () => {
    expect(partialReceivedQty({ rollId: 'r1', checked: true, notes: '' })).toBeNull();
  });
});

describe('buildReceivePayload — kısmi kabul + clientToken', () => {
  it('kısmi satır returns[].receivedQty taşır, tam satır TAŞIMAZ', () => {
    const p = buildReceivePayload(
      baseArgs({
        rows: [partialRow('r1', '51', 100), partialRow('r2', '200', 200)],
        newRolls: [makeNewRollRow('51', true), makeNewRollRow('200', true)],
      }),
    );
    expect(p?.returns).toEqual([
      expect.objectContaining({ rollId: 'r1', receivedQty: 51 }),
      expect.objectContaining({ rollId: 'r2' }),
    ]);
    expect(p?.returns[1]).not.toHaveProperty('receivedQty');
  });

  it('clientToken her payload\'da üretilir ve UUID biçimindedir (replay kimliği)', () => {
    const p1 = buildReceivePayload(
      baseArgs({ rows: [row('r1', true)], newRolls: [makeNewRollRow('10', true)] }),
    );
    const p2 = buildReceivePayload(
      baseArgs({ rows: [row('r1', true)], newRolls: [makeNewRollRow('10', true)] }),
    );
    expect(p1?.clientToken).toMatch(/^[0-9a-f-]{36}$/);
    // Her mantıksal deneme YENİ token — aynı token'ı yalnız replay taşır
    // (offline kuyruk vars'ı olduğu gibi yeniden gönderir).
    expect(p1?.clientToken).not.toBe(p2?.clientToken);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SAHA SENARYOSU (2026-08-21) — 5 parça (30/40/50/60/70 m) gitti, 220 m döndü
// ═════════════════════════════════════════════════════════════════════════════
// Boyahane parçaları dikip tek parça boyar; dönen metraj çeker. Operatörün
// yapması gereken TEK şey gelen toplamı yazmaktır. Eski ekran bunu "giden/gelen
// uyuşmuyor" alarmıyla karşılayıp operatörü 5 alanı kafadan bölüştürmeye
// itiyordu — aşağıdaki kontroller o yolun bir daha açılmamasını kilitler.
const SAHA = [30, 40, 50, 60, 70];
const sahaRows = () =>
  SAHA.map((q, i) => ({
    rollId: `r${i + 1}`,
    checked: true,
    notes: '',
    remainingQty: q,
  }));

describe('resolveReturns — kalan dağıtımı', () => {
  it('kalan yok: 5 topun 5i de TAM kabul (receivedQty gönderilmez)', () => {
    const out = resolveReturns(sahaRows(), null);
    expect(out).toHaveLength(5);
    expect(out.every((r) => r.receivedQty === null)).toBe(true);
    expect(out.every((r) => !r.dropped)).toBe(true);
    expect(consumedTotalOf(out)).toBe(250);
  });

  it('30 m kalan: yalnız EN BÜYÜK top kısmi olur (tek yarım top, beş değil)', () => {
    const out = resolveReturns(sahaRows(), 30);
    const partial = out.filter((r) => r.leftQty > 0.01);
    expect(partial).toHaveLength(1);
    expect(partial[0].rollId).toBe('r5'); // 70 m'lik top
    expect(partial[0].receivedQty).toBe(40);
    expect(consumedTotalOf(out)).toBe(220);
  });

  it('70 m kalan: en büyük top HİÇ gelmedi (dropped) — dönüş listesine girmez', () => {
    const out = resolveReturns(sahaRows(), 70);
    const dropped = out.filter((r) => r.dropped);
    expect(dropped.map((r) => r.rollId)).toEqual(['r5']);
    expect(consumedTotalOf(out)).toBe(180);
  });

  it('100 m kalan: büyükten küçüğe yığılır (70 tamamı + 60ın 30u)', () => {
    const out = resolveReturns(sahaRows(), 100);
    const byId = Object.fromEntries(out.map((r) => [r.rollId, r]));
    expect(byId.r5.dropped).toBe(true);
    expect(byId.r4.receivedQty).toBe(30); // 60 - 30
    expect(byId.r3.receivedQty).toBe(null); // 50 tamamı geldi
    expect(consumedTotalOf(out)).toBe(150);
  });

  it('DETERMİNİSTİK: eşit metrajlı toplarda sıra rollId ile kırılır', () => {
    const rows = [
      { rollId: 'b', checked: true, notes: '', remainingQty: 50 },
      { rollId: 'a', checked: true, notes: '', remainingQty: 50 },
    ];
    // Aynı girdi → aynı payload. Değişirse offline replay aynı token'la FARKLI
    // içerik gönderir ve idempotency kimliği yalan söyler.
    expect(resolveReturns(rows, 20).find((r) => r.leftQty > 0)!.rollId).toBe('a');
    expect(resolveReturns([...rows].reverse(), 20).find((r) => r.leftQty > 0)!.rollId).toBe('a');
  });

  it('işaretsiz toplar dağıtıma HİÇ girmez', () => {
    const rows = sahaRows().map((r, i) => ({ ...r, checked: i < 2 }));
    const out = resolveReturns(rows, 10);
    expect(out).toHaveLength(2);
    expect(consumedTotalOf(out)).toBe(60); // 30 + 40 - 10
  });
});

describe('shrinkInfo / shrinkExceedsTolerance — çekme', () => {
  it('250 giden 220 gelen → 30 m çekme, %12', () => {
    const s = shrinkInfo(250, 220);
    expect(s.diff).toBe(-30);
    expect(s.shrink).toBe(true);
    expect(s.pct).toBe(12);
    expect(s.significant).toBe(true);
  });

  it('yüzer-nokta gürültüsü fark SAYILMAZ', () => {
    expect(shrinkInfo(0.1 + 0.2, 0.3).significant).toBe(false);
  });

  it('%12 çekme %10 toleransta UYARIR, %15te SUSAR', () => {
    const s = shrinkInfo(250, 220);
    expect(shrinkExceedsTolerance(s, { enabled: true, tolerancePct: 10 })).toBe(true);
    expect(shrinkExceedsTolerance(s, { enabled: true, tolerancePct: 15 })).toBe(false);
  });

  it('bayrak kapalıysa uyarı ASLA çıkmaz', () => {
    const s = shrinkInfo(250, 100); // %60 — devasa fark
    expect(shrinkExceedsTolerance(s, { enabled: false, tolerancePct: 0 })).toBe(false);
  });

  it('FAZLA DÖNEN de aynı toleransa tabidir (yön değil büyüklük)', () => {
    const s = shrinkInfo(250, 300);
    expect(s.shrink).toBe(false);
    expect(shrinkExceedsTolerance(s, { enabled: true, tolerancePct: 10 })).toBe(true);
  });
});

describe('buildReceivePayload — kalan beyanı', () => {
  it('30 m kalan: 5 topun 4ü tam, 1i kısmi; hiçbiri düşmez', () => {
    const p = buildReceivePayload(
      baseArgs({
        rows: sahaRows(),
        newRolls: [makeNewRollRow('220', false)],
        remainderQty: 30,
      }),
    );
    expect(p?.returns).toHaveLength(5);
    expect(p?.returns.filter((r) => 'receivedQty' in r)).toHaveLength(1);
    expect(p?.newRolls).toEqual([{ qty: 220, notes: null }]);
  });

  it('tamamı kalan top dönüş listesine GİRMEZ (0 metre kabul kaydı yoktur)', () => {
    const p = buildReceivePayload(
      baseArgs({
        rows: sahaRows(),
        newRolls: [makeNewRollRow('160', false)],
        remainderQty: 70,
      }),
    );
    expect(p?.returns.map((r) => r.rollId)).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('kalan beyanı satırdaki "Gelen (m)" değerini EZER (tek dil okunur)', () => {
    const rows = sahaRows().map((r) => ({ ...r, receivedQtyStr: '1' }));
    const p = buildReceivePayload(
      baseArgs({ rows, newRolls: [makeNewRollRow('220', false)], remainderQty: 30 }),
    );
    // Satır beyanları okunsaydı 5 kısmi satır doğardı; kalan dağıtımı tektir.
    expect(p?.returns.filter((r) => 'receivedQty' in r)).toHaveLength(1);
  });
});
