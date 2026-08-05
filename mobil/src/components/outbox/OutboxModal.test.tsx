// =============================================================================
// Bekçi: OutboxModal — operatörün SONUCU okuyabildiği metin/renk sözleşmesi
// =============================================================================
// Buradaki iddia "modal render oluyor mu" DEĞİL. Kutu, eldivenli bir operatörün
// vardiya ortasında karar vereceği tek yer; iki tuzağa karşı kilitleniyor:
//
//   1. Buton etiketi SONUCU söylemeli, işlemi değil. "Tekrar Gönder" ile
//      "AYRI TOP — Yine de Kaydet" farklı şeyler yapar: biri aynı kaydı yeniden
//      dener, diğeri STOKTA YENİ BİR TOP DOĞURUR. Etiketler eşitlenirse
//      (ör. ikisi de "Gönder") operatör yanlış olanı seçer ve fark etmez.
//   2. Renk de sonucu söylemeli: yeni kayıt doğuran buton, nötr/marka renginde
//      OLAMAZ — metni okumadan ayırt edilebilmeli.
// =============================================================================

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { PaperProvider } from 'react-native-paper';
import OutboxModal from './OutboxModal';
import { useFailedOps, type FailedOp } from '../../offline/failedOps';
import { queryClient } from '../../offline/queryClient';
import { colors } from '../../theme';

const base: FailedOp = {
  id: 'op-1',
  key: ['station', 'kk1-create-entry'],
  variables: { itemId: 'x', initialQty: 140, width: 150 },
  message: 'Bu top az önce girilmiş olabilir',
  status: 409,
  code: 'POSSIBLE_DUPLICATE',
  barcode: 'T050826H0001',
  failedAt: Date.now(),
};

function show(row: FailedOp) {
  useFailedOps.setState({ rows: [row], hydrated: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaperProvider>
        <OutboxModal visible onDismiss={() => {}} online onPrintBarcode={() => {}} />
      </PaperProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => useFailedOps.setState({ rows: [], hydrated: true }));

describe('OutboxModal — operatöre ne olduğunu ve ne yapacağını söyler', () => {
  it('⭐ uyarı bandı "ULAŞMADI / kaydı YOK" der (belirsiz "hata" demez)', () => {
    show(base);
    expect(screen.getByText(/ULAŞMADI/)).toBeTruthy();
    expect(screen.getByText(/kaydı YOK/)).toBeTruthy();
  });

  it('⭐ mükerrer şüphesinde SORUYU sorar (operatör neye karar verecek)', () => {
    show(base);
    expect(screen.getByText(/AYNI mı, yoksa ikinci bir top mu\?/)).toBeTruthy();
  });

  it('⭐ butonlar SONUCU söyler ve birbirinden ayrıdır', () => {
    show(base);
    // Yeni stok kaydı doğuran buton — "gönder/devam" gibi nötr bir söz DEĞİL.
    expect(screen.getByText('AYRI TOP — Yine de Kaydet')).toBeTruthy();
    // Veriye dokunmayan, yalnız kâğıt basan buton.
    expect(screen.getByText('Var Olanın Etiketini Bas')).toBeTruthy();
    // Kaydı yok eden buton — "Sil" tek başına ne kaybedildiğini söylemiyordu.
    expect(screen.getByText('Vazgeç, Sil')).toBeTruthy();
    // "Tekrar Gönder" mükerrer vakasında ÇIKMAMALI: orada aynı kaydı yeniden
    // denemek 409'u tekrar üretir, operatörü döngüye sokar.
    expect(screen.queryByText('Tekrar Gönder')).toBeNull();
  });

  it('mükerrer OLMAYAN hatada "Tekrar Gönder" çıkar, "AYRI TOP" çıkmaz', () => {
    show({ ...base, code: undefined, status: undefined, message: 'Ağ hatası' });
    expect(screen.getByText('Tekrar Gönder')).toBeTruthy();
    expect(screen.queryByText('AYRI TOP — Yine de Kaydet')).toBeNull();
    expect(screen.getByText(/Top hâlâ elindeyse tekrar gönder/)).toBeTruthy();
  });

  it('⭐ RENK AYRIMI: yeni kayıt doğuran buton, tekrar-dene ile AYNI renkte değil', () => {
    // Mükerrer vakası → AMBER (dikkat: yeni stok kaydı doğuruyor)
    show(base);
    expect(screen.UNSAFE_queryAllByProps({ buttonColor: colors.warningDark })).not.toHaveLength(0);
    expect(screen.UNSAFE_queryAllByProps({ buttonColor: colors.brand })).toHaveLength(0);
    screen.unmount();

    // Sıradan hata → MARKA rengi (aynı işi tekrar dener, yeni kayıt doğurmaz)
    show({ ...base, code: undefined, status: undefined, message: 'Ağ hatası' });
    expect(screen.UNSAFE_queryAllByProps({ buttonColor: colors.brand })).not.toHaveLength(0);
    expect(screen.UNSAFE_queryAllByProps({ buttonColor: colors.warningDark })).toHaveLength(0);

    // Sözleşmenin kalbi: iki rol AYNI renge çekilirse operatör metni okumadan
    // ayırt edemez — token'lar eşitlenirse bu satır düşer.
    expect(colors.warningDark).not.toBe(colors.brand);
  });

  it('çevrimdışıyken etiket butonu kapalı ve SEBEBİ yazılı', () => {
    useFailedOps.setState({ rows: [base], hydrated: true });
    render(
      <QueryClientProvider client={queryClient}>
        <PaperProvider>
          <OutboxModal visible onDismiss={() => {}} online={false} onPrintBarcode={() => {}} />
        </PaperProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/ağ bağlantısı gerekir/)).toBeTruthy();
  });
});
