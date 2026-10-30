// Tambur — "Müşteri etiketini okut" (D4-F4, DALGA4 §7.5-2): okut → bağla → başarı. Topta kod varsa
// "Değiştir" = sebepli kaldırma + bağlama. El tarayıcısı metin alanına yazar; kamera ayrı düğme.
import React from 'react';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import ModuleSheet, { sheet } from '../ModuleSheet';
import ModalTextInput from '../ModalTextInput';
import { BarcodeScannerModal } from '../BarcodeScannerModal';
import { useCustomerCodeBindForm } from './useCustomerCodeBindForm';

interface Props {
  /** null → kapalı. */
  roll: { id: string; barcode: string | null } | null;
  onDismiss: () => void;
  onBound?: (code: string) => void;
}

export function CustomerCodeBindSheet({ roll, onDismiss, onBound }: Props) {
  const { code, setCode, replace, reason, setReason, error, busy, cameraOpen, setCameraOpen, submit, close } =
    useCustomerCodeBindForm({ roll, onDismiss, onBound });
  return (
    <ModuleSheet
      visible={roll !== null}
      onDismiss={close}
      size="sm"
      title="Müşteri etiketini okut"
      subtitle={roll?.barcode ? `Top ${roll.barcode}` : undefined}
      footer={
        <>
          <Button onPress={close}>Vazgeç</Button>
          <Button
            mode="contained"
            onPress={() => void submit()}
            loading={busy}
            disabled={busy || !code.trim()}
            testID="customer-code-bind-submit"
          >
            {replace ? 'Değiştir' : 'Bağla'}
          </Button>
        </>
      }
      overlays={
        <BarcodeScannerModal
          visible={cameraOpen}
          title="Müşteri etiketini okut"
          onDismiss={() => setCameraOpen(false)}
          onScan={(v) => {
            setCameraOpen(false);
            setCode(v);
            void submit(v);
          }}
        />
      }
    >
      <Text style={sheet.label}>Müşteri barkodu</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <ModalTextInput
            mode="outlined"
            value={code}
            onChangeText={setCode}
            autoFocus
            autoCapitalize="characters"
            placeholder="Etiketi el okuyucuyla okutun"
            onSubmitEditing={() => void submit()}
            style={sheet.input}
            testID="customer-code-input"
          />
        </View>
        <Button icon="camera" mode="outlined" onPress={() => setCameraOpen(true)} contentStyle={{ minHeight: 56 }}>
          Kamera
        </Button>
      </View>
      {replace && (
        <>
          <Text style={sheet.label}>Değiştirme sebebi (eski kod kaldırılır, satır silinmez)</Text>
          <ModalTextInput
            mode="outlined"
            value={reason}
            onChangeText={setReason}
            placeholder="Örn. etiket yırtıldı"
            style={sheet.input}
            testID="customer-code-reason"
          />
        </>
      )}
      {error && <Text style={sheet.error}>{error}</Text>}
    </ModuleSheet>
  );
}
