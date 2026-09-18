import {
  EMPTY_RUN_FORM,
  buildClosePayload,
  buildOpenRunPayload,
  classifyRunFailure,
  prefillFromOrder,
  runFingerprint,
  validateClose,
  validateRunOpen,
} from './runPayload';
import type { WeavingOrderSummary } from '../../../services/weavingOrder.service';

const order: WeavingOrderSummary = {
  id: 'wo1',
  weavingOrderNumber: 'DK1409260001',
  itemId: 'i1',
  colorId: 'c1',
  plannedM: 1200,
  executionKind: 'IN_HOUSE',
  status: 'PLANNED',
  item: { id: 'i1', code: 'K1', name: 'Perde kumaşı' },
  color: { id: 'c1', code: 'R', name: 'Kırmızı' },
  subcontractor: null,
};
const ctx = { machineId: 'm1', productionLineNo: 1, startedAtIso: '2026-09-14T10:00:00.000Z', clientToken: 'tok' };

describe('runPayload — koşum aç (§3.4 (1))', () => {
  it('⭐ iş emri OPSİYONEL: emirsiz koşum (numune) meşru — desen/renk/hedef null gider', () => {
    const p = buildOpenRunPayload(EMPTY_RUN_FORM, ctx);
    expect(p.weavingOrderId).toBeNull();
    expect(p.itemId).toBeNull();
    expect(p.targetUnitsPerMin).toBeNull();
    expect(p.startedAt).toBe(ctx.startedAtIso);
    expect(p.clientToken).toBe('tok');
  });
  it('⭐ iş emri seçilince desen/renk ÖN-DOLAR, kilitli değil (sonradan değişebilir)', () => {
    const f = prefillFromOrder(EMPTY_RUN_FORM, order);
    expect(f).toMatchObject({ weavingOrderId: 'wo1', itemId: 'i1', itemLabel: 'Perde kumaşı', colorId: 'c1', colorLabel: 'Kırmızı' });
    const p = buildOpenRunPayload({ ...f, itemId: 'i9', colorId: null }, ctx);
    expect(p.itemId).toBe('i9');
    expect(p.colorId).toBeNull();
    expect(prefillFromOrder(f, null).weavingOrderId).toBeNull();
  });
  it('hedef devir: boş serbest (yedek MachineSpec); 0/negatif/kesirli/aşırı red', () => {
    expect(validateRunOpen({ ...EMPTY_RUN_FORM, targetUnitsPerMin: '' }).ok).toBe(true);
    expect(validateRunOpen({ ...EMPTY_RUN_FORM, targetUnitsPerMin: '0' }).ok).toBe(false);
    expect(validateRunOpen({ ...EMPTY_RUN_FORM, targetUnitsPerMin: '12.5' }).ok).toBe(false);
    expect(validateRunOpen({ ...EMPTY_RUN_FORM, targetUnitsPerMin: '10001' }).ok).toBe(false);
  });

  it('⭐ dokumaRunWeavingOrderRequired açıkken iş zorunlu (sunucu 400 istemci ikizi); kapalıyken serbest', () => {
    expect(validateRunOpen({ ...EMPTY_RUN_FORM }, true).ok).toBe(false);
    expect(validateRunOpen({ ...EMPTY_RUN_FORM, weavingOrderId: 'wo1' }, true).ok).toBe(true);
    expect(validateRunOpen({ ...EMPTY_RUN_FORM }, false).ok).toBe(true);
    expect(buildOpenRunPayload({ ...EMPTY_RUN_FORM, targetUnitsPerMin: '420' }, ctx).targetUnitsPerMin).toBe(420);
  });
  it('⭐ atkı sıklığı (ham atkı/cm): boş → null (metre türetilmez); ondalık kabul; 0/negatif/aşırı red', () => {
    expect(buildOpenRunPayload(EMPTY_RUN_FORM, ctx).unitsPerCm).toBeNull();
    expect(buildOpenRunPayload({ ...EMPTY_RUN_FORM, unitsPerCm: '24.5' }, ctx).unitsPerCm).toBe(24.5);
    expect(validateRunOpen({ ...EMPTY_RUN_FORM, unitsPerCm: '' }).ok).toBe(true);
    expect(validateRunOpen({ ...EMPTY_RUN_FORM, unitsPerCm: '24.5' }).ok).toBe(true);
    expect(validateRunOpen({ ...EMPTY_RUN_FORM, unitsPerCm: '0' }).ok).toBe(false);
    expect(validateRunOpen({ ...EMPTY_RUN_FORM, unitsPerCm: '-3' }).ok).toBe(false);
    expect(validateRunOpen({ ...EMPTY_RUN_FORM, unitsPerCm: '1001' }).ok).toBe(false);
  });
  it('parmak izi: makine · hat · iş emri · desen (hedef devir, sıklık ve renk girmez)', () => {
    const a = runFingerprint({ machineId: 'm1', productionLineNo: 1, weavingOrderId: 'wo1', itemId: 'i1' });
    expect(runFingerprint({ machineId: 'm1', productionLineNo: 2, weavingOrderId: 'wo1', itemId: 'i1' })).not.toBe(a);
    expect(runFingerprint({ machineId: 'm1', productionLineNo: 1, weavingOrderId: null, itemId: 'i1' })).not.toBe(a);
  });
});

describe('runPayload — kapat', () => {
  it('⭐ atkı boş → null ("ölçülmedi", 0 DEĞİL); negatif/kesirli red', () => {
    expect(buildClosePayload('', 'T').picksAtClose).toBeNull();
    expect(buildClosePayload('1500', 'T')).toEqual({ endedAt: 'T', picksAtClose: 1500 });
    expect(validateClose('').ok).toBe(true);
    expect(validateClose('-1').ok).toBe(false);
    expect(validateClose('1.5').ok).toBe(false);
  });
});

describe('classifyRunFailure — 409 kodları', () => {
  it('hat dolu / bindirme / kapanmış / geri alınmış → koşum listesini tazele', () => {
    for (const c of ['PRODUCTION_LINE_OCCUPIED', 'PRODUCTION_LINE_OVERLAP', 'RUN_ALREADY_CLOSED', 'RUN_REVOKED', 'RUN_ALREADY_REVOKED']) {
      expect(classifyRunFailure({ details: { code: c } }, 'x').kind).toBe('refresh-runs');
    }
  });
  it('iş emri açık değil / fasonda → iş emri listesini tazele; yarış → tekrar dene; çakışma → modal', () => {
    expect(classifyRunFailure({ details: { code: 'WEAVING_ORDER_NOT_OPEN' } }, 'x').kind).toBe('refresh-orders');
    expect(classifyRunFailure({ details: { code: 'WEAVING_ORDER_SUBCONTRACTED' } }, 'x').kind).toBe('refresh-orders');
    expect(classifyRunFailure({ details: { code: 'MACHINE_RUN_RACE' } }, 'x').kind).toBe('retry');
    expect(classifyRunFailure({ details: { code: 'CLIENT_TOKEN_COLLISION' } }, 'x').kind).toBe('token-collision');
    expect(classifyRunFailure({}, 'Kayıt gitmedi')).toEqual({ kind: 'plain', message: 'Kayıt gitmedi' });
  });
});
