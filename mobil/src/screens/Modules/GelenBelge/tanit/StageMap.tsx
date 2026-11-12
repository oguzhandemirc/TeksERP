// ② Eşleme: belge alanı → iş emri karşılığı. Satıra dokun, sonra belgede değere dokun. Gruplar çerçeveyle ayrılır (Kimlik ·
// Gelen · Hedef · Ürün), kalanlar "Diğer alanlar" altında; belgede top tablosu varsa sütun başlıkları son çerçevede. Düzenle
// kipinde önceki tanımdan gelen alan "Kaldır" ile `base.drop`a girer.
import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { DocHighlight } from '../../../../components/DocHighlight';
import { colors } from '../../../../theme';
import type { ScanWord, SuggestResult } from '../../../../types/inboundDocTeach';
import { fieldLabel } from './fieldTargets';
import { fieldReadout } from './guided';
import { Frame, TapRow, parts } from './stageParts';
import { dropKept, mapGroups, undoDrop, type TapTarget } from './stages';
import { clearColumn, clearField, COLUMN_OPTIONS, isKept, textOf, type FieldKey, type TeachIssue, type TeachState } from './teachDraft';

type Preview = { result: SuggestResult | null; fresh: boolean; error: string | null; blocked?: string | null };

interface Props {
  state: TeachState;
  words: readonly ScanWord[];
  onChange: (fn: (s: TeachState) => TeachState) => void;
  target: TapTarget;
  onTarget: (t: TapTarget) => void;
  preview: Preview;
  issues: readonly TeachIssue[];
}

type RowStatus = 'done' | 'kept' | 'dropped' | 'todo';
const STATUS_TEXT: Record<RowStatus, string> = { done: 'işaretli', kept: 'önceki tanımdan', dropped: 'kaldırılacak', todo: 'atanmadı' };

function rowStatus(s: TeachState, k: FieldKey): RowStatus {
  if (s.fields[k]?.length) return 'done';
  if (s.drop.includes(k) && s.kept.includes(k)) return 'dropped';
  return isKept(s, k) ? 'kept' : 'todo';
}

export default function StageMap({ state, words, onChange, target, onTarget, preview, issues }: Props) {
  const [more, setMore] = useState(false);
  const activeField = target?.kind === 'field' ? target.key : null;
  const { groups, more: hidden } = mapGroups(state, activeField);
  const row = (k: FieldKey) => <MapRow key={k} k={k} state={state} active={activeField === k} preview={preview} onChange={onChange} onSelect={() => onTarget({ kind: 'field', key: k })} />;
  return (
    <View style={parts.gap} testID="tanit-asama-2">
      <Text style={parts.ask} testID="tanit-soru">{activeField ? `${fieldLabel(activeField)}: belgede değerine dokunun` : 'Bir satır seçin, sonra belgede değerine dokunun'}</Text>
      <Text style={parts.info}>Yalnız değere dokunun; etiketi kendiliğinden bulunur. Belgede olmayan alanı boş bırakın.</Text>
      <View style={parts.gap} testID="tanit-alanlar">
        {groups.map((g) => (
          <Frame key={g.group} testID={`tanit-grup-${g.group}`}>
            {g.keys.map(row)}
          </Frame>
        ))}
        {hidden.length > 0 && (
          <Frame>
            <TouchableRipple onPress={() => setMore((m) => !m)} accessibilityRole="button" accessibilityState={{ expanded: more }} style={parts.row} testID="tanit-diger-alanlar">
              <View style={parts.rowInner}>
                <Icon source={more ? 'chevron-up' : 'chevron-down'} size={24} color={colors.textSecondary} />
                <Text style={[parts.label, parts.flex]}>{`Diğer alanlar (${hidden.length})`}</Text>
              </View>
            </TouchableRipple>
            {more && hidden.map(row)}
          </Frame>
        )}
        <Frame testID="tanit-tablo">
          <View style={parts.row}>
            <Text style={parts.bold}>Top tablosu (isteğe bağlı)</Text>
            <Text style={parts.info}>Belgede top listesi varsa sütun başlığına dokunun.</Text>
          </View>
          {COLUMN_OPTIONS.map((c) => (
            <TapRow
              key={c.key}
              label={`Sütun: ${c.label}`}
              value={state.columns[c.key]?.length ? textOf(words, state.columns[c.key]!) : null}
              placeholder="Başlığa dokunun"
              active={target?.kind === 'column' && target.key === c.key}
              onPress={() => onTarget({ kind: 'column', key: c.key })}
              onClear={() => onChange((s) => clearColumn(s, c.key))}
              testID={`tanit-sutun-${c.key}`}
            />
          ))}
        </Frame>
      </View>
      {issues.map((i) => (
        <Text key={i.text} style={parts.warn} testID="tanit-esleme-sorun">{`• ${i.text}`}</Text>
      ))}
    </View>
  );
}

function MapRow({ k, state, active, preview, onChange, onSelect }: { k: FieldKey; state: TeachState; active: boolean; preview: Preview; onChange: Props['onChange']; onSelect: () => void }) {
  const status = rowStatus(state, k);
  const label = fieldLabel(k);
  const r = fieldReadout(state, k, preview);
  const value = r.kind === 'ok' ? r.value : null;
  const icon = status === 'done' || status === 'kept' ? 'check-circle' : status === 'dropped' ? 'minus-circle-outline' : 'circle-outline';
  return (
    <View>
      <TouchableRipple
        onPress={onSelect}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${STATUS_TEXT[status]}`}
        accessibilityState={{ selected: active }}
        style={[parts.row, active && parts.rowSelected]}
        testID={`tanit-adim-${k}`}
      >
        <View style={parts.rowInner}>
          <Icon source={icon} size={24} color={status === 'done' || status === 'kept' ? colors.success : colors.textMuted} />
          <Text style={[parts.label, parts.fixed, active && parts.bold]}>{label}</Text>
          <View style={parts.flex}>
            {value && status !== 'dropped' ? (
              <DocHighlight active style={{ alignSelf: 'flex-start' }}>
                <Text style={parts.value} testID={`tanit-deger-${k}`}>{value}</Text>
              </DocHighlight>
            ) : status === 'dropped' ? (
              <Text style={parts.placeholder}>Kaydedince kaldırılacak</Text>
            ) : status === 'todo' ? (
              <Text style={parts.placeholder}>Ata</Text>
            ) : null}
            {status === 'kept' && <Text style={parts.hint} testID={`tanit-onceki-${k}`}>Önceki tanımdan</Text>}
          </View>
          {status === 'kept' && (
            <Button mode="text" compact onPress={() => onChange((s) => dropKept(s, k))} contentStyle={parts.btn} testID={`tanit-kaldir-${k}`}>
              Kaldır
            </Button>
          )}
          {status === 'dropped' && (
            <Button mode="text" compact onPress={() => onChange((s) => undoDrop(s, k))} contentStyle={parts.btn} testID={`tanit-geri-al-${k}`}>
              Geri al
            </Button>
          )}
          {status === 'done' && active && (
            <IconButton icon="close" size={24} style={parts.iconBtn} onPress={() => onChange((s) => clearField(s, k))} accessibilityLabel={`${label} işaretini kaldır`} testID="tanit-etiket-degistir" />
          )}
        </View>
      </TouchableRipple>
      {active && <Readout r={r} />}
    </View>
  );
}

function Readout({ r }: { r: ReturnType<typeof fieldReadout> }) {
  const text =
    r.kind === 'idle' ? 'Belgede bu alanın değerine dokunun.'
    : r.kind === 'loading' ? 'Okunuyor…'
    : r.kind === 'ok' ? (r.kept ? 'Kayıtlı — değiştirmek için yeni değere dokunun.' : r.label ? `Etiket: “${r.label}”` : 'Etiket yok; konumundan okunur.')
    : r.kind === 'empty' ? 'Değer okunamadı — başka bir kutuya dokunun.'
    : r.text;
  const warn = r.kind === 'empty' || r.kind === 'error';
  return (
    <View style={[parts.row, { backgroundColor: warn ? colors.warningContainer : colors.surfaceSunken }]} testID="tanit-okunan">
      <Text style={warn ? parts.warn : parts.info}>{text}</Text>
    </View>
  );
}
