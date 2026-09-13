// =============================================================================
// Kesin çakışma yüzeyleri — toast değil MODAL (kk1.md çakışma kuralı)
//   · CLIENT_TOKEN_COLLISION: aynı token başka yükle gitmiş → yeni deneme ya da vazgeç
//   · DOFF_HAS_ROLLS: top doğmuş → geri alınamaz; barkodlar ADIYLA (Fason Kabul kalıbı)
// =============================================================================
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import { colors, spacing, typography } from '../../../theme';
import type { DoffFailureAction } from './doffPayload';

interface Props {
  failure: DoffFailureAction | null;
  onDismiss: () => void;
  onResendAsNew: () => void;
}

export default function DoffFailureModal({ failure, onDismiss, onResendAsNew }: Props) {
  const visible = failure !== null && (failure.kind === 'token-collision' || failure.kind === 'has-rolls');
  return (
    <AppModal visible={visible} onDismiss={onDismiss} position="center" dismissable={false}>
      {failure?.kind === 'token-collision' && (
        <>
          <Text style={styles.title}>Bu deneme başka bir indirmeyle çakıştı</Text>
          <Text style={styles.body}>{failure.message}</Text>
          <View style={styles.actions}>
            <Button onPress={onDismiss}>Vazgeç</Button>
            <Button mode="contained" onPress={onResendAsNew}>Yeni indirme olarak gönder</Button>
          </View>
        </>
      )}
      {failure?.kind === 'has-rolls' && (
        <>
          <Text style={styles.title}>Bu indirmeden top doğmuş — geri alınamaz</Text>
          <Text style={styles.body}>{failure.message}</Text>
          <View style={styles.codes}>
            {failure.barcodes.map((b) => (
              <Text key={b} style={styles.barcode}>{b}</Text>
            ))}
            {failure.total > failure.barcodes.length && <Text style={styles.body}>{`… toplam ${failure.total} top`}</Text>}
          </View>
          <View style={styles.actions}>
            <Button mode="contained" onPress={onDismiss}>Tamam</Button>
          </View>
        </>
      )}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text, marginBottom: spacing.sm },
  body: { fontSize: typography.size.sm, color: colors.textSecondary },
  codes: { marginTop: spacing.sm, gap: spacing.xs },
  barcode: { fontFamily: 'monospace', color: colors.text },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
});
