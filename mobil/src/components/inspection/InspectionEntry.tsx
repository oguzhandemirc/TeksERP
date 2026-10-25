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
  /** 4 puan modu: tür ızgarası + boyut şeridi birlikte görünür (seçim değiştirilebilir). */
  sizeClassMode?: boolean;
  /** false: metre alanı numpad'i kendiliğinden almaz (KK1 konağında metraj alanı alır). */
  meterAutoActivate?: boolean;
  meterOptional?: boolean;
}

// Boyut renkleri 1 gri · 2 sarı · 3 turuncu · 4 kırmızı; rakam + aralık da yazılır.
const SIZE_TONE: Record<InspectionSizeClass, { bg: string; fg: string }> = {
  S1: { bg: palette.slate[400], fg: palette.white },
  S2: { bg: palette.amber[300], fg: palette.amber[900] },
  S3: { bg: palette.amber[600], fg: palette.white },
  S4: { bg: palette.red[600], fg: palette.white },
};

function SizeStrip({ title, active, onPick, onCancel }: { title: string | null; active: boolean; onPick: (s: InspectionSizeClass) => void; onCancel: () => void }) {
  return (
    <View style={[styles.sizeBlock, active && styles.sizeBlockActive]} testID="inspection-size-strip">
      <TruncatedText style={styles.sizeTitle}>{active && title ? [title, ' — boyut?'] : ['BOYUT — önce hata türüne dokun']}</TruncatedText>
      <View style={styles.grid}>
        {SIZE_CLASSES.map((s) => (
          <TouchableRipple
            key={s.code}
            testID={`inspection-size-${s.code}`}
            disabled={!active}
            onPress={() => onPick(s.code)}
            rippleColor={RIPPLE}
            style={[styles.btn, styles.sizeBtn, { backgroundColor: SIZE_TONE[s.code].bg }, !active && styles.dim]}
          >
            <View style={styles.sizeInner}>
              <Text style={[styles.sizeNum, { color: SIZE_TONE[s.code].fg }]}>{s.label}</Text>
              <Text style={[styles.sizeRange, { color: SIZE_TONE[s.code].fg }]}>{s.range}</Text>
            </View>
          </TouchableRipple>
        ))}
        {active && (
          <TouchableRipple onPress={onCancel} style={[styles.btn, styles.sizeBtn, styles.sizeCancel]}>
            <Text style={[styles.btnText, styles.sizeCancelText]}>Vazgeç</Text>
          </TouchableRipple>
        )}
      </View>
    </View>
  );
}

interface TypeGridProps {
  defectTypes: DefectType[];
  onTypePress: (id: string) => void;
  selectedId?: string | null;
  large?: boolean;
}

function TypeGrid({ defectTypes, onTypePress, selectedId, large }: TypeGridProps) {
  return (
    <View style={styles.grid}>
      {defectTypes.map((dt) => (
        <TouchableRipple
          key={dt.id}
          testID={`inspection-type-${dt.id}`}
          onPress={() => onTypePress(dt.id)}
          rippleColor={RIPPLE}
          style={[styles.btn, selectedId === dt.id && styles.btnSelected]}
        >
          <TruncatedText style={[styles.btnText, large && styles.btnTextLarge]}>
            {large && dt.fixedPoints != null ? [dt.name, ` ·${dt.fixedPoints}p`] : [dt.name]}
          </TruncatedText>
        </TouchableRipple>
      ))}
    </View>
  );
}

export default function InspectionEntry(p: InspectionEntryProps) {
  const pendingTitle = p.defectTypes.find((d) => d.id === p.pendingTypeId)?.name ?? null;
  let body: React.ReactNode;
  if (p.defectTypes.length === 0) {
    body = <Text style={styles.muted}>Hata tipi tanımlı değil — admin'den ekleyin</Text>;
  } else if (p.sizeClassMode) {
    body = (
      <>
        <TypeGrid defectTypes={p.defectTypes} onTypePress={p.onTypePress} selectedId={p.pendingTypeId} large />
        <SizeStrip title={pendingTitle} active={!!p.pendingTypeId} onPick={p.onSizePick} onCancel={p.onSizeCancel} />
      </>
    );
  } else {
    body = <TypeGrid defectTypes={p.defectTypes} onTypePress={p.onTypePress} />;
  }
  return (
    <Surface style={styles.section} elevation={1}>
      {/* autoActivate (varsayılan): input'a dokunmadan numpad doğrudan buraya yazar. */}
      <NumpadInput
        mode="outlined"
        value={p.meterInput}
        onChangeText={p.onMeterChange}
        numpadLabel="Hata metresi"
        allowDecimal
        autoActivate={p.meterAutoActivate ?? true}
        numpadMaxLength={8}
        label={p.meterOptional ? 'Metre (isteğe bağlı)' : 'Hata metresi (mt)'}
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
  btnSelected: { backgroundColor: palette.amber[900] },
  btnTextLarge: { fontSize: 20 },
  sizeBlock: { gap: 8, borderRadius: 10, padding: 6 },
  sizeBlockActive: { backgroundColor: palette.amber[100], borderWidth: 2, borderColor: palette.amber[600] },
  sizeBtn: { flexBasis: 96, minWidth: 96 },
  sizeInner: { alignItems: 'center' },
  sizeNum: { fontSize: 24, fontWeight: '900' },
  sizeRange: { fontSize: 14, fontWeight: '700' },
  dim: { opacity: 0.45 },
  sizeTitle: { fontSize: 15, fontWeight: '800', color: palette.amber[900] },
  sizeCancel: { backgroundColor: palette.slate[200] },
  sizeCancelText: { color: palette.slate[700] },
});
