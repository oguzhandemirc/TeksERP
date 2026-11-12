// Aynı müşteri parti no (`gelenBelge.duplicateBatchNo`): kayıt 409 → ekran ortasında büyük punto kart.
// WARN (`..._ACTIVE`) "Vazgeç" / "Yine de aç"; BLOCK yalnız "Tamam". Hüküm ve eş kümesi sunucuda; kart yalnız basar.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import ModuleSheet from '../../../components/ModuleSheet';
import { colors, spacing, typography } from '../../../theme';

export const DUPLICATE_BATCH_NO = 'DELIVERY_NOTE_DUPLICATE_BATCH_NO';
export const DUPLICATE_BATCH_NO_ACTIVE = 'DELIVERY_NOTE_DUPLICATE_BATCH_NO_ACTIVE';

export interface BatchNoPeer {
  id: string;
  noteNo: string;
  customerBatchNo: string;
  workOrderNumber: string | null;
}
export interface DuplicateBatchNoConflict {
  /** true = WARN (onayla geçilir), false = BLOCK. */
  confirmable: boolean;
  peers: BatchNoPeer[];
}

/** Kullanıcının onayladığı mükerrer kapıları; iki kapı art arda 409 verebilir, ikinci onayda ilki unutulmaz. */
export type DuplicateConfirms = { docNo?: true; batchNo?: true };
/** Onaylardan gövde bayrakları (yalnız onaylananlar gider; bugünkü gövde değişmez). */
export const duplicateConfirmFlags = (c: DuplicateConfirms | undefined) => ({ ...(c?.docNo ? { confirmDuplicateDocNo: true as const } : {}), ...(c?.batchNo ? { confirmDuplicateBatchNo: true as const } : {}) });

/** apiClient'ın normalize hatasından (`details.code` — `body.code` değil) künye; başka hata → null. */
export function duplicateBatchNoConflict(error: unknown): DuplicateBatchNoConflict | null {
  const d = (error as { details?: { code?: unknown; peers?: unknown } } | null)?.details;
  if (d?.code !== DUPLICATE_BATCH_NO_ACTIVE && d?.code !== DUPLICATE_BATCH_NO) return null;
  return { confirmable: d.code === DUPLICATE_BATCH_NO_ACTIVE, peers: Array.isArray(d.peers) ? (d.peers as BatchNoPeer[]) : [] };
}

/** "ISM1439770 → IE0911260003" (İE yoksa eşin GB no'su). */
export const batchPeerLine = (p: BatchNoPeer): string => `${p.customerBatchNo} → ${p.workOrderNumber ?? p.noteNo}`;

export function DuplicateBatchNoDialog({ conflict, busy, onCancel, onConfirm }: { conflict: DuplicateBatchNoConflict | null; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  if (!conflict) return null;
  const footer = conflict.confirmable ? (
    <>
      <Button mode="outlined" onPress={onCancel} disabled={busy} contentStyle={styles.btn} labelStyle={styles.btnLabel} testID="parti-tekrar-vazgec">Vazgeç</Button>
      <Button mode="contained" onPress={onConfirm} loading={busy} disabled={busy} buttonColor={colors.warning} contentStyle={styles.btn} labelStyle={styles.btnLabel} testID="parti-tekrar-yine-de">Yine de aç</Button>
    </>
  ) : (
    <Button mode="contained" onPress={onCancel} contentStyle={styles.btn} labelStyle={styles.btnLabel} testID="parti-tekrar-tamam">Tamam</Button>
  );
  return (
    <ModuleSheet visible size="sm" onDismiss={onCancel} dismissable={!busy} title="BU PARTİ ZATEN VAR" footer={footer}>
      <View style={styles.list} testID="parti-tekrar-kart">
        {conflict.peers.map((p) => (
          <Text key={`${p.id}-${p.customerBatchNo}`} style={styles.line} testID="parti-tekrar-satir">{batchPeerLine(p)}</Text>
        ))}
      </View>
      {!conflict.confirmable && <Text style={styles.hint}>Fabrika ayarı aynı partinin ikinci kez açılmasına izin vermiyor.</Text>}
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm, paddingVertical: spacing.sm },
  line: { fontSize: typography.size.xxl, fontWeight: typography.weight.bold, color: colors.text },
  hint: { fontSize: typography.size.base, color: colors.textSecondary },
  btn: { minHeight: 56, paddingHorizontal: spacing.md },
  btnLabel: { fontSize: typography.size.lg },
});
