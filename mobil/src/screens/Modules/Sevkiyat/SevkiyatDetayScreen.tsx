import React from 'react';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ScreenChrome from '../../../components/ScreenChrome';
import ShipmentDetailView from './ShipmentDetailView';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import type { MainStackParamList } from '../../../navigation/types';

// Sevkiyat detayı — SevkiyatScreen (Sevk Edilenler) ve SevkiyatGecmisi'nden push.
export default function SevkiyatDetayScreen() {
  usePortraitLock(useDeviceType() === 'phone');
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, 'SevkiyatDetay'>>();
  const { shipmentId, shipmentNo } = route.params;

  return (
    <ScreenChrome
      title={shipmentNo ?? 'Sevkiyat'}
      subtitle="Sevkiyat detayı"
      onBack={() => nav.goBack()}
    >
      <ShipmentDetailView shipmentId={shipmentId} />
    </ScreenChrome>
  );
}
