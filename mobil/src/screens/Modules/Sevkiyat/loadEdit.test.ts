// Bekçi: planlı sevkiyat yük düzenleme saf kararları (9.1–9.3) — yük türü sevkiyattan, çıkarma onayı son topu söyler,
// önizleme satırı "IE · N/M top · K top eksik" + boyahane belge no.
import { addKindOf, addScanTitle, removeConfirmText, sourceDocText, workOrderLine } from './loadEdit';

describe('Yük Ekle — tür sevkiyatın içeriğinden', () => {
  it('dökme → BULK, araba → CART, çuval/eski sunucu → SACK', () => {
    expect(addKindOf({ bulkCount: 1, cartCount: 0 })).toBe('BULK');
    expect(addKindOf({ bulkCount: 0, cartCount: 2 })).toBe('CART');
    expect(addKindOf({})).toBe('SACK');
    expect(addScanTitle('CART', 'A-7')).toBe('Araba A-7 — top okut');
  });
});

describe('Top çıkar onayı', () => {
  const a = { shipmentId: 's', rollId: 'r', barcode: 'T-1', unitTitle: 'Araba A-7', last: false };
  it('son top birimin düşeceğini söyler', () => {
    expect(removeConfirmText({ ...a, last: true })).toMatch(/Araba A-7 sevkiyattan düşer/);
    expect(removeConfirmText(a)).toMatch(/rafa döner/);
    expect(removeConfirmText(a)).not.toMatch(/düşer/);
  });
});

describe('Sevk önizlemesi satırı', () => {
  const w = { workOrderId: 'w', workOrderNo: 'IE-1', inLoad: 38, inLoadMeters: 4200, total: 40, shippedElsewhere: 0, remaining: 2, remainingInProcess: 1, sourceDocs: [{ noteNo: 'GB-5', senderDocNo: '778' }] };
  it('eksik ve belge', () => {
    expect(workOrderLine(w)).toBe('IE-1 · 38/40 top · 4.200 m · 2 top eksik');
    expect(workOrderLine({ ...w, inLoad: 40, remaining: 0 })).toBe('IE-1 · 40/40 top · 4.200 m · tamam');
    expect(sourceDocText(w)).toBe('GB-5 (boyahane 778)');
    expect(sourceDocText({ ...w, sourceDocs: [] })).toBeNull();
  });
});
