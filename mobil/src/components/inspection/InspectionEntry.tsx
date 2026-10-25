// Hata girişi bloğu: metre gir → hata tipine bas (4 puan modunda ardından boyut).
// Kaydetmez; seçimi InspectionPanel'e verir.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Surface, Text, TouchableRipple } from 'react-native-paper';
import NumpadInput from '../NumpadInput';
import TruncatedText from '../TruncatedText';
import { palette } from '../../theme/tokens';
import type { DefectType } from '../../types/models';
import { SIZE_CLASSES, type InspectionSizeClass } from './inspectionModel';

const RIPPLE = 'rgba(255,255,255,0.25)';

interface InspectionEntryProps {
  defectTypes: DefectType[];
  meterInput: string;
  onMeterChange: (v: string) => void;
  compact: boolean;
  pendingTypeId: string | null;
  onTypePress: (defectTypeId: string) => void;
  onSizePick: (sizeClass: InspectionSizeClass) => void;
  onSizeCancel: () => void;
}

function SizePicker({ title, onPick, onCancel }: { title: string; onPick: (s: InspectionSizeClass) => void; onCancel: () => void }) {
  return (
    <View style={styles.sizeBlock}>
      <TruncatedText style={styles.sizeTitle}>{[title, ' — boyut?']}</TruncatedText>
      <View style={styles.grid}>
        {SIZE_CLASSES.map((s) => (
          <TouchableRipple
            key={s.code}
            testID={`inspection-size-${s.code}`}
            onPress={() => onPick(s.code)}
            rippleColor={RIPPLE}
            style={styles.btn}
          >
            <Text style={styles.btnText}>{s.label}</Text>
          </TouchableRipple>
        ))}
        <TouchableRipple onPress={onCancel} style={[styles.btn, styles.sizeCancel]}>
          <Text style={[styles.btnText, styles.sizeCancelText]}>Vazgeç</Text>
        </TouchableRipple>
      </View>
    </View>
  );
}

function TypeGrid({ defectTypes, onTypePress }: { defectTypes: DefectType[]; onTypePress: (id: string) => void }) {
  return (
    <View style={styles.grid}>
      {defectTypes.map((dt) => (
        // OFFLINE-AWARE: isPending'e disabled bağı YOK — duraklamış mutasyon
        // isPending'i sonsuza true tutar, tuşlar kilitlenirdi. Çift basışı
        // metre temizliği + mükerrer kontrolü + backend 409 engeller.
        <TouchableRipple
          key={dt.id}
          testID={`inspection-type-${dt.id}`}
          onPress={() => onTypePress(dt.id)}
          rippleColor={RIPPLE}
          style={styles.btn}
        >
          <TruncatedText style={styles.btnText}>{dt.name}</TruncatedText>
        </TouchableRipple>
      ))}
    </View>
  );
}

export default function InspectionEntry(p: InspectionEntryProps) {
  let body: React.ReactNode;
  if (p.defectTypes.length === 0) {
    body = <Text style={styles.muted}>Hata tipi tanımlı değil — admin'den ekleyin</Text>;
  } else if (p.pendingTypeId) {
    const title = p.defectTypes.find((d) => d.id === p.pendingTypeId)?.name ?? 'Hata';
    body = <SizePicker title={title} onPick={p.onSizePick} onCancel={p.onSizeCancel} />;
  } else {
    body = <TypeGrid defectTypes={p.defectTypes} onTypePress={p.onTypePress} />;
  }
  return (
    <Surface style={styles.section} elevation={1}>
      {/* autoActivate: input'a dokunmadan numpad doğrudan buraya yazar. */}
      <NumpadInput
        mode="outlined"
        value={p.meterInput}
        onChangeText={p.onMeterChange}
        numpadLabel="Hata metresi"
        allowDecimal
        autoActivate
        numpadMaxLength={8}
        label="Hata metresi (mt)"
        dense
        style={styles.meterInput}
        useNativeKeyboard={p.compact}
      />
      {body}
    </Surface>
  );
}

const styles = StyleSheet.create({
  // Giriş alanı (sürekli açık, kompakt amber blok).
  section: {
    backgroundColor: palette.amber[50],
    borderColor: palette.amber[300],
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 12,
    gap: 10,
  },
  muted: { fontSize: 12, color: palette.slate[400], fontStyle: 'italic' },
  meterInput: { backgroundColor: palette.white },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Hata tipi = ANA TUŞ (≥64 dp, eldivenle basılır); satırı tam doldurur.
  btn: {
    backgroundColor: palette.amber[600],
    borderRadius: 10,
    minHeight: 64,
    flexGrow: 1,
    flexBasis: 124,
    minWidth: 124,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  btnText: { fontSize: 17, fontWeight: '800', color: palette.white },
  sizeBlock: { gap: 8 },
  sizeTitle: { fontSize: 15, fontWeight: '800', color: palette.amber[900] },
  sizeCancel: { backgroundColor: palette.slate[200] },
  sizeCancelText: { color: palette.slate[700] },
});
