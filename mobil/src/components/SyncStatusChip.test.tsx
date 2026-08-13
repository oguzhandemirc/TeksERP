// =============================================================================
// Bekçi: SyncStatusChip — bağlantı DURUMU rozeti (iş istemez, dokunulamaz)
// =============================================================================
// 2026-08-12'ye kadar bu rozet bir "ölü mektup kutusu"nun girişiydi ve kırmızı
// "N KAYIT GİTMEDİ" basıyordu. Kutu kaldırıldı; rozet yalnız durum bildirir.
// Kilitlenen sözleşme:
//   • tam senkronda HİÇ render edilmez (gürültü yok),
//   • çevrimdışı sebebi AYRI cümledir (wifi mi, sunucu mu — farklı iş),
//   • rozet DOKUNULAMAZ ve "KAYIT GİTMEDİ" ARTIK BASMAZ (regresyon zemini:
//     kutu geri sızarsa bu test kırmızı verir).
// =============================================================================

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { PaperProvider } from 'react-native-paper';
import SyncStatusChip from './SyncStatusChip';
import { queryClient } from '../offline/queryClient';
import {
  __resetOnlineSignalForTests,
  reportServerUnreachable,
} from '../offline/serverReachability';

/** `usePendingStationOps` (useMutationState) provider ister; Paper de tema ister. */
function renderChip() {
  return render(
    <QueryClientProvider client={queryClient}>
      <PaperProvider>
        <SyncStatusChip />
      </PaperProvider>
    </QueryClientProvider>,
  );
}

// Reanimated ağırlığından kaçın — bu testin konusu görünürlük mantığı.
jest.mock('./motion/Pulse', () => 'Pulse');

beforeEach(() => {
  __resetOnlineSignalForTests();
  onlineManager.setOnline(true);
});

describe('SyncStatusChip', () => {
  it('tam senkronda (online + 0 bekleyen) HİÇ render edilmez', () => {
    renderChip();
    expect(screen.queryByText(/sync|Çevrimdışı|ULAŞILAMIYOR/)).toBeNull();
  });

  it('ağ linki yokken "Çevrimdışı" der', () => {
    onlineManager.setOnline(false);
    renderChip();
    expect(screen.getByText('Çevrimdışı')).toBeTruthy();
  });

  it('sunucuya ulaşılamıyorsa SEBEBİ ayrı cümleyle söyler', () => {
    // İki durum farklı İŞ demek: wifi'yi operatör düzeltir, ölü sunucuyu IT.
    // ⚠️ Bu dalı kurmak ZORUNLU — `setOnline(false)` yalnız link dalını çalıştırır
    // ve sunucu dalı test edilmeden kalırsa oraya sızan bir metin görülmez
    // (negatif sonda ilk yazımda tam bu yüzden yeşil kaldı).
    reportServerUnreachable();
    onlineManager.setOnline(false);
    renderChip();
    expect(screen.getByText('SUNUCUYA ULAŞILAMIYOR')).toBeTruthy();
  });

  it('⭐ "KAYIT GİTMEDİ" ARTIK BASILMAZ — ölü mektup kutusu kaldırıldı (her iki dalda)', () => {
    // Regresyon zemini: kutu (ya da onun metni) geri sızarsa burada yakalanır.
    // Kaldırılma gerekçesi SyncStatusChip.tsx ve announceFailure.ts başlıklarında.
    onlineManager.setOnline(false);
    const linkOnly = renderChip();
    expect(screen.queryByText(/GİTMEDİ|HATALI/)).toBeNull();
    linkOnly.unmount();

    reportServerUnreachable();
    renderChip();
    expect(screen.queryByText(/GİTMEDİ|HATALI/)).toBeNull();
  });

  it('rozet DOKUNULABİLİR DEĞİL — açacağı bir yüzey yok', () => {
    onlineManager.setOnline(false);
    renderChip();
    // Rozet bir düğme gibi davranmamalı: dokunmayı vaat edip hiçbir şey
    // yapmamak, kutu dönemindeki "dokun → karar ver" alışkanlığını sürdürürdü.
    // `queryByRole` YETMEZ (sarmalayıcı Animated.View'da rol yakalanmıyor —
    // ölçüldü); gerçek regresyon bir Touchable EKLEMEKtir, o yüzden basılabilir
    // düğüm sayısına bakılır.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.UNSAFE_queryAllByProps({ onPress: expect.anything() })).toHaveLength(0);
  });
});
