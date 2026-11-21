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
import type { DevereMode3, ReworkCandidate } from '../../../services/devereKabul.service';
import { inputText, validateBeam, type BeamDraft } from './receiveDocPayload';
import type { LineSheet } from './useDevereKabul';
import { ds } from './devereKabul.styles';

interface Props {
  value: LineSheet;
  weighing: DevereMode3;
  subcontractorName: string;
  /** Ek-2 r: siparişin yeniden sarım adayları (eski sunucu → boş; seçim gizli). */
  reworkCandidates?: ReworkCandidate[];
  onSave: (s: LineSheet) => void;
  onRemove: (orderId: string, key: string) => void;
  onDismiss: () => void;
}

export default function BeamLineSheet({ value, weighing, subcontractorName, reworkCandidates = [], onSave, onRemove, onDismiss }: Props) {
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
          <ModalTextInput mode="outlined" value={d.physicalBeamNo} onChangeText={(t) => setD({ ...d, physicalBeamNo: t })} maxLength={32} placeholder="L-12" autoCapitalize="characters" style={ds.bigInput} />
        </>
      ) : null}
      <View style={sheet.row}>
        <View style={sheet.col}>
          <Text style={sheet.label}>Metre</Text>
          <NumpadInput value={d.lengthM} onChangeText={(t) => setD({ ...d, lengthM: t })} allowDecimal numpadMaxLength={9} numpadLabel="Metre" placeholder="1200" mode="outlined" style={ds.bigInput} testID="devere-kabul-metre" />
        </View>
        {weighing !== 'OFF' ? (
          <>
            <View style={sheet.col}>
              <Text style={sheet.label}>{weighing === 'REQUIRED' ? 'Brüt kg (zorunlu)' : 'Brüt kg (isteğe bağlı)'}</Text>
              <NumpadInput value={d.grossKg} onChangeText={(t) => setD({ ...d, grossKg: t })} allowDecimal numpadMaxLength={9} numpadLabel="Brüt kg" placeholder="—" mode="outlined" style={ds.bigInput} />
            </View>
            <View style={sheet.col}>
              <Text style={sheet.label}>Dara kg (isteğe bağlı)</Text>
              <NumpadInput value={d.tareKg} onChangeText={(t) => setD({ ...d, tareKg: t })} allowDecimal numpadMaxLength={9} numpadLabel="Dara kg" placeholder="—" mode="outlined" style={ds.bigInput} />
            </View>
          </>
        ) : null}
      </View>
      <ReworkPicker candidates={reworkCandidates} draft={d} onChange={setD} />
      {tried && error ? <Text style={sheet.error}>{error}</Text> : null}
    </ModuleSheet>
  );
}

/** Ek-2 r: "bu levent reddedilen hangi sarımın yeniden sarımı?" — aday yoksa hiç çizilmez; seçim metreyi aday boyuyla doldurur. */
function ReworkPicker({ candidates, draft: d, onChange }: { candidates: ReworkCandidate[]; draft: BeamDraft; onChange: (d: BeamDraft) => void }) {
  if (candidates.length === 0) return null;
  return (
    <>
      <Text style={sheet.label}>Yeniden sarım mı?</Text>
      <View style={styles.chips}>
        <Button mode={!d.reworkOfBeamId ? 'contained' : 'outlined'} onPress={() => onChange({ ...d, reworkOfBeamId: undefined })} contentStyle={styles.tall} testID="devere-kabul-rework-yok">Hayır — yeni levent</Button>
        {candidates.map((c) => (
          <Button
            key={c.beamId}
            mode={d.reworkOfBeamId === c.beamId ? 'contained' : 'outlined'}
            onPress={() => onChange({ ...d, reworkOfBeamId: c.beamId, lengthM: c.lengthM ? inputText(c.lengthM) : d.lengthM })}
            contentStyle={styles.tall}
            testID={`devere-kabul-rework-${c.beamNo}`}
          >
            {`${c.beamNo}${c.bodyNo ? ` · ${c.bodyNo}` : ''} (${c.rejectionDocNo})`}
          </Button>
        ))}
      </View>
      <Text style={sheet.hint}>Reddedilip devereciye geri gönderilen levent yeniden sarıldıysa onu seçin.</Text>
    </>
  );
}

const styles = StyleSheet.create({ tall: { height: 56 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
