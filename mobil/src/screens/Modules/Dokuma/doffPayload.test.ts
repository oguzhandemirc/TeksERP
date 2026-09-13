import { EMPTY_DOFF_FORM, buildDoffPayload, classifyDoffFailure, doffResultFeedback, validateDoffForm } from './doffPayload';

const ctx = { machineId: 'm1', productionLineNo: 2, pressedAtIso: '2026-09-14T10:00:00.000Z', clientToken: 'tok' };

describe('validateDoffForm — backend openSchema ile aynı sınırlar, Türkçe mesaj', () => {
  it('parça sayısı boş/0/kesirli → red; 1..1000 → ok', () => {
    expect(validateDoffForm({ ...EMPTY_DOFF_FORM }).ok).toBe(false);
    expect(validateDoffForm({ ...EMPTY_DOFF_FORM, pieceCount: '0' }).ok).toBe(false);
    expect(validateDoffForm({ ...EMPTY_DOFF_FORM, pieceCount: '1.5' }).ok).toBe(false);
    expect(validateDoffForm({ ...EMPTY_DOFF_FORM, pieceCount: '1001' }).ok).toBe(false);
    expect(validateDoffForm({ ...EMPTY_DOFF_FORM, pieceCount: '1' }).ok).toBe(true);
    expect(validateDoffForm({ ...EMPTY_DOFF_FORM, pieceCount: '1000' }).ok).toBe(true);
  });
  it('sayaç boş serbest; negatif/kesirli red', () => {
    expect(validateDoffForm({ ...EMPTY_DOFF_FORM, pieceCount: '2', counter: '' }).ok).toBe(true);
    expect(validateDoffForm({ ...EMPTY_DOFF_FORM, pieceCount: '2', counter: '-1' }).ok).toBe(false);
    expect(validateDoffForm({ ...EMPTY_DOFF_FORM, pieceCount: '2', counter: '12.5' }).ok).toBe(false);
    expect(validateDoffForm({ ...EMPTY_DOFF_FORM, pieceCount: '2', counter: '0' }).ok).toBe(true);
  });
});

describe('buildDoffPayload — openSchema birebir', () => {
  it('⭐ sayaç boşken counterAtDoff null ve kaynak yine BEYAN edilir (OPERATOR)', () => {
    const p = buildDoffPayload({ ...EMPTY_DOFF_FORM, pieceCount: '3', counterSource: 'MACHINE' }, ctx);
    expect(p.counterAtDoff).toBeNull();
    expect(p.counterSource).toBe('OPERATOR');
    expect(p.machineRunId).toBeNull();
    expect(p.notes).toBeNull();
    expect(p.doffedAt).toBe(ctx.pressedAtIso);
    expect(p.clientToken).toBe('tok');
    expect(p.productionLineNo).toBe(2);
  });
  it('⭐ simüle cihazdan okunan sayaç SIMULATED beyanıyla gider', () => {
    const p = buildDoffPayload({ ...EMPTY_DOFF_FORM, pieceCount: '3', counter: '1200', counterSource: 'SIMULATED' }, ctx);
    expect(p.counterAtDoff).toBe(1200);
    expect(p.counterSource).toBe('SIMULATED');
  });
  it('cihazdan okunan → MACHINE; koşum seçildiyse bağ gider; not trim', () => {
    const p = buildDoffPayload({ pieceCount: '1', counter: '77', counterSource: 'MACHINE', machineRunId: 'r1', notes: '  bitti  ' }, ctx);
    expect(p.counterSource).toBe('MACHINE');
    expect(p.machineRunId).toBe('r1');
    expect(p.notes).toBe('bitti');
  });
});

describe('classifyDoffFailure — 409 kodları ekran eylemine', () => {
  it('koşum uyuşmazlığı / geri alınmış koşum → koşum listesini tazele', () => {
    expect(classifyDoffFailure({ details: { code: 'DOFF_RUN_MISMATCH' } }, 'x').kind).toBe('refresh-runs');
    expect(classifyDoffFailure({ details: { code: 'RUN_REVOKED' } }, 'x').kind).toBe('refresh-runs');
  });
  it('token çakışması → modal (toast değil)', () => {
    expect(classifyDoffFailure({ details: { code: 'CLIENT_TOKEN_COLLISION' } }, 'x').kind).toBe('token-collision');
  });
  it('⭐ DOFF_HAS_ROLLS → barkodlar ADIYLA ve toplam (sayı ham listeden değil details.total)', () => {
    const a = classifyDoffFailure({ message: 'Bu indirmeden 3 top doğmuş', details: { code: 'DOFF_HAS_ROLLS', barcodes: ['A', 'B'], total: 3 } }, 'x');
    expect(a.kind).toBe('has-rolls');
    if (a.kind === 'has-rolls') {
      expect(a.barcodes).toEqual(['A', 'B']);
      expect(a.total).toBe(3);
      expect(a.message).toContain('doğmuş');
    }
  });
  it('kodsuz hata → düz mesaj; boş mesaj → fallback', () => {
    expect(classifyDoffFailure(new Error('Sunucuya ulaşılamıyor'), 'x')).toEqual({ kind: 'plain', message: 'Sunucuya ulaşılamıyor' });
    expect(classifyDoffFailure({}, 'Kayıt gitmedi').message).toBe('Kayıt gitmedi');
  });
});

describe('doffResultFeedback — kod büyük, replay ayrı cümle', () => {
  it('yeni kayıt', () => {
    expect(doffResultFeedback('DF1409260001', 'İndirme kaydedildi (DF1409260001)')).toEqual({ title: 'DF1409260001', subtitle: 'İndirme kaydedildi' });
  });
  it('⭐ replay cümlesi "zaten" içerir', () => {
    expect(doffResultFeedback('DF1', 'İndirme zaten kayıtlı').subtitle).toMatch(/zaten/);
  });
});
