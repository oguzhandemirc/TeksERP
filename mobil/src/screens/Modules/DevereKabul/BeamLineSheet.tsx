// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — levent satırı sayfası (TEK KART `ModuleSheet`)
// =============================================================================
// Okutulan gövde (kayıtlı ya da yerinde tanım: sahip Bizim / bu devereci), metre (plan boyuyla ön dolu),
// tartı `receiveWeighing`e göre gizli · isteğe bağlı · zorunlu. Gövde kipi kapalıyken isteğe bağlı gövde no.
// =============================================================================
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Button, SegmentedButtons } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import NumpadInput from '../../../components/NumpadInput';
import ModalTextInput from '../../../components/ModalTextInput';
import TruncatedText from '../../../components/TruncatedText';
import { colors } from '../../../theme';
import type { DevereMode3 } from '../../../services/devereKabul.service';
import { validateBeam, type BeamDraft } from './receiveDocPayload';
import type { LineSheet } from './useDevereKabul';

interface Props {
  value: LineSheet;
  weighing: DevereMode3;
  subcontractorName: string;
  onSave: (s: LineSheet) => void;
  onRemove: (orderId: string, key: string) => void;
  onDismiss: () => void;
}

export default function BeamLineSheet({ value, weighing, subcontractorName, onSave, onRemove, onDismiss }: Props) {
  const [d, setD] = useState<BeamDraft>(value.draft);
  const [tried, setTried] = useState(false);
  const error = validateBeam(d, weighing);
  const body = d.body;
  const title = body ? `Gövde ${body.bodyNo}${body.kind === 'new' ? ' (yeni)' : ''}` : 'Levent';
  const save = () => {
    setTried(true);
    if (!error) onSave({ ...value, draft: d });
  };
  return (
    <ModuleSheet
      visible
      onDismiss={onDismiss}
      title={value.editing ? `${title} — düzelt` : title}
      subtitle={body?.kind === 'existing' ? `Kayıtlı gövde · ${body.hint}` : body?.kind === 'new' ? 'Sistemde tanımsız — kabulle birlikte tanımlanır' : undefined}
      footer={
        <>
          {value.editing ? <Button icon="delete-outline" textColor={colors.dangerText} onPress={() => onRemove(value.orderId, d.key)}>Satırı sil</Button> : null}
          <Button onPress={onDismiss}>Vazgeç</Button>
          <Button mode="contained" icon="check" onPress={save} contentStyle={styles.tall} testID="devere-kabul-satir-kaydet">
            {value.editing ? 'Kaydet' : 'Ekle'}
          </Button>
        </>
      }
    >
      {body?.kind === 'new' ? (
        <>
          <Text style={sheet.label}>Gövdenin sahibi</Text>
          <SegmentedButtons
            value={body.ownerKind}
            onValueChange={(k) => setD({ ...d, body: { ...body, ownerKind: k as 'OURS' | 'WARPER' } })}
            buttons={[
              { value: 'OURS', label: 'Bizim', labelStyle: sheet.segmentLabel },
              { value: 'WARPER', label: 'Deverecinin', labelStyle: sheet.segmentLabel },
            ]}
          />
          {body.ownerKind === 'WARPER' ? <TruncatedText style={sheet.hint}>{`Sahip: ${subcontractorName}`}</TruncatedText> : null}
        </>
      ) : null}
      {!body ? (
        <>
          <Text style={sheet.label}>Gövde no (isteğe bağlı)</Text>
          <ModalTextInput mode="outlined" value={d.physicalBeamNo} onChangeText={(t) => setD({ ...d, physicalBeamNo: t })} maxLength={32} placeholder="L-12" style={sheet.input} />
        </>
      ) : null}
      <View style={sheet.row}>
        <View style={sheet.col}>
          <Text style={sheet.label}>Metre</Text>
          <NumpadInput value={d.lengthM} onChangeText={(t) => setD({ ...d, lengthM: t })} allowDecimal numpadMaxLength={9} numpadLabel="Metre" placeholder="1200" style={sheet.input} testID="devere-kabul-metre" />
        </View>
        {weighing !== 'OFF' ? (
          <>
            <View style={sheet.col}>
              <Text style={sheet.label}>{weighing === 'REQUIRED' ? 'Brüt kg (zorunlu)' : 'Brüt kg (isteğe bağlı)'}</Text>
              <NumpadInput value={d.grossKg} onChangeText={(t) => setD({ ...d, grossKg: t })} allowDecimal numpadMaxLength={9} numpadLabel="Brüt kg" placeholder="—" style={sheet.input} />
            </View>
            <View style={sheet.col}>
              <Text style={sheet.label}>Dara kg (isteğe bağlı)</Text>
              <NumpadInput value={d.tareKg} onChangeText={(t) => setD({ ...d, tareKg: t })} allowDecimal numpadMaxLength={9} numpadLabel="Dara kg" placeholder="—" style={sheet.input} />
            </View>
          </>
        ) : null}
      </View>
      {tried && error ? <Text style={sheet.error}>{error}</Text> : null}
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({ tall: { height: 56 } });
