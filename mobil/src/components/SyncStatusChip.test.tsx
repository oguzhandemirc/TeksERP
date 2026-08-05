// =============================================================================
// Bekçi: SyncStatusChip — ölü mektup kutusunun TEK görünür girişi
// =============================================================================
// Kutu (failedOps) doğru çalışsa bile operatör onu GÖREMİYORSA kayıt fiilen
// kayıptır. Bu bekçi görünürlük sözleşmesini kilitler:
//   • tam senkronda çip hiç render EDİLMEZ (gürültü yok)
//   • hatalı kayıt varsa çip görünür ve "KAYIT" der (yazıcı çipiyle karışmasın)
//   • çip DOKUNULABİLİR (kutuyu açan tek yol)
// =============================================================================

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { PaperProvider } from 'react-native-paper';
import SyncStatusChip from './SyncStatusChip';
import { useFailedOps } from '../offline/failedOps';
import { queryClient } from '../offline/queryClient';

/** `usePendingStationOps` (useMutationState) provider ister; Paper de tema ister. */
function renderChip(props: Parameters<typeof SyncStatusChip>[0] = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <PaperProvider>
        <SyncStatusChip {...props} />
      </PaperProvider>
    </QueryClientProvider>,
  );
}

// Reanimated/Portal ağırlığından kaçın — bu testin konusu görünürlük mantığı.
jest.mock('./motion/Pulse', () => 'Pulse');
jest.mock('./outbox/OutboxModal', () => {
  const { Text } = require('react-native');
  return ({ visible }: { visible: boolean }) =>
    visible ? <Text>OUTBOX_ACIK</Text> : null;
});

beforeEach(() => {
  useFailedOps.setState({ rows: [], hydrated: true });
  onlineManager.setOnline(true);
});

const failedRow = {
  id: 'op-1',
  key: ['station', 'kk1-create-entry'] as const,
  variables: { itemId: 'x', initialQty: 140 },
  message: 'Bu top az önce girilmiş olabilir',
  status: 409,
  code: 'POSSIBLE_DUPLICATE',
  barcode: 'T050826H0001',
  failedAt: Date.now(),
};

describe('SyncStatusChip', () => {
  it('tam senkronda (online + 0 bekleyen + 0 hatalı) HİÇ render edilmez', () => {
    renderChip();
    expect(screen.queryByText(/sync|Çevrimdışı|GİTMEDİ/)).toBeNull();
  });

  it('⭐ hatalı kayıt varsa "N KAYIT GİTMEDİ" görünür', () => {
    useFailedOps.setState({ rows: [failedRow], hydrated: true });
    renderChip();
    // "GİTMEDİ" LOAD-BEARING: saha personeli "HATALI" kelimesini "kayıt yanlış
    // girilmiş" diye okuyor; anlatılan ise "sisteme ULAŞMADI". Ayrıca KK1in
    // yazıcı çipi "N ETİKET HATALI" diyor ve ikisi aynı headerda yan yana.
    expect(screen.getByText('1 KAYIT GİTMEDİ')).toBeTruthy();
  });

  it('çipe dokununca kutu açılır (kaydın tek çıkış yolu)', () => {
    useFailedOps.setState({ rows: [failedRow], hydrated: true });
    renderChip();
    expect(screen.queryByText('OUTBOX_ACIK')).toBeNull();
    fireEvent.press(screen.getByText('1 KAYIT GİTMEDİ'));
    expect(screen.getByText('OUTBOX_ACIK')).toBeTruthy();
  });

  it('çevrimdışı ama hatasızken eski davranış korunur', () => {
    onlineManager.setOnline(false);
    renderChip();
    expect(screen.getByText('Çevrimdışı')).toBeTruthy();
  });
});
