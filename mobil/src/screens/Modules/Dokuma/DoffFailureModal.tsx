// =============================================================================
// Kesin çakışma yüzeyleri — toast değil MODAL (kk1.md çakışma kuralı) · tek kart, kapatılamaz
//   · CLIENT_TOKEN_COLLISION: aynı token başka yükle gitmiş → yeni deneme ya da vazgeç
//   · DOFF_HAS_ROLLS: top doğmuş → geri alınamaz; barkodlar ADIYLA (Fason Kabul kalıbı)
// =============================================================================
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import { colors, spacing } from '../../../theme';
import type { DoffFailureAction } from './doffPayload';

interface Props {
  failure: DoffFailureAction | null;
  onDismiss: () => void;
  onResendAsNew: () => void;
}

export default function DoffFailureModal({ failure, onDismiss, onResendAsNew }: Props) {
  const kind = failure?.kind === 'token-collision' || failure?.kind === 'has-rolls' ? failure.kind : null;
  return (
    <ModuleSheet
      visible={kind !== null}
      onDismiss={onDismiss}
      dismissable={false}
      size="sm"
      title={kind === 'has-rolls' ? 'Bu indirmeden top doğmuş — geri alınamaz' : 'Bu deneme başka bir indirmeyle çakıştı'}
      footer={
        kind === 'has-rolls' ? (
          <Button mode="contained" onPress={onDismiss}>Tamam</Button>
        ) : (
          <>
            <Button onPress={onDismiss}>Vazgeç</Button>
            <Button mode="contained" onPress={onResendAsNew}>Yeni indirme olarak gönder</Button>
          </>
        )
      }
    >
      <Text style={sheet.body_}>{failure?.message}</Text>
      {failure?.kind === 'has-rolls' ? (
        <View style={styles.codes}>
          {failure.barcodes.map((b) => (
            <Text key={b} style={styles.barcode}>{b}</Text>
          ))}
          {failure.total > failure.barcodes.length ? <Text style={sheet.body_}>{`… toplam ${failure.total} top`}</Text> : null}
        </View>
      ) : null}
    </ModuleSheet>
  );
}

// Barkod listesi yalnız bu modalın: sözlükte karşılığı yok (tek satırlık monospace).
const styles = StyleSheet.create({
  codes: { marginTop: spacing.sm, gap: spacing.xs },
  barcode: { fontFamily: 'monospace', color: colors.text },
});
