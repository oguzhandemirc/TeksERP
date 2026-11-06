// Dökme/arabadan tek top çıkarma (9.3) — onay modalı + mutasyon. Yalnız PLANLI sevkiyatta (sunucu 409 korur).
// Son top çıkarsa birim sevkiyattan düşer; bunu onayda önceden söyleriz (sürpriz yok).
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import AppModal from '../../../components/AppModal';
import { shipmentLoadService } from '../../../services/shipmentLoad.service';
import { signalScan } from '../../../services/scanFeedback';
import { showScreenError } from '../../../lib/screenToast';
import { READY_WORKS_KEY } from './ReadyWorks';
import { removeConfirmText, type LooseRollAsk } from './loadEdit';
import { colors, palette, spacing } from '../../../theme/tokens';

export function useLooseRollRemove() {
  const qc = useQueryClient();
  const [ask, setAsk] = useState<LooseRollAsk | null>(null);
  const mut = useMutation({
    mutationFn: (a: LooseRollAsk) => shipmentLoadService.removeRoll(a.shipmentId, a.rollId),
    onSuccess: (res, a) => {
      signalScan('accept');
      Toast.show({ type: 'success', text1: 'Top çıkarıldı', text2: res.message });
      setAsk(null);
      void qc.invalidateQueries({ queryKey: ['sack-contents', a.shipmentId] });
      void qc.invalidateQueries({ queryKey: ['sack-store'] });
      void qc.invalidateQueries({ queryKey: READY_WORKS_KEY });
    },
    onError: (e: Error, a) => {
      showScreenError(e, 'Top çıkarılamadı');
      setAsk(null);
      void qc.invalidateQueries({ queryKey: ['sack-contents', a.shipmentId] });
    },
  });
  const modal = (
    <AppModal visible={ask !== null} onDismiss={() => setAsk(null)} position="center" contentStyle={styles.modal}>
      <Text style={styles.title}>Topu çıkar</Text>
      {ask ? <Text style={styles.body}>{removeConfirmText(ask)}</Text> : null}
      <View style={styles.actions}>
        <Button onPress={() => setAsk(null)} contentStyle={styles.btn} disabled={mut.isPending}>
          Vazgeç
        </Button>
        <Button
          mode="contained"
          buttonColor={palette.red[600]}
          contentStyle={styles.btn}
          loading={mut.isPending}
          disabled={mut.isPending}
          onPress={() => ask && mut.mutate(ask)}
          testID="top-cikar-onay"
        >
          Çıkar
        </Button>
      </View>
    </AppModal>
  );
  return { ask: setAsk, modal, removing: mut.isPending };
}

const styles = StyleSheet.create({
  modal: { padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  body: { fontSize: 14, color: colors.textSecondary },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  btn: { minHeight: 56 },
});
