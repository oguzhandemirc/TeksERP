// =============================================================================
// InspectionPanel — TEK hata giriş bileşeni (KQ-D3 · K4P ile ortak, plan §3.7)
// =============================================================================
// Metre cetveli (bu adımın hataları silinebilir, önceki adımlarınki gri ve
// salt-okunur) + metre girişi + hata tipi ızgarası. Bileşen KAYDETMEZ: geçerli
// girdiyi `onDefect` ile konağa verir, konak yazar (süreç konakları her dokunuşta,
// K4P KK1 taslakta biriktirir). İstasyon türü/ekran adı burada SORULMAZ —
// panel her istasyon bileşiminde aynıdır (jest bekçisi dizini tarar).
// =============================================================================
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Surface, Text } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { palette } from '../../theme/tokens';
import type { DefectType } from '../../types/models';
import DefectRuler from './DefectRuler';
import DeletePointModal from './DeletePointModal';
import InspectionEntry from './InspectionEntry';
import InspectionSummaryStrip, { type InspectionSummary } from './InspectionSummaryStrip';
import PriorDefectList from './PriorDefectList';
import {
  isCriticalDefect,
  overMaxWarning,
  rulerMaxFor,
  rulerSectionMode,
  validateDefectInput,
  validationMaxMeter,
  type InspectionDefect,
  type InspectionDefectInput,
  type InspectionPriorDefect,
  type InspectionSizeClass,
  type OverMaxMode,
} from './inspectionModel';

export {
  inspectionSaveErrorText,
  priorDefectKunye,
  toInspectionPriorDefects,
  validateDefectInput,
  type InspectionDefect,
  type InspectionDefectInput,
  type InspectionPriorDefect,
  type InspectionSizeClass,
} from './inspectionModel';
export type { InspectionSummary } from './InspectionSummaryStrip';

export interface InspectionPanelProps {
  defectTypes: DefectType[];
  ownDefects: InspectionDefect[];
  priorDefects?: InspectionPriorDefect[];
  meterInput: string;
  onMeterChange: (v: string) => void;
  /** K4P 4 puan modu: tip dokunuşundan sonra 4 boyut düğmesi sorulur. */
  sizeClassMode?: boolean;
  readOnly?: boolean;
  onDefect: (input: InspectionDefectInput) => void;
  onDelete: (id: string) => void;
  /** Topun boyu (mt): cetvel ölçeği + "metraj kumaşı aşamaz" istemci ikizi. */
  maxMeter?: number;
  /** Top boyunu aşan metre: 'block' (varsayılan, bugünkü) engeller; 'warn' kaydeder + sarı satır (kurşun). */
  overMaxMode?: OverMaxMode;
  /** Telefonda yerel klavye (tablette ekran numpad'i). */
  compact?: boolean;
  /** Cetvel + girişin altına konak eki (ör. işlem paneli) — giriş bloğuyla aynı sütunda. */
  children?: React.ReactNode;
  /** Cetvel ile giriş arasına esnek boşluk: giriş bloğu (ve konağın altındaki düğme) kabın altına yaslanır.
   *  Konak `flex:1` kolon olmalı; varsayılan kapalı (diğer ekranlar bugünkü gibi yukarıdan dizer).
   *  Artan yerin çoğu giriş bloğuna gider: `flexGrow`lu konak eki (ör. kurşun sayaç şeridi) onu doldurur. */
  entryAtBottom?: boolean;
  /** K4P özet şeridi: sayım + sunucu önizlemesi (konak hesaplar/çeker; bileşen yalnız gösterir). */
  summary?: InspectionSummary;
  /** 4 puan: metre boşsa kayıt konumsuz (`meter: null`) düşer. */
  meterOptional?: boolean;
  /** false: metre alanı numpad'i kendiliğinden almaz (varsayılan true — süreç konakları). */
  meterAutoActivate?: boolean;
  /** Cetvel boşken metin; metresiz kayıt tutan konak "hata yok" demesin diye verir. */
  rulerEmptyText?: string;
  /** true: hata yokken de boş metre cetveli + "Hata Noktaları (0)" çizilir (boş durum yazısı yerine). */
  rulerAlways?: boolean;
}

interface RulerSectionProps {
  defectTypes: DefectType[];
  ownDefects: InspectionDefect[];
  priorDefects: InspectionPriorDefect[];
  maxMeter?: number;
  readOnly: boolean;
  onMarkerPress: (ids: string[]) => void;
  emptyText?: string;
  alwaysRuler: boolean;
}

// Kayıtlı hatalar — metre cetveli; tik'e dokun → o noktadaki hata(lar)ı sil.
function RulerSection({ defectTypes, ownDefects, priorDefects, maxMeter, readOnly, onMarkerPress, emptyText, alwaysRuler }: RulerSectionProps) {
  const critCount = ownDefects.reduce((n, d) => n + (isCriticalDefect(d, defectTypes) ? 1 : 0), 0);
  const allDefects = [...priorDefects, ...ownDefects];
  if (rulerSectionMode(allDefects.length, alwaysRuler) === 'empty') {
    return (
      <View style={styles.emptyDefects}>
        <Icon source="check-circle-outline" size={28} color={palette.slate[300]} />
        <Text style={styles.muted}>{emptyText ?? 'Henüz hata yok'}</Text>
      </View>
    );
  }
  return (
    <Surface style={styles.section} elevation={1} testID="inspection-ruler">
      <View style={styles.titleRow}>
        <Text style={styles.sectionTitle}>Hata Noktaları ({ownDefects.length})</Text>
        {priorDefects.length > 0 && (
          <View style={[styles.badge, styles.priorBadge]} testID="inspection-prior-badge">
            <Text style={[styles.badgeText, styles.priorBadgeText]}>önceki {priorDefects.length}</Text>
          </View>
        )}
        {critCount > 0 && (
          <View style={[styles.badge, styles.critBadge]}>
            <Text style={[styles.badgeText, styles.critBadgeText]}>{critCount} kritik</Text>
          </View>
        )}
        {priorDefects.length > 0 ? <PriorDefectList defects={priorDefects} inline /> : <View style={{ flex: 1 }} />}
        {!readOnly && ownDefects.length > 0 && <Text style={styles.hint}>tik'e dokun → sil</Text>}
      </View>
      <DefectRuler
        ownDefects={ownDefects}
        priorDefects={priorDefects}
        defectTypes={defectTypes}
        rulerMax={rulerMaxFor(maxMeter, allDefects)}
        onMarkerPress={readOnly ? undefined : onMarkerPress}
      />
    </Surface>
  );
}

// "Top beyandan uzun" — yalnız warn kipinde; block kipinde aşan metre zaten kayda gitmez.
function OverMaxRow({ meterInput, ownDefects, maxMeter }: { meterInput: string; ownDefects: InspectionDefect[]; maxMeter?: number }) {
  const text = overMaxWarning(meterInput, ownDefects, maxMeter);
  if (!text) return null;
  return (
    <View style={styles.overWarn} testID="inspection-over-max">
      <Icon source="alert-outline" size={16} color={palette.amber[700]} />
      <Text style={styles.overWarnText}>{text}</Text>
    </View>
  );
}

export default function InspectionPanel(props: InspectionPanelProps) {
  const { defectTypes, ownDefects, priorDefects = [], sizeClassMode = false, readOnly = false } = props;
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [pendingTypeId, setPendingTypeId] = useState<string | null>(null);
  // Silme modalı CANLI listeden çözülür; noktadaki hatalar bitince kapanır.
  const deleteDefects = deleteIds ? ownDefects.filter((d) => deleteIds.includes(d.id)) : [];
  useEffect(() => {
    if (deleteIds !== null && deleteDefects.length === 0) setDeleteIds(null);
  }, [deleteIds, deleteDefects.length]);

  const submit = (defectTypeId: string, sizeClass?: InspectionSizeClass) => {
    if (readOnly) return;
    // 4 puan muayenesi: metre boşsa kayıt konumsuz düşer (plan §4.1 md. 2).
    const unplaced = props.meterOptional === true && props.meterInput.trim() === '';
    const v = unplaced ? ({ ok: true, meter: null } as const) : validateDefectInput(props.meterInput, defectTypeId, ownDefects, validationMaxMeter(props.maxMeter, props.overMaxMode));
    if (!v.ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Toast.show({ type: 'error', text1: v.title, text2: v.detail });
      return;
    }
    props.onDefect(sizeClass ? { meter: v.meter, defectTypeId, sizeClass } : { meter: v.meter, defectTypeId });
  };
  const onTypePress = (defectTypeId: string) => {
    if (readOnly) return;
    // Sabit puanlı türde boyut sorulmaz: tek dokunuş kaydeder (plan §4.1 md. 2).
    const fixed = defectTypes.find((d) => d.id === defectTypeId)?.fixedPoints != null;
    if (sizeClassMode && !fixed) setPendingTypeId(defectTypeId);
    else submit(defectTypeId);
  };
  const onSizePick = (sizeClass: InspectionSizeClass) => {
    const typeId = pendingTypeId;
    setPendingTypeId(null);
    if (typeId) submit(typeId, sizeClass);
  };

  return (
    <>
      <View style={styles.rulerBlock}>
        <RulerSection
          defectTypes={defectTypes}
          ownDefects={ownDefects}
          priorDefects={priorDefects}
          maxMeter={props.maxMeter}
          readOnly={readOnly}
          onMarkerPress={setDeleteIds}
          emptyText={props.rulerEmptyText}
          alwaysRuler={props.rulerAlways === true}
        />
      </View>
      {props.entryAtBottom === true && <View style={styles.entrySpacer} testID="inspection-entry-spacer" />}
      {/* Giriş: metre gir → hata tipine bas → konak kaydeder (ayrı "Ekle" yok). */}
      <View style={[styles.entryFixed, props.entryAtBottom === true && styles.entryGrow]} testID="inspection-entry-block">
        {!readOnly && (
          <InspectionEntry
            defectTypes={defectTypes}
            meterInput={props.meterInput}
            onMeterChange={props.onMeterChange}
            compact={props.compact ?? false}
            pendingTypeId={pendingTypeId}
            onTypePress={onTypePress}
            onSizePick={onSizePick}
            onSizeCancel={() => setPendingTypeId(null)}
            sizeClassMode={sizeClassMode}
            meterAutoActivate={props.meterAutoActivate}
            meterOptional={props.meterOptional}
          />
        )}
        {props.overMaxMode === 'warn' && <OverMaxRow meterInput={props.meterInput} ownDefects={ownDefects} maxMeter={props.maxMeter} />}
        {props.summary && <InspectionSummaryStrip summary={props.summary} />}
        {props.children}
      </View>
      <DeletePointModal
        visible={deleteIds !== null}
        defects={deleteDefects}
        defectTypes={defectTypes}
        onDelete={props.onDelete}
        onDismiss={() => setDeleteIds(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  rulerBlock: { height: 112, paddingHorizontal: 8 },
  entryFixed: { paddingHorizontal: 8, gap: 10 },
  // flex:1 → flexShrink 1, flexBasis 0: yer yoksa 0'a iner, içerik itilmez.
  entrySpacer: { flex: 1, minHeight: 0 },
  // Boş dikey alanın ¾'ü giriş bloğuna; büyüyen ek yoksa blok yine alta yaslı kalır.
  entryGrow: { flexGrow: 3, justifyContent: 'flex-end' },
  section: { flex: 1, backgroundColor: palette.white, borderRadius: 12, padding: 14, gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: palette.slate[900] },
  muted: { fontSize: 12, color: palette.slate[400], fontStyle: 'italic' },
  emptyDefects: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hint: { fontSize: 10, color: palette.slate[400], fontStyle: 'italic' },
  badge: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: '800' },
  critBadge: { backgroundColor: palette.red[50], borderColor: palette.red[300] },
  critBadgeText: { color: palette.red[700], letterSpacing: 0.2 },
  priorBadge: { backgroundColor: palette.slate[100], borderColor: palette.slate[300] },
  priorBadgeText: { color: palette.slate[500] },
  overWarn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.amber[50], borderColor: palette.amber[300], borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  overWarnText: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: palette.amber[900] },
});
