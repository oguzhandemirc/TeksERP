/**
 * BEKÇİ — Hızlı İş Emri okutma kararı (2026-08-25).
 *
 * Bu dosyanın var olma sebebi tek bir satır: `if (roll.status !== 'STOCK') reject`.
 * Backend 2026'dan beri `STOCK / WAREHOUSE / A1_STOCK` kabul ediyordu ("her işlem
 * final üretir"), ama tablet bitmiş topu okutmaya bırakmıyordu → "bitmiş kumaşı
 * tekrar boyahaneye gönder" akışı sahada HİÇ kullanılamadı (ölçüm: 980 topun 4'ü
 * iki iş emrinden geçmiş, dördü de ham top).
 *
 * ⚠️ Kabul listesi backend `quickStart.attachable` ile BİREBİR olmalı; ayrışırsa
 * tablet kabul eder, sunucu 400 verir (ya da tersi — özellik sessizce kapalı kalır).
 */
import { classifyScannedRoll, isReworkStatus, ATTACHABLE_STATUSES } from './scanClassify';

const roll = (over: Record<string, unknown> = {}) =>
  ({ status: 'STOCK', itemId: 'i1', sackId: null, shipmentId: null, ...over }) as never;

describe('classifyScannedRoll', () => {
  it('⭐ Tükenene kadar kartın topu AKAR (sınıf E); Pasif kartın topu okutma anında RED ve çıkış yolunu söyler', () => {
    const item = (lifecycleStatus: string) => ({ id: 'i1', code: 'K', name: 'PATOS', lifecycleStatus });
    expect(classifyScannedRoll(roll({ item: item('PHASE_OUT') }), null)).toEqual({ kind: 'accept', status: 'STOCK' });
    expect(classifyScannedRoll(roll({ item: item('ARCHIVED') }), null)).toEqual({ kind: 'reject', reason: "Kartı Pasif — önce kartı 'Tükenene kadar'a alın" });
  });

  it('ham stok kabul', () => {
    expect(classifyScannedRoll(roll(), null)).toEqual({ kind: 'accept', status: 'STOCK' });
  });

  it('BİTMİŞ DEPO kabul — regresyon kilidi', () => {
    expect(classifyScannedRoll(roll({ status: 'WAREHOUSE' }), null)).toEqual({
      kind: 'accept',
      status: 'WAREHOUSE',
    });
  });

  it('2. KALİTE kabul (kullanıcı kararı: bitmiş depoyla aynı)', () => {
    expect(classifyScannedRoll(roll({ status: 'A1_STOCK' }), null)).toEqual({
      kind: 'accept',
      status: 'A1_STOCK',
    });
  });

  it('kabul listesi backend sözleşmesiyle birebir', () => {
    expect([...ATTACHABLE_STATUSES]).toEqual(['STOCK', 'WAREHOUSE', 'A1_STOCK']);
  });

  it('sevk edilmiş top RED — sebebi Türkçe ve statüyü söyler', () => {
    const d = classifyScannedRoll(roll({ status: 'SHIPPED' }), null);
    expect(d.kind).toBe('reject');
    expect(d.kind === 'reject' && d.reason).toMatch(/Stokta değil/);
  });

  it('fasondaki top RED', () => {
    expect(classifyScannedRoll(roll({ status: 'AT_SUBCONTRACTOR' }), null).kind).toBe('reject');
  });

  it('iptal edilmiş top DUVAR DEĞİL — teşhis paneli açılır (2026-08-05 dersi)', () => {
    expect(classifyScannedRoll(roll({ status: 'CANCELLED' }), null)).toEqual({ kind: 'cancelled' });
  });

  it('çuvaldaki BİTMİŞ top RED — backend 400 vermeden önce söylenir', () => {
    const d = classifyScannedRoll(roll({ status: 'WAREHOUSE', sackId: 's1' }), null);
    expect(d.kind).toBe('reject');
    expect(d.kind === 'reject' && d.reason).toMatch(/Çuvalda\/sevkiyatta/);
  });

  it('sevkiyata bağlı top RED', () => {
    expect(classifyScannedRoll(roll({ status: 'WAREHOUSE', shipmentId: 'sh1' }), null).kind).toBe(
      'reject',
    );
  });

  it('⚠️ SIRA: sevk edilmiş top "çuvaldan çıkarın" DEMEZ (yanlış yola sokar)', () => {
    // Statü kontrolü çuval kontrolünden ÖNCE gelmeli: SHIPPED bir topa "çuvaldan
    // çıkarın" demek, o malın müşteride olduğunu gizler.
    const d = classifyScannedRoll(roll({ status: 'SHIPPED', sackId: 's1' }), null);
    expect(d.kind === 'reject' && d.reason).toMatch(/Stokta değil/);
  });

  it('kumaş kilidi: farklı ürün RED, aynı ürün kabul', () => {
    expect(classifyScannedRoll(roll({ itemId: 'i2' }), 'i1').kind).toBe('reject');
    expect(classifyScannedRoll(roll({ itemId: 'i1' }), 'i1').kind).toBe('accept');
  });

  it('isReworkStatus: yalnız depo statüleri', () => {
    expect(isReworkStatus('WAREHOUSE')).toBe(true);
    expect(isReworkStatus('A1_STOCK')).toBe(true);
    expect(isReworkStatus('STOCK')).toBe(false);
  });
});
