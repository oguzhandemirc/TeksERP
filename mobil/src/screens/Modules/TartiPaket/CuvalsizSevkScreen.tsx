import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ScreenChrome from '../../../components/ScreenChrome';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import type { MainStackParamList } from '../../../navigation/types';
import { CariHoldBlockedScreen } from '../Sevkiyat/CariHold';
import { DestinationLockRow } from './DestinationLockRow';
import { useCuvalsizSevk } from './useCuvalsizSevk';
import { totalMeters } from './looseLoad';
import { BottomBar, CartLabelModal, LoadList, LoadModePicker, LoadSummary, VehicleFields } from './CuvalsizSevkView';
import { LooseScanner } from './LooseScanner';
import { OrderPickRow } from './OrderPick';
import { useHardwareScanMode } from '../../../hooks/useScanMethod';

// =============================================================================
// Çuvalsız Sevk — toplar çuvala konmadan kamyon kasasına (dökme) ya da top taşıma
// arabasıyla gider. Paketleme'den (müşteri seçili) açılır; `shipping.looseLoadEnabled`
// kapalıyken giriş düğmesi görünmez. Sunucu görünmez yük birimini kendisi açar.
// =============================================================================
export default function CuvalsizSevkScreen() {
  const phone = useDeviceType() === 'phone';
  usePortraitLock(phone);
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'CuvalsizSevk'>>();
  const { customerId, customerName } = route.params;
  const branchId = route.params.branchId ?? null;
  const { width, height } = useWindowDimensions();
  const wide = width > height && width >= 900;

  const s = useCuvalsizSevk(customerId, branchId, () => nav.goBack());
  const [scanOpen, setScanOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  // El terminali: OKUT bandı hep görünür → ekran tuşu hep dinler (araba no yoksa ret: "Önce araba no girin").
  const hardware = useHardwareScanMode();

  const openScan = () => {
    if (s.mode === 'CART' && !s.activeCart) setCartOpen(true);
    else setScanOpen(true);
  };
  const recentCarts = s.groups.map((g) => g.label).filter((l) => l && l !== s.activeCart);

  const settings = (
    <>
      <LoadModePicker mode={s.mode} onMode={s.setMode} activeCart={s.activeCart} onOpenCart={() => setCartOpen(true)} />
      <View style={styles.destCard}>
        <DestinationLockRow lock={s.lock} picked={s.picked} onPick={s.setPicked} hasBranch={!!branchId} />
      </View>
      <OrderPickRow customerId={customerId} branchId={branchId} value={s.orderIds} onChange={s.setOrderIds} />
      <VehicleFields plateNumber={s.plateNumber} onPlate={s.setPlateNumber} driverName={s.driverName} onDriver={s.setDriverName} />
    </>
  );
  const list = (
    <LoadList mode={s.mode} groups={s.groups} activeCart={s.activeCart} onRemove={s.removeRoll} onMoveToActive={s.moveRollToActiveCart} />
  );

  return (
    <ScreenChrome title="Çuvalsız Sevk" subtitle={customerName}>
      <View style={styles.root}>
        {wide ? (
          <View style={styles.columns}>
            <ScrollView style={styles.left} contentContainerStyle={styles.pad}>
              <LoadSummary rolls={s.rolls} mode={s.mode} groups={s.groups} />
              {settings}
            </ScrollView>
            <ScrollView style={styles.right} contentContainerStyle={styles.pad}>
              {list}
            </ScrollView>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.pad}>
            <LoadSummary rolls={s.rolls} mode={s.mode} groups={s.groups} />
            {settings}
            {list}
          </ScrollView>
        )}
        <BottomBar
          count={s.rolls.length}
          meters={totalMeters(s.rolls)}
          blockReason={s.blockReason}
          submitting={s.submitting}
          stacked={phone && !wide}
          hardware={hardware}
          flash={s.scanFb.flash}
          onScan={openScan}
          onSubmit={s.submit}
        />
      </View>

      <LooseScanner visible={scanOpen} onDismiss={() => setScanOpen(false)} state={s} listenWhileHidden />
      {s.ambiguousModal}
      <CartLabelModal visible={cartOpen} onDismiss={() => setCartOpen(false)} recent={recentCarts} onChoose={s.chooseCart} />
      <CariHoldBlockedScreen block={s.holdBlock} onClose={s.closeHold} />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  columns: { flex: 1, flexDirection: 'row' },
  left: { flex: 2 },
  right: { flex: 3 },
  pad: { padding: 16, paddingBottom: 24 },
  destCard: { marginBottom: 12 },
});
