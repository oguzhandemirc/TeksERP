// =============================================================================
// GERİ ALMA MODALİ — sebep zorunlu (koşum · duruş · indirme paylaşır; damga, defter satırı düşer)
// =============================================================================
// Tek kart (`ModuleSheet`, 2026-09-18 iskeleti). `minLength`: koşum/duruş 3, indirme 1 —
// eskiden DoffTodayList kendi kopyasını taşıyordu, tek bileşen.
// =============================================================================
import React, { useState } from 'react';
import { Button } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import ModalTextInput from '../../../components/ModalTextInput';

interface Props {
  visible: boolean;
  title: string;
  hint: string;
  busy: boolean;
  /** Sebebin en az uzunluğu (kırpılmış). Varsayılan 3. */
  minLength?: number;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export default function RevokeReasonModal({ visible, title, hint, busy, minLength = 3, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const close = () => {
    setReason('');
    onClose();
  };
  const ok = reason.trim().length >= minLength;
  return (
    <ModuleSheet
      visible={visible}
      onDismiss={close}
      title={title}
      subtitle={hint}
      size="sm"
      footer={
        <>
          <Button onPress={close} disabled={busy} testID="revoke-vazgec">Vazgeç</Button>
          <Button
            mode="contained"
            disabled={!ok || busy}
            loading={busy}
            testID="revoke-onay"
            onPress={() => {
              onConfirm(reason.trim());
              setReason('');
            }}
          >
            Geri Al
          </Button>
        </>
      }
    >
      <ModalTextInput label="Sebep" value={reason} onChangeText={setReason} maxLength={300} autoFocus mode="outlined" style={sheet.input} testID="revoke-sebep" />
    </ModuleSheet>
  );
}
