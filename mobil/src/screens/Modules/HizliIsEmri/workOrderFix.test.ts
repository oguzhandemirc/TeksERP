import { colorSaveGate, detachResultMessage, parseWidth, reasonPayload, reasonReady, tabletCancelAllowed } from './workOrderFix';
import type { ReasonPreset } from '../../../services/reasonPreset.service';

const preset = (code: string, label: string, fullText: string | null, requiresText = false): ReasonPreset => ({
  id: code, kind: 'WORK_ORDER_PLAN_CHANGE', code, label, fullText, requiresText, sortOrder: 0, isActive: true, isSystem: true,
});
const PRESETS = [
  preset('MUSTERI_DEGISTIRDI', 'Müşteri değiştirdi', 'Müşteri isteği değiştirdi'),
  preset('DIGER', 'Diğer', null, true),
];

describe('reasonPayload', () => {
  it('chip seçimi: katalog satırının tam metni + kod', () => {
    expect(reasonPayload({ code: 'MUSTERI_DEGISTIRDI', text: '' }, PRESETS)).toEqual({
      reason: 'Müşteri isteği değiştirdi', reasonCode: 'MUSTERI_DEGISTIRDI',
    });
  });
  it('serbest metin: yazılan metin + seçicinin kodu', () => {
    expect(reasonPayload({ code: 'DIGER', text: '  kumaş farklı geldi ' }, PRESETS)).toEqual({
      reason: 'kumaş farklı geldi', reasonCode: 'DIGER',
    });
  });
  it('hiç seçim yok → boş sebep, kaydedilemez', () => {
    expect(reasonReady({ code: null, text: '' }, PRESETS)).toBe(false);
    expect(reasonReady({ code: null, text: 'ab' }, PRESETS)).toBe(false);
    expect(reasonReady({ code: 'MUSTERI_DEGISTIRDI', text: '' }, PRESETS)).toBe(true);
  });
});

describe('colorSaveGate', () => {
  const base = { blocked: null, partial: null, warnings: [], cardWillBeStale: false };
  it('önizleme yokken ya da engelde kaydedilmez', () => {
    expect(colorSaveGate(undefined, false).canSave).toBe(false);
    expect(colorSaveGate({ ...base, blocked: { code: 'COLOR_DYED_BLOCKED', message: 'x' } }, true).canSave).toBe(false);
  });
  it('kısmi boyada onay ister, onaylanınca kaydedilir', () => {
    const p = { ...base, partial: { dyedCount: 2, pendingCount: 3 } };
    expect(colorSaveGate(p, false)).toEqual({ canSave: false, needsConfirm: true });
    expect(colorSaveGate(p, true)).toEqual({ canSave: true, needsConfirm: true });
  });
  it('engelsiz, kısmisiz: doğrudan kaydedilir', () => {
    expect(colorSaveGate(base, false)).toEqual({ canSave: true, needsConfirm: false });
  });
});

describe('parseWidth', () => {
  it('boş = temizle, virgül ondalık, aralık dışı geçersiz', () => {
    expect(parseWidth('')).toBeNull();
    expect(parseWidth('182,5')).toBe(182.5);
    expect(parseWidth('0')).toBeUndefined();
    expect(parseWidth('1200')).toBeUndefined();
    expect(parseWidth('abc')).toBeUndefined();
  });
});

describe('tabletCancelAllowed', () => {
  it('panel yetkisi her durumda; tablet yalnız hiç işlem görmemiş iş emrinde', () => {
    expect(tabletCancelAllowed({ status: 'IN_PROGRESS' }, true)).toBe(true);
    expect(tabletCancelAllowed({ status: 'PLANNED', locks: { materialCommitted: false } }, false)).toBe(true);
    expect(tabletCancelAllowed({ status: 'PLANNED', locks: { materialCommitted: true } }, false)).toBe(false);
    expect(tabletCancelAllowed({ status: 'IN_PROGRESS', locks: { materialCommitted: false } }, false)).toBe(false);
  });
});

describe('detachResultMessage', () => {
  it('hepsi çıktı: başarı; iş emri boşaldıysa söyler', () => {
    expect(detachResultMessage(2, [], true)).toEqual({ type: 'success', text: "2 top iş emrinden çıkarıldı · iş emrinde top kalmadı, Planlandı'ya döndü" });
  });
  it('kısmi: hata türü, ilk sebep yazılır', () => {
    const m = detachResultMessage(1, ['Bu top işlem gördü (kesildi)', 'x'], false);
    expect(m.type).toBe('error');
    expect(m.text).toBe('1 top iş emrinden çıkarıldı · 2 top çıkarılamadı: Bu top işlem gördü (kesildi)');
  });
});
