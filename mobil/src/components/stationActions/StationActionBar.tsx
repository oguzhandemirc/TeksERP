// İstasyon ekranlarının telefon/el terminali 2. kat aksiyon çubuğu (ScreenChrome `secondRow`).
// Tek dizi → çubuk + "Diğer" menüsü; yerleşim kararı saf `layoutStationActions`ta.
// Geniş (≥600 dp, yatay telefon) bugünkü düzen: hepsi satırda, eşit paylaşımlı.
import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet from '../ModuleSheet';
import { colors, palette } from '../../theme';
import { layoutStationActions, overflowHasBadge, type StationAction } from './stationActionLayout';

function Badge({ count }: { count: number }) {
  return (
    <View style={styles.badge} pointerEvents="none">
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

function BarChip({
  icon,
  label,
  count,
  onPress,
  active,
  stacked,
  badge,
  dot,
  testID,
}: {
  icon: string;
  label: string;
  count?: number;
  onPress: () => void;
  active?: boolean;
  stacked: boolean;
  badge?: number;
  dot?: boolean;
  testID: string;
}) {
  return (
    <View style={styles.chipWrap}>
      <TouchableRipple
        onPress={onPress}
        style={[styles.chip, active && styles.chipOn]}
        borderless
        rippleColor={active ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.2)'}
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={active === undefined ? undefined : { selected: active }}
        testID={testID}
      >
        <View style={stacked ? styles.innerStacked : styles.innerRow}>
          {/* Dar düzende sayaç ikon yuvasına geçer: etiket tek satır kalır, düğmeler eşit yükseklikte (saha 2026-11-10). */}
          {stacked && count !== undefined ? (
            <Text style={[styles.countText, active && styles.textOn]} testID={`${testID}-count`}>
              {count}
            </Text>
          ) : (
            <Icon source={icon} size={stacked ? 20 : 18} color={active ? palette.amber[900] : colors.textOnDark} />
          )}
          {/* Dar düzende her düğme SABİT yükseklik: etiket tek satır, sığmazsa küçülür (kesilmez, sarmaz) — saha 2026-11-10. */}
          <Text
            style={[styles.text, stacked && styles.textStacked, active && styles.textOn]}
            numberOfLines={1}
            adjustsFontSizeToFit={stacked}
            minimumFontScale={0.7}
          >
            {stacked || count === undefined ? label : `${label} · ${count}`}
          </Text>
        </View>
      </TouchableRipple>
      {(badge ?? 0) > 0 && <Badge count={badge as number} />}
      {dot && <View style={styles.dot} pointerEvents="none" testID={`${testID}-dot`} />}
    </View>
  );
}

export interface StationActionBarProps {
  actions: readonly StationAction[];
  /** testID öneki (sürücü/test); varsayılan "station-bar". */
  testIDPrefix?: string;
}

export default function StationActionBar({ actions, testIDPrefix = 'station-bar' }: StationActionBarProps) {
  const { width } = useWindowDimensions();
  const [moreOpen, setMoreOpen] = useState(false);
  const { narrow, inline, overflow } = layoutStationActions(actions, width);

  return (
    <>
      {inline.map((a) => (
        <BarChip
          key={a.id}
          icon={a.icon}
          label={a.label}
          count={a.count}
          onPress={a.onPress}
          active={a.active}
          stacked={narrow}
          badge={a.badge}
          testID={`${testIDPrefix}-${a.id}`}
        />
      ))}
      {overflow.length > 0 && (
        <BarChip
          icon="dots-horizontal"
          label="Diğer"
          onPress={() => setMoreOpen(true)}
          stacked={narrow}
          dot={overflowHasBadge(overflow)}
          testID={`${testIDPrefix}-more`}
        />
      )}
      {overflow.length > 0 && (
        <ModuleSheet
          visible={moreOpen}
          onDismiss={() => setMoreOpen(false)}
          title="Diğer işlemler"
          size="sm"
          footer={
            <Button mode="outlined" onPress={() => setMoreOpen(false)} testID={`${testIDPrefix}-more-cancel`}>
              Vazgeç
            </Button>
          }
        >
          {overflow.map((a) => (
            <TouchableRipple
              key={a.id}
              onPress={() => {
                setMoreOpen(false);
                a.onPress();
              }}
              style={[styles.menuRow, a.active && styles.menuRowOn]}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              testID={`${testIDPrefix}-menu-${a.id}`}
            >
              <View style={styles.menuRowInner}>
                <Icon source={a.icon} size={24} color={a.active ? palette.amber[900] : palette.slate[700]} />
                <Text style={styles.menuRowText}>{a.count === undefined ? a.label : `${a.label} · ${a.count}`}</Text>
                {(a.badge ?? 0) > 0 && (
                  <View style={styles.menuBadge}>
                    <Text style={styles.badgeText}>{a.badge}</Text>
                  </View>
                )}
              </View>
            </TouchableRipple>
          ))}
        </ModuleSheet>
      )}
    </>
  );
}

/** Dar düzen düğme yüksekliği = dikey dolgu 2×6 + ikon/sayı 20 + aralık 2 + tek satır etiket 16 (+ 6 pay); hepsi eşit. */
const STACKED_CHIP_HEIGHT = 62;

const styles = StyleSheet.create({
  chipWrap: { flex: 1 },
  chip: {
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  chipOn: { backgroundColor: colors.warning, borderColor: palette.amber[300] },
  innerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  innerStacked: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 6,
    height: STACKED_CHIP_HEIGHT,
  },
  text: { color: colors.textOnDark, fontWeight: '700', fontSize: 13 },
  textStacked: { textAlign: 'center', lineHeight: 16 },
  countText: { color: colors.textOnDark, fontWeight: '800', fontSize: 17, lineHeight: 20 },
  textOn: { color: palette.amber[900], fontWeight: '800' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: palette.red[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.textOnDark, fontSize: 11, fontWeight: '800' },
  dot: {
    position: 'absolute',
    top: 2,
    right: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.red[600],
  },
  menuRow: { minHeight: 56, borderRadius: 10, justifyContent: 'center' },
  menuRowOn: { backgroundColor: colors.warningContainer },
  menuRowInner: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 8, paddingVertical: 10 },
  menuRowText: { flex: 1, fontSize: 17, color: colors.text, fontWeight: '600' },
  menuBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: palette.red[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
