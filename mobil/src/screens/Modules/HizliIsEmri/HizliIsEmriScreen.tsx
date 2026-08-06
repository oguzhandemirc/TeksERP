import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ScreenChrome from '../../../components/ScreenChrome';
import NewWorkOrderView from './NewWorkOrderView';
import WorkOrderListView from './WorkOrderListView';
import WorkOrderDetailSheet from './WorkOrderDetailSheet';
import { colors, spacing, radius } from '../../../theme';

type View2 = 'list' | 'new';

export default function HizliIsEmriScreen() {
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<View2>('list');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Sihirbaz adımı kabukta tutulur: Appbar geri tuşu bir ADIM geri gitsin,
  // yalnız ilk adımda listeye dönsün (native geri hareketiyle aynı beklenti).
  const [step, setStep] = useState(0);
  // Sihirbaz başarı ekranında mı (bkz. NewWorkOrderView.onResultChange).
  const [hasResult, setHasResult] = useState(false);
  // Bu sihirbaz oturumunda en az bir iş emri açıldı mı → listeye dönüşte tazele.
  const [listDirty, setListDirty] = useState(false);

  /**
   * Listeye dön. İş emri açıldıysa liste TAZELENİR ve BAŞA sarılır: yeni kayıt
   * en üstteki satırdır ve operatörün ilk baktığı yer orasıdır. Sorgu 30 sn
   * `staleTime` taşıdığı için remount tek başına tazelemeyi garanti etmez —
   * `refreshKey` sorgu anahtarını değiştirerek bunu kesinleştirir.
   */
  const goToList = useCallback((refresh: boolean) => {
    if (refresh) setRefreshKey((k) => k + 1);
    setListDirty(false);
    setHasResult(false);
    setStep(0);
    setView('list');
  }, []);

  const handleResultChange = useCallback((v: boolean) => {
    setHasResult(v);
    // "Yeni İş Emri"ne basılıp sonuç ekranı kapansa da tazeleme borcu KALIR —
    // aksi halde iş emri açıp sonra vazgeçen operatör bayat listeye dönerdi.
    if (v) setListDirty(true);
  }, []);

  return (
    <ScreenChrome
      title="Hızlı İş Emri"
      onStepBack={
        view === 'new'
          ? () => {
              // Sonuç ekranında geri = LİSTE. Adımlara geri saymak, biten bir
              // işin formunu yeniden açar ve üç dokunuş ister.
              if (hasResult) {
                goToList(true);
                return;
              }
              if (step > 0) {
                setStep((s) => s - 1);
                return;
              }
              goToList(listDirty);
            }
          : undefined
      }
    >
      <View style={styles.root}>
        {view === 'new' ? (
          <NewWorkOrderView
            step={step}
            onStepChange={setStep}
            onResultChange={handleResultChange}
          />
        ) : (
          <>
            <View style={styles.listWrap}>
              <WorkOrderListView onOpen={setDetailId} refreshKey={refreshKey} />
            </View>

            {/* Alt aksiyon çubuğu — KartelaSevk standardı: belirgin dolgulu primary. */}
            <View style={[styles.bottomBar, { paddingBottom: insets.bottom, marginBottom: -insets.bottom }]}>
              <View style={styles.barContent}>
                <TouchableRipple
                  onPress={() => {
                    setStep(0);
                    setView('new');
                  }}
                  style={styles.newBtn}
                  rippleColor="rgba(255,255,255,0.25)"
                  accessibilityLabel="Yeni iş emri"
                >
                  <View style={styles.newBtnInner}>
                    <Icon source="plus-circle" size={26} color="#fff" />
                    <Text style={styles.newBtnText}>Yeni İş Emri</Text>
                  </View>
                </TouchableRipple>
              </View>
            </View>
          </>
        )}
      </View>

      <WorkOrderDetailSheet
        workOrderId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={() => setRefreshKey((k) => k + 1)}
      />
    </ScreenChrome>
  );
}

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
  newBtn: {
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  newBtnInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  newBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
