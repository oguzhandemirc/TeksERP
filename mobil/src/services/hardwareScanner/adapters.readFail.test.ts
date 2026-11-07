// Point Mobile okuma zaman aşımında "READ_FAIL" sabitini VERİ olarak yollar (PM68, 2026-11-07 saha):
// okutma sayılırsa ekran "EKLENMEDİ · READ_FAIL" basar — operatöre ham kod ve sahte hata.
import type { NativeIntentEvent } from './native';
import { PM, pointMobileAdapter } from './adapters';

const ctx = { packageName: 'com.etkiliyazilim.tekserp' };
const b64 = (s: string) => Buffer.from(s, 'latin1').toString('base64');
const event = (value: string, sym: string): NativeIntentEvent => ({
  action: PM.EVENT,
  extras: {
    EXTRA_EVENT_DECODE_VALUE: { $bytes: b64(value) },
    EXTRA_EVENT_DECODE_LENGTH: value.length,
    EXTRA_EVENT_SYMBOL_NAME: sym,
  },
});

describe('Point Mobile READ_FAIL', () => {
  it('veri ya da semboloji READ_FAIL ise okutma üretmez', () => {
    expect(pointMobileAdapter.handleIntent(event('READ_FAIL', 'READ_FAIL'), ctx, {})).toBeNull();
    expect(pointMobileAdapter.handleIntent(event('READ_FAIL', ''), ctx, {})).toBeNull();
    expect(pointMobileAdapter.handleIntent(event('256800589', 'READ_FAIL'), ctx, {})).toBeNull();
  });
  it('gerçek okuma etkilenmez', () => {
    expect(pointMobileAdapter.handleIntent(event('256800589', 'Interleaved 2 of 5'), ctx, {})).toEqual({
      scan: { data: '256800589', symbology: 'Interleaved 2 of 5' },
    });
  });
});
