// Etkileşimli metre cetveli — Tambur'un DefectRuler'ıyla aynı görsel dil (0→top
// boyu, tik/küme, kritik=kırmızı). Bu adımın işaretleri dokunulabilir (silme);
// önceki adımlarınki açık gri, dokunulmaz.
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { palette } from '../../theme/tokens';
import type { DefectType } from '../../types/models';
import {
  buildRulerMarkers,
  fmtMeter,
  type InspectionDefect,
  type InspectionPriorDefect,
  type RulerMarker,
} from './inspectionModel';

interface DefectRulerProps {
  ownDefects: InspectionDefect[];
  priorDefects: InspectionPriorDefect[];
  defectTypes: DefectType[];
  rulerMax: number;
  onMarkerPress?: (defectIds: string[]) => void;
}

function MarkerGlyph({ m }: { m: RulerMarker }) {
  const crit = m.critical && !m.prior;
  if (m.defects.length > 1) {
    return (
      <View style={[styles.cluster, crit && styles.critBg, m.prior && styles.priorBg]}>
        <Text style={styles.clusterText}>{m.defects.length}</Text>
      </View>
    );
  }
  return <View style={[styles.tick, crit && styles.critBg, m.prior && styles.priorBg]} />;
}

function MarkerHit({ m, w, onMarkerPress }: { m: RulerMarker; w: number; onMarkerPress?: (ids: string[]) => void }) {
  const pos = { left: Math.max(0, Math.min(m.x - 14, w - 28)) };
  if (m.prior || !onMarkerPress) {
    return (
      <View style={[styles.hit, pos]} accessibilityLabel={`${m.label} metre önceki hata`}>
        <MarkerGlyph m={m} />
      </View>
    );
  }
  return (
    <TouchableRipple
      borderless
      onPress={() => onMarkerPress(m.defects.map((d) => d.id))}
      style={[styles.hit, pos]}
      accessibilityLabel={`${m.label} metre hata — sil`}
    >
      <MarkerGlyph m={m} />
    </TouchableRipple>
  );
}

export default function DefectRuler({ ownDefects, priorDefects, defectTypes, rulerMax, onMarkerPress }: DefectRulerProps) {
  const [w, setW] = useState(0);
  const markers = useMemo(
    () => buildRulerMarkers(ownDefects, priorDefects, { width: w, rulerMax, defectTypes }),
    [ownDefects, priorDefects, w, rulerMax, defectTypes],
  );

  return (
    <View style={styles.wrap} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <View style={styles.track} />
      {w > 0 && (
        <>
          <View style={[styles.scaleTick, { left: 0 }]} />
          <View style={[styles.scaleTick, { left: w - 1 }]} />
          <Text style={[styles.endLabel, styles.endLabelLeft]}>0</Text>
          <Text style={[styles.endLabel, styles.endLabelRight]}>{fmtMeter(rulerMax)} m</Text>
        </>
      )}
      {markers.map((m, i) =>
        m.showLabel ? (
          <Text
            key={`l${i}`}
            style={[
              styles.label,
              m.critical && !m.prior && styles.labelCritical,
              m.prior && styles.labelPrior,
              { left: Math.max(0, Math.min(m.x - 19, w - 38)) },
            ]}
            numberOfLines={1}
          >
            {m.label}
          </Text>
        ) : null,
      )}
      {markers.map((m, i) => (
        <MarkerHit key={i} m={m} w={w} onMarkerPress={onMarkerPress} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 54, justifyContent: 'center', marginTop: 2 },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 26,
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.slate[200],
  },
  hit: {
    position: 'absolute',
    top: 12,
    height: 34,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  tick: { width: 4, height: 18, borderRadius: 2, backgroundColor: palette.slate[400] },
  critBg: { backgroundColor: palette.red[600] },
  priorBg: { backgroundColor: palette.slate[300] },
  cluster: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 4,
    backgroundColor: palette.slate[400],
    borderWidth: 2,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterText: { fontSize: 11, fontWeight: '800', color: palette.white },
  label: {
    position: 'absolute',
    top: 0,
    width: 38,
    textAlign: 'center',
    fontSize: 9.5,
    lineHeight: 12,
    color: palette.slate[600],
    fontWeight: '700',
  },
  labelCritical: { color: palette.red[600] },
  labelPrior: { color: palette.slate[400] },
  scaleTick: { position: 'absolute', top: 29, width: 1, height: 6, backgroundColor: palette.slate[300] },
  endLabel: { position: 'absolute', bottom: 0, fontSize: 10, color: palette.slate[500], fontWeight: '700' },
  endLabelLeft: { left: 0 },
  endLabelRight: { right: 0 },
});
