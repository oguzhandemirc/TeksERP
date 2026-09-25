// Düzeltme kartlarının ortak parçaları (hareket defteri D5/D6): hata metni, kayıt sonrası adımlar, alt çubuk.
import React from 'react';
import { Button } from 'react-native-paper';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';

/** Düzeltme kartlarının ihtiyaç duyduğu iş emri alanları. */
export interface FixWo {
  id: string;
  workOrderNumber: string;
  targetColorId?: string | null;
  targetColor?: { name?: string | null } | null;
  width?: number | null;
  /** Parti Ekle: kumaş kilidi ve ilk adım adı. */
  targetItemId?: string | null;
  targetItem?: { name?: string | null } | null;
  steps?: { stepSequence: number; station?: { name?: string | null } | null }[];
}

export function errorText(err: unknown): string | undefined {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message;
}

/** Kaydet sonrası ortak adımlar: titreşim, tost, uyarılar, sorgu tazeleme. */
export function useAfterSave(woId: string, onDone: () => void) {
  const qc = useQueryClient();
  return (title: string, warnings: readonly string[] = []) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Toast.show({ type: 'success', text1: title });
    for (const w of warnings) Toast.show({ type: 'info', text1: 'Dikkat', text2: w, visibilityTime: 6000 });
    void qc.invalidateQueries({ queryKey: ['work-order', woId] });
    void qc.invalidateQueries({ queryKey: ['work-order-events', woId] });
    void qc.invalidateQueries({ queryKey: ['work-orders'] });
    onDone();
  };
}

export function Footer({ onCancel, onSave, busy, disabled, label = 'Kaydet' }: {
  onCancel: () => void; onSave: () => void; busy: boolean; disabled: boolean; label?: string;
}) {
  return (
    <>
      <Button mode="text" onPress={onCancel} disabled={busy}>Vazgeç</Button>
      <Button mode="contained" onPress={onSave} loading={busy} disabled={disabled || busy}>{label}</Button>
    </>
  );
}
