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
import {
  isCriticalDefect,
  rulerMaxFor,
  validateDefectInput,
  type InspectionDefect,
  type InspectionDefectInput,
  type InspectionPriorDefect,
  type InspectionSizeClass,
} from './inspectionModel';

export {
  inspectionSaveErrorText,
  validateDefectInput,
  type InspectionDefect,
  type InspectionDefectInput,
  type InspectionPriorDefect,
  type InspectionSizeClass,
} from './inspectionModel';

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
  /** Telefonda yerel klavye (tablette ekran numpad'i). */
  compact?: boolean;
  /** Cetvel + girişin altına konak eki (ör. işlem paneli) — giriş bloğuyla aynı sütunda. */
  children?: React.ReactNode;
}

interface RulerSectionProps {
  defectTypes: DefectType[];
  ownDefects: InspectionDefect[];
  priorDefects: InspectionPriorDefect[];
  maxMeter?: number;
  readOnly: boolean;
  onMarkerPress: (ids: string[]) => void;
}

// Kayıtlı hatalar — metre cetveli; tik'e dokun → o noktadaki hata(lar)ı sil.
function RulerSection({ defectTypes, ownDefects, priorDefects, maxMeter, readOnly, onMarkerPress }: RulerSectionProps) {
  const critCount = ownDefects.reduce((n, d) => n + (isCriticalDefect(d, defectTypes) ? 1 : 0), 0);
  const allDefects = [...priorDefects, ...ownDefects];
  if (allDefects.length === 0) {
    return (
      <View style={styles.emptyDefects}>
        <Icon source="check-circle-outline" size={28} color={palette.slate[300]} />
        <Text style={styles.muted}>Henüz hata yok</Text>
      </View>
    );
  }
  return (
    <Surface style={styles.section} elevation={1}>
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
        <View style={{ flex: 1 }} />
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
    const v = validateDefectInput(props.meterInput, defectTypeId, ownDefects, props.maxMeter);
    if (!v.ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Toast.show({ type: 'error', text1: v.title, text2: v.detail });
      return;
    }
    props.onDefect(sizeClass ? { meter: v.meter, defectTypeId, sizeClass } : { meter: v.meter, defectTypeId });
  };
  const onTypePress = (defectTypeId: string) => {
    if (readOnly) return;
    if (sizeClassMode) setPendingTypeId(defectTypeId);
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
        />
      </View>
      {/* Giriş: metre gir → hata tipine bas → konak kaydeder (ayrı "Ekle" yok). */}
      <View style={styles.entryFixed}>
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
          />
        )}
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
});
