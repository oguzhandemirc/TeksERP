// İstek ritmi: uçuşta TEK istek, en sık ~1/sn; yanıt/hata uçuşu bitirir. Otomatik çekim: kilit + sabit + net, halka
// süresi boyunca kesintisiz.
import * as fs from 'fs';
import * as path from 'path';
import { IDLE_RHYTHM, canSend, markSent, markSettled, readyToCapture, stepHold } from './liveRhythm';
import { LIVE_HOLD_MS, LIVE_MIN_SHARPNESS, LIVE_REQUEST_INTERVAL_MS } from './liveTuning';

describe('liveRhythm', () => {
  it('⭐ uçuşta istek varken süre dolsa da yenisi çıkmaz', () => {
    const s = markSent(IDLE_RHYTHM, 1000);
    expect(canSend(s, 1000 + LIVE_REQUEST_INTERVAL_MS * 10)).toBe(false);
    expect(canSend(markSettled(s), 1000 + LIVE_REQUEST_INTERVAL_MS)).toBe(true);
  });

  it('yanıt erken gelse de aralık dolmadan istek çıkmaz', () => {
    const s = markSettled(markSent(IDLE_RHYTHM, 1000));
    expect(canSend(s, 1000 + LIVE_REQUEST_INTERVAL_MS - 1)).toBe(false);
    expect(canSend(IDLE_RHYTHM, 0)).toBe(true);
  });

  it('readyToCapture: üç koşul birden', () => {
    const good = { still: true, sharpness: LIVE_MIN_SHARPNESS };
    expect(readyToCapture(true, good)).toBe(true);
    expect(readyToCapture(false, good)).toBe(false);
    expect(readyToCapture(true, { ...good, still: false })).toBe(false);
    expect(readyToCapture(true, { still: true, sharpness: LIVE_MIN_SHARPNESS - 0.01 })).toBe(false);
    expect(readyToCapture(true, null)).toBe(false);
  });

  it('halka: süre dolunca fire; koşul koparsa sıfırlanır', () => {
    let r = stepHold({ since: null }, true, 100);
    expect(r).toMatchObject({ progress: 0, fire: false });
    r = stepHold(r.hold, true, 100 + LIVE_HOLD_MS / 2);
    expect(r.progress).toBeCloseTo(0.5);
    expect(stepHold(r.hold, false, 100 + LIVE_HOLD_MS).hold.since).toBeNull();
    expect(stepHold(r.hold, true, 100 + LIVE_HOLD_MS).fire).toBe(true);
  });

  it('bekçi: LiveTuning.kt netlik eşiği tanımlarsa JS sabitiyle aynı olmalı', () => {
    const kt = fs.readFileSync(
      path.join(__dirname, '../../../../../modules/teks-erp-belge-tarayici/android/src/main/java/com/tekserp/belgetarayici/LiveTuning.kt'),
      'utf8',
    );
    expect(kt).toMatch(/SHARPNESS_STEP/);
    const m = kt.match(/MIN_SHARPNESS\s*=\s*([\d.]+)/);
    if (m) expect(Number(m[1])).toBe(LIVE_MIN_SHARPNESS);
  });
});
