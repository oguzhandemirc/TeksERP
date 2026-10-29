// =============================================================================
// H3 sayaç modalları — elle metre, sapma sebebi, süpervizör PIN, onay bekleyenler
// =============================================================================
// Ekran kökünde çizilir (top değişse de açık kalır). PIN yalnız bu bileşenin yerel
// durumunda yaşar; gönderimden sonra ve kapanışta silinir.
// =============================================================================

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TextInput, TouchableRipple } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import NumpadInput from '../../../components/NumpadInput';
import { colors, radius, spacing } from '../../../theme/tokens';
import { METER_REASONS, METER_REASON_TEXT_MAX, fmtMeters, pendingAckLines } from './meterCapture';
import type { MeterAcksState } from './useMeterAcks';
import type { MeterCaptureState } from './useMeterCapture';

interface Props {
  meter: MeterCaptureState;
  acks: MeterAcksState;
  rolls: readonly { rollId: string; barcode: string | null }[];
}

function ManualSheet({ meter }: { meter: MeterCaptureState }) {
  const m = meter.modal?.kind === 'MANUAL' ? meter.modal : null;
  const [text, setText] = useState('');
  useEffect(() => setText(''), [m]);
  return (
    <ModuleSheet
      visible={!!m}
      onDismiss={meter.cancelModal}
      title={m?.phase === 'IN' ? 'Giriş metresi' : 'Çıkış metresi'}
      subtitle={m?.hint}
      size="sm"
      footer={
        <>
          <Button onPress={meter.cancelModal} testID="metre-elle-vazgec">Vazgeç</Button>
          <Button mode="contained" onPress={() => meter.submitManual(text)} testID="metre-elle-kaydet">Kaydet</Button>
        </>
      }
    >
      <Text style={sheet.label}>Metre</Text>
      <NumpadInput
        testID="metre-elle-giris"
        value={text}
        onChangeText={setText}
        useNativeKeyboard
        autoFocus
        mode="outlined"
        style={sheet.input}
        right={<TextInput.Affix text="m" />}
      />
    </ModuleSheet>
  );
}

function ReasonSheet({ meter }: { meter: MeterCaptureState }) {
  const m = meter.modal?.kind === 'REASON' ? meter.modal : null;
  const [code, setCode] = useState<string | null>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    setCode(null);
    setText('');
  }, [m]);
  const ready = !!code || !!text.trim();
  return (
    <ModuleSheet
      visible={!!m}
      onDismiss={meter.cancelModal}
      title="Metre farkı eşiği aştı"
      subtitle={m ? `Çıkış ${fmtMeters(m.meters)} · fark ${fmtMeters(m.diff)} · izin ${fmtMeters(m.allowed)}` : undefined}
      footer={
        <>
          <Button onPress={meter.cancelModal} testID="metre-sebep-vazgec">Vazgeç</Button>
          <Button mode="contained" disabled={!ready} onPress={() => meter.submitReason(code, text)} testID="metre-sebep-kaydet">
            Kaydet
          </Button>
        </>
      }
    >
      <TextInput
        testID="metre-sebep-metin"
        mode="outlined"
        placeholder="Sebep yazın (isteğe bağlı)"
        value={text}
        maxLength={METER_REASON_TEXT_MAX}
        onChangeText={setText}
        style={sheet.input}
      />
      <View style={s.chips}>
        {METER_REASONS.map((r) => (
          <TouchableRipple
            key={r.code}
            testID={`metre-sebep-${r.code}`}
            onPress={() => setCode(code === r.code ? null : r.code)}
            style={[s.chip, code === r.code && s.chipOn]}
          >
            <Text style={s.chipText}>{r.label}</Text>
          </TouchableRipple>
        ))}
      </View>
    </ModuleSheet>
  );
}

function PinSheet({ acks, rolls }: { acks: MeterAcksState; rolls: Props['rolls'] }) {
  const target = acks.pinTarget;
  const [pin, setPin] = useState('');
  useEffect(() => setPin(''), [target]);
  const tail = rolls.find((r) => r.rollId === target?.rollId)?.barcode?.slice(-4) ?? '—';
  const submit = async () => {
    const p = pin;
    setPin('');
    await acks.submitPin(p);
  };
  return (
    <ModuleSheet
      visible={!!target}
      onDismiss={acks.closePin}
      title="Süpervizör onayı"
      subtitle={`Top ${tail} · metre farkı eşiği aştı`}
      size="sm"
      footer={
        <>
          <Button onPress={acks.closePin} testID="metre-pin-sonra">Sonra</Button>
          <Button mode="contained" loading={acks.pinBusy} disabled={pin.length !== 6 || acks.pinBusy} onPress={() => void submit()} testID="metre-pin-onayla">
            Onayla
          </Button>
        </>
      }
    >
      <Text style={sheet.label}>Süpervizör PIN (6 hane)</Text>
      <TextInput
        testID="metre-pin-giris"
        mode="outlined"
        value={pin}
        onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        secureTextEntry
        autoFocus
        style={sheet.input}
      />
    </ModuleSheet>
  );
}

function UnackedSheet({ acks, rolls }: { acks: MeterAcksState; rolls: Props['rolls'] }) {
  const list = acks.unacked;
  const lines = list ? pendingAckLines(list, rolls) : [];
  return (
    <ModuleSheet
      visible={!!list}
      onDismiss={acks.closeUnacked}
      title="Adım kapatılamadı"
      subtitle={`Onay bekleyen ${lines.length} metre sapması var`}
      footer={
        <>
          <Button onPress={acks.closeUnacked}>Kapat</Button>
          {acks.pinPendingCount > 0 && (
            <Button mode="contained" onPress={acks.openPin} testID="metre-bekleyen-pin">PIN ile onayla</Button>
          )}
        </>
      }
    >
      {lines.map((l, i) => (
        <Text key={`${i}-${l}`} style={s.line} testID="metre-bekleyen-satir">{l}</Text>
      ))}
    </ModuleSheet>
  );
}

export default function MeterModals({ meter, acks, rolls }: Props) {
  return (
    <>
      <ManualSheet meter={meter} />
      <ReasonSheet meter={meter} />
      <PinSheet acks={acks} rolls={rolls} />
      <UnackedSheet acks={acks} rolls={rolls} />
    </>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 56, justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandContainer },
  chipText: { fontSize: 16, color: colors.text },
  line: { fontSize: 16, color: colors.text },
});
