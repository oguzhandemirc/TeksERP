// =============================================================================
// Sevk Kapısı — cari kilit çipi + 409 CARI_HOLD tam ekranı (D4-I4, ister 4.7)
// =============================================================================
// Metinler SUNUCUDAN gelir: çip `holdText` (board satırı), tam ekran 409 `message` (kim açabilir dahil).
// İstemci metin ÜRETMEZ — kural değişirse tek yer backend `cari-hold.helper`. Eski backend alan
// göndermez → çip yok; 409 `details.code` CARI_HOLD değilse tam ekran açılmaz (eski tost yolu).
// =============================================================================

import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { colors, palette, spacing } from '../../../theme/tokens';

/** Çip metni — yalnız sunucu `held: true` VE metin gönderdiyse; aksi hâlde null (çip çizilmez). */
export function holdChipText(row: { held?: boolean; holdText?: string | null }): string | null {
  return row.held === true && typeof row.holdText === 'string' && row.holdText.length > 0 ? row.holdText : null;
}

export interface CariHoldBlock {
  message: string;
  placedBy: string | null;
}

/** 409 `details.code === 'CARI_HOLD'` → tam ekran görünümü; başka hata null (çağıran eski tost yolunu sürer). */
export function cariHoldBlockFromError(err: unknown): CariHoldBlock | null {
  const e = err as { status?: number; message?: unknown; details?: { code?: unknown; koyan?: unknown } } | null;
  if (e?.status !== 409 || e.details?.code !== 'CARI_HOLD') return null;
  const message = typeof e.message === 'string' && e.message.length > 0 ? e.message : null;
  if (!message) return null;
  return { message, placedBy: typeof e.details.koyan === 'string' ? e.details.koyan : null };
}

export function CariHoldChip({ text, testID }: { text: string; testID?: string }) {
  return (
    <View style={styles.chip} testID={testID}>
      <Icon source="lock-alert" size={13} color={colors.dangerDark} />
      <Text style={styles.chipText} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

export function CariHoldBlockedScreen({ block, onClose }: { block: CariHoldBlock | null; onClose: () => void }) {
  return (
    <Modal visible={block !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root} testID="cari-kilit-ekrani">
        <Icon source="lock-alert" size={72} color={colors.danger} />
        <Text style={styles.title}>Sevk durduruldu — cari kilitli</Text>
        <Text style={styles.body} testID="cari-kilit-mesaj">
          {block?.message ?? ''}
        </Text>
        <Button mode="contained" icon="check" onPress={onClose} buttonColor={colors.danger} style={styles.button} testID="cari-kilit-tamam">
          Anladım
        </Button>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 6,
    backgroundColor: colors.dangerContainer,
  },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.dangerDark, flexShrink: 1 },
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: palette.red[50],
  },
  title: { fontSize: 22, fontWeight: '800', color: colors.dangerDark, textAlign: 'center' },
  body: { fontSize: 16, color: palette.slate[700], textAlign: 'center', maxWidth: 640, lineHeight: 24 },
  button: { marginTop: spacing.md, minWidth: 200 },
});
