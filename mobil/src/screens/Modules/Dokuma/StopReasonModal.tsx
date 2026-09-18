// =============================================================================
// DURUŞ SEBEBİ MODALİ — açılışta isteğe bağlı (borç doğar), sebep atamada zorunlu · tek kart
// =============================================================================
// Sunum `ReasonPresetPicker` (ortak, kabul görmüş bileşen — dokunulmadı): serbest metin
// ÜSTTE, sebep chip'leri altında (2026-08-19 kararı). Sunucusuzken gömülü zemin
// (`constants/loomStopReasons.ts`) — ekran kilitlenmez.
// =============================================================================
import React from 'react';
import { Button } from 'react-native-paper';
import ModuleSheet from '../../../components/ModuleSheet';
import ReasonPresetPicker from '../../../components/reasonPresets/ReasonPresetPicker';
import { REASON_NOTE_MAX } from './stopPayload';
import type { StopPanelState } from './useStopPanel';

export default function StopReasonModal({ state }: { state: StopPanelState }) {
  const classify = state.modal?.mode === 'classify';
  return (
    <ModuleSheet
      visible={state.modal !== null}
      onDismiss={state.closeModal}
      title={classify ? 'Duruşa sebep ata' : 'Duruş bildir'}
      subtitle={
        classify
          ? 'Kayıp sınıfı sebepten gelir; karar defterine yazılır, sonradan yalnız yeniden sınıflandırma ile değişir.'
          : 'Sebep şimdi verilmezse duruş yine açılır; sınıflandırma borcu doğar ve panelde "sebep ata" görünür.'
      }
      footer={
        <>
          <Button onPress={state.closeModal} disabled={state.submitting}>Vazgeç</Button>
          <Button mode="contained" onPress={state.submit} loading={state.submitting} disabled={state.submitting}>
            {classify ? 'Sebebi Kaydet' : 'Duruşu Aç'}
          </Button>
        </>
      }
    >
      <ReasonPresetPicker kind="MACHINE_STOP" value={state.reason} onChange={state.setReason} optional={!classify} placeholder="Not (isteğe bağlı) — ya da aşağıdan seç" maxLength={REASON_NOTE_MAX} />
    </ModuleSheet>
  );
}
