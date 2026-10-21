// =============================================================================
// loomBirth — KK1 tezgah etiketi okutma (S3a) saf kuralları
// =============================================================================
import type { Kk1Context } from '../../../types/models';
import { resolveDokumaRollBirth } from '../../../services/featureFlag.service';
import { isDoffLinkVisible } from './doffLink';
import {
  EMPTY_LOOM_BIRTH,
  afterSave,
  applyScanResult,
  beamQuestion,
  classifyLoomBirthFailure,
  contextLine,
  isLoomBirthVisible,
  loomBirthFingerprint,
  loomBirthPayload,
  orderPickAllowed,
  selectOrder,
  type LoomBirthState,
} from './loomBirth';

function ctx(over: Partial<Kk1Context['beams']> = {}, lines = 1): Kk1Context {
  return {
    machine: { id: 'm7', code: 'T-07', name: 'Tezgah 7', productionLineCount: lines },
    run: {
      id: 'r1',
      productionLineNo: 1,
      startedAt: '2026-10-21T05:00:00Z',
      weavingOrder: { id: 'wo1', weavingOrderNumber: 'DK261021-0003' },
      item: { id: 'i1', code: 'KR', name: 'KRİSTAL' },
      color: null,
      warpSpec: null,
    },
    beams: { mounted: [{ id: 'b9', beamNo: 'LV-09', position: 1, remainingM: '412.4' }], recentChange: null, ...over },
    rollBirth: 'KK1_LABEL_OR_ORDER',
  };
}
const changed = ctx({ recentChange: { at: '2026-10-21T04:00:00Z', dismounted: { id: 'b7', beamNo: 'LV-07' }, mounted: { id: 'b9', beamNo: 'LV-09' } } });
const scanned = (c: Kk1Context | null = ctx()): LoomBirthState =>
  applyScanResult(EMPTY_LOOM_BIRTH, 'T-07', c ? { ok: true, context: c } : { ok: false, ambiguous: true }).state;

describe('görünürlük × 3 mod', () => {
  it('⭐ yalnız KK1_* ∧ dokuma ∧ !yarı mamul; TABLET_DOFF iken HİÇ çizilmez', () => {
    expect(isLoomBirthVisible(true, 'TABLET_DOFF', false)).toBe(false);
    expect(isLoomBirthVisible(true, 'KK1_LABEL_OR_ORDER', false)).toBe(true);
    expect(isLoomBirthVisible(true, 'KK1_LABEL_ONLY', false)).toBe(true);
    expect(isLoomBirthVisible(false, 'KK1_LABEL_ONLY', false)).toBe(false);
    expect(isLoomBirthVisible(true, 'KK1_LABEL_ONLY', true)).toBe(false);
  });

  it('⭐ eski "Bu top dokuma mı?" KK1_* modda GİZLİ, yalnız TABLET_DOFF\'ta', () => {
    expect(isDoffLinkVisible(true, false, 'KK1_LABEL_OR_ORDER')).toBe(false);
    expect(isDoffLinkVisible(true, false, 'KK1_LABEL_ONLY')).toBe(false);
    expect(isDoffLinkVisible(true, false, 'TABLET_DOFF')).toBe(true);
  });

  it('iş seçimi (A yolu) yalnız KK1_LABEL_OR_ORDER', () => {
    expect(orderPickAllowed('KK1_LABEL_OR_ORDER')).toBe(true);
    expect(orderPickAllowed('KK1_LABEL_ONLY')).toBe(false);
    expect(orderPickAllowed('TABLET_DOFF')).toBe(false);
  });

  it('bayrak aynası: dokuma kapalı ya da tanınmayan değer → TABLET_DOFF (bugünkü ekran)', () => {
    expect(resolveDokumaRollBirth({ dokumaEnabled: false, dokumaRollBirth: 'KK1_LABEL_ONLY' })).toBe('TABLET_DOFF');
    expect(resolveDokumaRollBirth({ dokumaEnabled: true, dokumaRollBirth: 'BILINMEZ' as never })).toBe('TABLET_DOFF');
    expect(resolveDokumaRollBirth({ dokumaEnabled: true, dokumaRollBirth: 'KK1_LABEL_ONLY' })).toBe('KK1_LABEL_ONLY');
    expect(resolveDokumaRollBirth(undefined)).toBe('TABLET_DOFF');
  });
});

describe('payload üç dal', () => {
  it('⭐ etiket → {machineCode}; levent değişmediyse warpBeamId YOK', () => {
    expect(loomBirthPayload(scanned(), 'KK1_LABEL_ONLY', true)).toEqual({ machineCode: 'T-07' });
  });

  it('⭐ iş seçimi → {weavingOrderId}; KK1_LABEL_ONLY\'de iş gönderilmez', () => {
    const s = selectOrder(EMPTY_LOOM_BIRTH, { id: 'wo1', weavingOrderNumber: 'DK1', itemName: 'X' });
    expect(loomBirthPayload(s, 'KK1_LABEL_OR_ORDER', true)).toEqual({ weavingOrderId: 'wo1' });
    expect(loomBirthPayload(s, 'KK1_LABEL_ONLY', true)).toEqual({});
  });

  it('⭐ hiçbiri / görünmüyor → BOŞ (top dışarıdan; bugünkü payload)', () => {
    expect(loomBirthPayload(EMPTY_LOOM_BIRTH, 'KK1_LABEL_OR_ORDER', true)).toEqual({});
    expect(loomBirthPayload(scanned(), 'KK1_LABEL_OR_ORDER', false)).toEqual({});
  });

  it('etiket iş seçimini, iş seçimi etiketi siler (XOR)', () => {
    const o = selectOrder(scanned(), { id: 'wo1', weavingOrderNumber: 'DK1', itemName: null });
    expect(o.machineCode).toBeNull();
    const m = applyScanResult(o, 'T-07', { ok: true, context: ctx() }).state;
    expect(m.order).toBeNull();
  });

  it('çok hatlı tezgah → productionLineNo koşumun hattından', () => {
    const s = scanned(ctx({}, 2));
    expect(loomBirthPayload(s, 'KK1_LABEL_ONLY', true)).toEqual({ machineCode: 'T-07', productionLineNo: 1 });
  });
});

describe('levent çipi kuralı', () => {
  it('⭐ değişim yoksa soru yok; varsa iki çip, varsayılan YENİ (alan gönderilmez)', () => {
    expect(beamQuestion(ctx())).toBeNull();
    expect(beamQuestion(changed)).toEqual({ old: { id: 'b7', beamNo: 'LV-07' }, newBeamNo: 'LV-09' });
    expect(loomBirthPayload(scanned(changed), 'KK1_LABEL_ONLY', true)).toEqual({ machineCode: 'T-07' });
  });

  it('⭐ "eski" seçilirse warpBeamId = sökülen; WARP_BEAM_NOT_RECENT sonrası çip kalkar → alan yok', () => {
    const old: LoomBirthState = { ...scanned(changed), beamChoice: 'old' };
    expect(loomBirthPayload(old, 'KK1_LABEL_ONLY', true)).toEqual({ machineCode: 'T-07', warpBeamId: 'b7' });
    expect(loomBirthPayload({ ...old, beamChipsDismissed: true }, 'KK1_LABEL_ONLY', true)).toEqual({ machineCode: 'T-07' });
  });
});

describe('hata sınıfı', () => {
  it.each([
    ['MACHINE_NO_OPEN_RUN', 'no-open-run'],
    ['WEAVING_ORDER_NO_OPEN_RUN', 'no-open-run'],
    ['ROLL_BIRTH_MODE', 'mode-changed'],
    ['MODULE_DISABLED', 'mode-changed'],
    ['MACHINE_NOT_LOOM', 'not-loom'],
    ['MACHINE_NOT_FOUND', 'not-loom'],
    ['WARP_BEAM_NOT_RECENT', 'beam-not-recent'],
    ['WEAVING_ORDER_NOT_OPEN', 'order-closed'],
    ['POSSIBLE_DUPLICATE', 'plain'],
    [undefined, 'plain'],
  ])('%s → %s', (code, kind) => {
    expect(classifyLoomBirthFailure(code)).toBe(kind);
  });
});

describe('okutma · kayıt sonrası · şerit', () => {
  it('⭐ 4xx bağlam cevabı → RET (durum değişmez); ağ hatası → kabul, "bağlanınca doğrulanır"', () => {
    expect(applyScanResult(EMPTY_LOOM_BIRTH, 'T-99', { ok: false, ambiguous: false })).toEqual({ outcome: 'reject', state: EMPTY_LOOM_BIRTH });
    const off = scanned(null);
    expect(off.machineCode).toBe('T-07');
    expect(off.verify).toBe('unverified');
    expect(contextLine(off)).toBe('T-07 · bağlanınca doğrulanır');
    expect(loomBirthPayload(off, 'KK1_LABEL_ONLY', true)).toEqual({ machineCode: 'T-07' });
  });

  it('kayıttan sonra şerit temizlenir, "Aynı tezgah" için son kod kalır', () => {
    const s = afterSave(scanned());
    expect(s.machineCode).toBeNull();
    expect(s.lastMachineCode).toBe('T-07');
    expect(loomBirthPayload(s, 'KK1_LABEL_ONLY', true)).toEqual({});
  });

  it('şerit: tezgah · iş no · kumaş · levent kalan', () => {
    expect(contextLine(scanned())).toBe('T-07 · DK261021-0003 · KRİSTAL · LV-09 kalan 412 m');
  });

  it('parmak izi: tezgah/iş/levent ayrımı; bağ yoksa null (bugünkü parmak izi)', () => {
    expect(loomBirthFingerprint({ machineCode: 'T-07' })).toBe('m:T-07:1:-');
    expect(loomBirthFingerprint({ machineCode: 'T-07', warpBeamId: 'b7' })).not.toBe(loomBirthFingerprint({ machineCode: 'T-07' }));
    expect(loomBirthFingerprint({ weavingOrderId: 'wo1' })).toBe('o:wo1');
    expect(loomBirthFingerprint({})).toBeNull();
  });
});
