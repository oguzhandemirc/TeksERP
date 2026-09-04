// =============================================================================
// Bekçi: onay ekranı kapısı (`shouldShowPairingGate`) — 2026-09-04 saha bulgusu
// =============================================================================
// Ölçülen arıza: `devicePairingRequired` KAPALIYKEN tablet "Cihaz Atama
// Bekliyor" ekranında kalıyordu. §1 tam o vakayı ölçer; naif
// `status !== 'APPROVED'` uygulamasında KIRMIZI verir (negatif sonda).
// =============================================================================

import { shouldShowPairingGate } from './pairingGate';

describe('shouldShowPairingGate', () => {
  it('§1 bayrak KAPALI + cihaz PENDING → kapı YOK (saha bulgusu)', () => {
    expect(
      shouldShowPairingGate({
        flagFromEndpoint: false,
        assignment: { pairingRequired: false, status: 'PENDING' },
      }),
    ).toBe(false);
  });

  it('§2 bayrak AÇIK + PENDING → kapı VAR', () => {
    expect(
      shouldShowPairingGate({
        flagFromEndpoint: true,
        assignment: { pairingRequired: true, status: 'PENDING' },
      }),
    ).toBe(true);
  });

  it('§3 bayrak AÇIK + APPROVED → kapı YOK', () => {
    expect(
      shouldShowPairingGate({
        flagFromEndpoint: true,
        assignment: { pairingRequired: true, status: 'APPROVED' },
      }),
    ).toBe(false);
  });

  it('§4 sunucu kararı bayat uç bayrağını EZER (uç true, cevap false)', () => {
    expect(
      shouldShowPairingGate({
        flagFromEndpoint: true,
        assignment: { pairingRequired: false, status: 'PENDING' },
      }),
    ).toBe(false);
  });

  it('§5 ezme İKİ YÖNLÜ (uç false, cevap true)', () => {
    expect(
      shouldShowPairingGate({
        flagFromEndpoint: false,
        assignment: { pairingRequired: true, status: 'PENDING' },
      }),
    ).toBe(true);
  });

  it('§6 cevap henüz yokken taban uç bayrağıdır (bayrak açık → kapı)', () => {
    expect(shouldShowPairingGate({ flagFromEndpoint: true })).toBe(true);
    expect(shouldShowPairingGate({ flagFromEndpoint: true, assignment: null })).toBe(true);
  });

  it('§7 cevap henüz yok + bayrak kapalı → kapı YOK (Login açılır)', () => {
    expect(shouldShowPairingGate({ flagFromEndpoint: false })).toBe(false);
  });

  it('§8 ESKİ backend (alan yok) → eski davranış birebir korunur', () => {
    // Alanı taşımayan cevap: karar uç bayrağına düşer, status'a değil.
    expect(shouldShowPairingGate({ flagFromEndpoint: true, assignment: { status: 'PENDING' } })).toBe(
      true,
    );
    expect(shouldShowPairingGate({ flagFromEndpoint: false, assignment: { status: 'PENDING' } })).toBe(
      false,
    );
    expect(shouldShowPairingGate({ flagFromEndpoint: true, assignment: { status: 'APPROVED' } })).toBe(
      false,
    );
  });

  it('§9 pasif/kayıtsız cihaz bayrak açıkken kapıda kalır', () => {
    expect(
      shouldShowPairingGate({
        flagFromEndpoint: true,
        assignment: { pairingRequired: true, status: 'INACTIVE' },
      }),
    ).toBe(true);
    expect(
      shouldShowPairingGate({
        flagFromEndpoint: true,
        assignment: { pairingRequired: true, status: 'UNKNOWN' },
      }),
    ).toBe(true);
  });
});
