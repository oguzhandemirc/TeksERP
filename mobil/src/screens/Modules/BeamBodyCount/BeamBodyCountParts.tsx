// =============================================================================
// GÖVDE SAYIMI — görünüm parçaları (tablet tasarım dili, Tambur referansı)
// =============================================================================
// SOL: kapsam + kahraman sayı "okunan / beklenen" + okut/yaz · SAĞ: fark sekmeleri (başka yerde · tanımsız · eksik ·
// okunan) ve satır başına önerilen düzeltme. Renk yalnız anlam için: yeşil tamam, turuncu dikkat, kırmızı tanımsız.
// =============================================================================
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text, TouchableRipple, Icon } from 'react-native-paper';
import PickerModal from '../../../components/PickerModal';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import TruncatedText from '../../../components/TruncatedText';
import { colors, palette, spacing } from '../../../theme';
import type { CountLine } from '../../../services/beamBodyCount.service';
import { ds, MAIN_BLUE } from '../DevereKabul/devereKabul.styles';
import { heroFigure, linesFor, scopeLabel, scopeOptions, tabCounts, type CountTab } from './beamBodyCount';
import type { BeamBodyCountState } from './useBeamBodyCount';

export function ScopePicker({ s, visible, onClose }: { s: BeamBodyCountState; visible: boolean; onClose: () => void }) {
  return (
    <PickerModal
      visible={visible}
      title="Nerede sayıyorsunuz?"
      wrapLabels
      numColumns={2}
      options={scopeOptions(s.context.data)}
      selectedValue={s.scopeKey}
      loading={s.context.isLoading}
      emptyText="Depo ya da devereci bulunamadı — Yenile'ye basın."
      onDismiss={onClose}
      onSelect={(v) => { s.setScopeKey(v); onClose(); }}
    />
  );
}

/** SOL üst: kapsam (dokununca değişir) + kahraman sayı. */
export function ScopeCard({ s, onPickScope }: { s: BeamBodyCountState; onPickScope: () => void }) {
  const hero = heroFigure(s.data);
  const c = tabCounts(s.data);
  return (
    <View style={ds.card}>
      <Text style={ds.caps}>SAYILAN YER</Text>
      <TouchableRipple onPress={onPickScope} accessibilityRole="button" accessibilityLabel="Sayılan yeri değiştir" testID="govde-sayim-kapsam">
        <View style={ds.row}>
          <TruncatedText style={[ds.bigName, ds.grow]}>{scopeLabel(s.scopeKey, s.context.data)}</TruncatedText>
          <Icon source="swap-horizontal" size={28} color={MAIN_BLUE} />
        </View>
      </TouchableRipple>
      <View style={ds.rowBottom}>
        <View style={[ds.hero, styles.hero, hero.done ? null : c.unexpected + c.unknown > 0 ? ds.heroOver : styles.heroWait]}>
          <Text style={ds.heroValue} testID="govde-sayim-kahraman">{hero.value}</Text>
          <Text style={ds.heroUnit}>{hero.done ? 'tamam — fark yok' : hero.unit}</Text>
        </View>
        <View style={[ds.grow, styles.stats]}>
          <Text style={ds.gray}>{`${s.codes.length} okutma`}</Text>
          {s.preview.isFetching ? <Text style={ds.gray}>Karşılaştırılıyor…</Text> : null}
          {s.preview.isError ? <Text style={styles.danger}>Karşılaştırılamadı — ağ ya da yetki. Yenileyin.</Text> : null}
        </View>
      </View>
    </View>
  );
}

/** SOL alt: okut (el terminali tetik / kamera) ya da elle yaz. */
export function ScanCard({ s, code, setCode, onCamera }: { s: BeamBodyCountState; code: string; setCode: (v: string) => void; onCamera: () => void }) {
  return (
    <View style={ds.card}>
      <Text style={ds.cardTitle}>Gövde okut</Text>
      <ScannerEntryBar value={code} onChangeText={setCode} placeholder="Gövde QR / no okut-yaz…" onResolve={() => { s.scan(code); setCode(''); }} onScan={s.isOnline ? onCamera : undefined} scanCtaLabel="GÖVDE QR OKUT" tone="blue" hardwareListening />
      <Text style={ds.hint}>Sayım kaydı tutulmaz; fark satırındaki öneriyle düzeltilir.</Text>
    </View>
  );
}

const TABS: { key: CountTab; label: string; tone: string }[] = [
  { key: 'unexpected', label: 'Başka yerde', tone: palette.orange[800] },
  { key: 'unknown', label: 'Tanımsız', tone: colors.dangerText },
  { key: 'missing', label: 'Eksik', tone: palette.orange[800] },
  { key: 'matched', label: 'Okunan', tone: palette.emerald[700] },
];

function Tabs({ s }: { s: BeamBodyCountState }) {
  const c = tabCounts(s.data);
  return (
    <View style={styles.tabs}>
      {TABS.map((t) => {
        const on = s.tab === t.key;
        return (
          <TouchableRipple key={t.key} onPress={() => s.pickTab(t.key)} style={[styles.tab, on ? styles.tabOn : null]} accessibilityRole="button" accessibilityState={{ selected: on }} testID={`govde-sayim-sekme-${t.key}`}>
            <Text style={[styles.tabText, { color: c[t.key] ? t.tone : colors.textSecondary }, on ? styles.tabTextOn : null]}>{`${t.label} ${c[t.key]}`}</Text>
          </TouchableRipple>
        );
      })}
    </View>
  );
}

function LineRow({ line, tab, canFix, busy, onFix }: { line: CountLine; tab: CountTab; canFix: boolean; busy: boolean; onFix: (l: CountLine) => void }) {
  const sub = tab === 'matched' ? `${line.placeLabel} · ${line.statusLabel}` : `Kayıtta: ${line.placeLabel} · ${line.statusLabel}`;
  return (
    <View style={ds.lineRow}>
      <View style={ds.grow}>
        <TruncatedText style={ds.lineName}>{line.bodyNo}</TruncatedText>
        <Text style={ds.lineSub}>{line.matchedBy === 'NORMALIZED' ? `${sub} · "${line.code}" olarak okundu` : sub}</Text>
        {line.suggestion && !canFix ? <Text style={ds.lineSub}>{`Öneri: ${line.suggestion.label} (panelde Levent Gövdeleri)`}</Text> : null}
      </View>
      {line.suggestion && canFix ? (
        <TouchableRipple onPress={() => onFix(line)} disabled={busy} style={ds.rowBtnOrange} accessibilityRole="button" accessibilityLabel={`${line.bodyNo} ${line.suggestion.label}`} testID={`govde-sayim-duzelt-${line.bodyNo}`}>
          <View style={ds.row}>
            <Icon source="wrench-outline" size={22} color={palette.orange[800]} />
            <Text style={ds.rowBtnOrangeText}>{line.suggestion.label}</Text>
          </View>
        </TouchableRipple>
      ) : null}
    </View>
  );
}

/** SAĞ: fark sekmeleri + liste. */
export function DiffCard({ s, canFix }: { s: BeamBodyCountState; canFix: boolean }) {
  const lines = linesFor(s.tab, s.data);
  const unknown = s.tab === 'unknown' ? s.data?.unknown ?? [] : [];
  const empty = lines.length === 0 && unknown.length === 0;
  return (
    <View style={[ds.card, ds.grow]}>
      <Tabs s={s} />
      {empty ? <Text style={ds.hint}>{s.codes.length === 0 && s.tab !== 'missing' ? 'Gövdeleri okutun — farklar burada çıkar.' : 'Bu listede gövde yok.'}</Text> : null}
      <ScrollView>
        {lines.map((l) => <LineRow key={l.id} line={l} tab={s.tab} canFix={canFix} busy={s.previewFix.isPending || s.applyFix.isPending} onFix={(x) => s.previewFix.mutate(x)} />)}
        {unknown.map((u) => (
          <View key={u.code} style={ds.lineRow}>
            <View style={ds.grow}>
              <TruncatedText style={ds.lineName}>{u.code}</TruncatedText>
              <Text style={ds.lineSub}>{u.candidates.length ? `Birden çok gövdeye uyuyor: ${u.candidates.join(', ')} — no'yu tam yazın` : 'Sistemde böyle bir gövde yok — panelde tanımlanır'}</Text>
            </View>
            <TouchableRipple onPress={() => s.removeCode(u.code)} style={[ds.squareBtn, styles.squareRed]} accessibilityRole="button" accessibilityLabel={`${u.code} okutmasını sil`}>
              <Icon source="close" size={24} color={colors.dangerText} />
            </TouchableRipple>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { minWidth: 200 },
  heroWait: { backgroundColor: MAIN_BLUE },
  stats: { gap: spacing.xs, justifyContent: 'flex-end' },
  danger: { color: colors.dangerText },
  tabs: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  tab: { minHeight: 52, paddingHorizontal: spacing.md, borderRadius: 12, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tabOn: { borderWidth: 2, borderColor: palette.blue[700], backgroundColor: palette.blue[50] },
  tabText: { fontSize: 16, fontWeight: '700' },
  tabTextOn: { fontWeight: '900' },
  squareRed: { backgroundColor: palette.red[50] },
});
