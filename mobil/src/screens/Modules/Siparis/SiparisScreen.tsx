import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ScreenChrome from '../../../components/ScreenChrome';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { colors, spacing, radius } from '../../../theme';
import type { Order } from '../../../types/models';
import OrderListView from './OrderListView';
import OrderDetailSheet from './OrderDetailSheet';
import NewOrderView, { NEW_ORDER_STEP_TITLES } from './NewOrderView';

// =============================================================================
// SİPARİŞ — liste + "Yeni Sipariş" sihirbazı (Hızlı İş Emri ile aynı kabuk).
//
// Sevkiyat altındaki "Hızlı Sipariş" ekranının TERSİ: orada elde duran toplar
// geriye dönük siparişe çevrilir; burada henüz üretilmemiş bir müşteri talebi
// açılır ve mevcut talepler izlenir. İkisi ayrı ekran olarak durur.
//
// Oturum (yer onayı) İSTEMEZ: bu bir istasyon ekranı değil, satış/planlama
// ekranıdır — `constants/stationScreens.ts` registry'sine EKLENMEZ.
//
// İzin `mobile:siparis`: OKUR + YARATIR. Düzenleme/iptal/silme YOK (bkz.
// Teks-Erp/scripts/test_mobile_order_permission.ts) — bu yüzden ne listede ne
// detayda bir mutasyon aksiyonu var.
// =============================================================================

type ViewMode = 'list' | 'new';

export default function SiparisScreen() {
  usePortraitLock(useDeviceType() === 'phone');
  const insets = useSafeAreaInsets();

  const [view, setView] = useState<ViewMode>('list');
  const [detail, setDetail] = useState<Order | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Sihirbaz adımı KABUKTA tutulur ki Appbar geri tuşu bir adım geri gitsin,
  // yalnız ilk adımda listeye dönsün.
  const [step, setStep] = useState(0);

  return (
    <ScreenChrome
      title="Sipariş"
      subtitle={view === 'new' ? 'Yeni müşteri siparişi' : 'Sipariş listesi'}
      onStepBack={
        view === 'new'
          ? () => {
              if (step > 0) {
                setStep((s) => s - 1);
                return;
              }
              setView('list');
            }
          : undefined
      }
    >
      <View style={styles.root}>
        {view === 'new' ? (
          <NewOrderView
            step={step}
            onStepChange={setStep}
            onCreated={() => setRefreshKey((k) => k + 1)}
            onBackToList={() => {
              setStep(0);
              setView('list');
            }}
          />
        ) : (
          <>
            <View style={styles.listWrap}>
              <OrderListView onOpen={setDetail} refreshKey={refreshKey} />
            </View>

            {/* Alt aksiyon çubuğu — Hızlı İş Emri / Kartela Sevk standardı. */}
            <View style={[styles.bottomBar, { paddingBottom: insets.bottom, marginBottom: -insets.bottom }]}>
              <View style={styles.barContent}>
                <TouchableRipple
                  onPress={() => {
                    setStep(0);
                    setView('new');
                  }}
                  style={styles.newBtn}
                  rippleColor="rgba(255,255,255,0.25)"
                  accessibilityLabel="Yeni sipariş"
                >
                  <View style={styles.newBtnInner}>
                    <Icon source="plus-circle" size={26} color="#fff" />
                    <Text style={styles.newBtnText}>Yeni Sipariş</Text>
                  </View>
                </TouchableRipple>
              </View>
            </View>
          </>
        )}
      </View>

      <OrderDetailSheet order={detail} onClose={() => setDetail(null)} />
    </ScreenChrome>
  );
}

// Kabuk dışından adım sayısını bilmek isteyen olursa tek kaynak burada değil,
// NewOrderView'da — yeniden dışa aktarmak iki kaynak yaratırdı.
export { NEW_ORDER_STEP_TITLES };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  listWrap: { flex: 1 },
  bottomBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: -2 },
    shadowRadius: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  barContent: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  newBtn: { borderRadius: radius.md, backgroundColor: '#0d9488', overflow: 'hidden' },
  // 56dp dokunma hedefi.
  newBtnInner: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  newBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
