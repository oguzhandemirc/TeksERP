// =============================================================================
// KOŞUMU KAPAT — atkı sayacı (opsiyonel; boş = ölçülmedi, 0 DEĞİL) · tek kart
// =============================================================================
import React, { useState } from 'react';
import { Text, Button } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import NumpadInput from '../../../components/NumpadInput';
import type { RunPanelState } from './useRunPanel';

export default function RunCloseModal({ state }: { state: RunPanelState }) {
  const [picks, setPicks] = useState('');
  const close = () => {
    state.setCloseTarget(null);
    setPicks('');
  };
  return (
    <ModuleSheet
      visible={state.closeTarget !== null}
      onDismiss={close}
      title="Koşumu kapat"
      subtitle="Kapanış terimleri donar. Üretilen metre KK1'den (doff → top) gelir."
      size="sm"
      footer={
        <>
          <Button onPress={close} disabled={state.closing}>Vazgeç</Button>
          <Button mode="contained" onPress={() => state.submitClose(picks)} loading={state.closing} disabled={state.closing}>Kapat</Button>
        </>
      }
    >
      <Text style={sheet.label}>Atkı sayacı (isteğe bağlı — boş: ölçülmedi)</Text>
      <NumpadInput value={picks} onChangeText={setPicks} allowDecimal={false} numpadMaxLength={9} numpadLabel="Atkı sayacı" placeholder="okunmadı" style={sheet.input} />
    </ModuleSheet>
  );
}
