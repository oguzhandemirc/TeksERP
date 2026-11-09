// ③ Kurallar: tekrar eden bölüm (Hayır/Evet + başlangıç yazısına dokun), birden çok parti (Fabrika ayarı / Her parti ayrı İE /
// Tek İE → `rules.multiParty`; fabrika = alan yok), toplam satırı (dokun) ve gelen metre kaynağı (salt bilgi, sunucu önerisi).
import React from 'react';
import { View } from 'react-native';
import { Checkbox, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { INBOUND_DOC_SETTINGS_KEY, inboundDocService } from '../../../../services/inboundDoc.service';
import type { MultiPartyRule, ScanWord, SuggestResult } from '../../../../types/inboundDocTeach';
import { fieldLabel } from './fieldTargets';
import { ChoiceRow, Frame, TapRow, parts } from './stageParts';
import { hasTable, meterSourceText, multiPartyChoices, sectionPreviewText, type TapTarget } from './stages';
import { FIELD_OPTIONS, setRepeats, textOf, toggleSectionField, type TeachIssue, type TeachState } from './teachDraft';

interface Props {
  state: TeachState;
  words: readonly ScanWord[];
  onChange: (fn: (s: TeachState) => TeachState) => void;
  target: TapTarget;
  onTarget: (t: TapTarget) => void;
  preview: { result: SuggestResult | null; fresh: boolean };
  issues: readonly TeachIssue[];
}

export default function StageRules({ state, words, onChange, target, onTarget, preview, issues }: Props) {
  const settings = useQuery({ queryKey: INBOUND_DOC_SETTINGS_KEY, queryFn: () => inboundDocService.settings(), retry: false, staleTime: 60_000 });
  const factory: MultiPartyRule | undefined = settings.data?.multiPartyWorkOrder;
  const result = preview.fresh ? preview.result : null;
  return (
    <View style={parts.gap} testID="tanit-asama-3">
      <SectionRule state={state} words={words} onChange={onChange} target={target} onTarget={onTarget} result={result} />

      <Text style={parts.ask}>Birden çok parti gelirse</Text>
      <Frame testID="tanit-kural-cok-parti">
        {multiPartyChoices(factory).map((c) => (
          <ChoiceRow
            key={c.value ?? 'FACTORY'}
            label={c.label}
            hint={c.hint}
            checked={state.multiParty === c.value}
            onPress={() => onChange((s) => ({ ...s, multiParty: c.value }))}
            testID={`tanit-cok-parti-${c.value ?? 'FABRIKA'}`}
          />
        ))}
      </Frame>

      <Text style={parts.ask}>Toplam satırı</Text>
      <Frame testID="tanit-kural-toplam">
        <TapRow
          label="Toplam satırı"
          value={state.totalsLabel?.length ? textOf(words, state.totalsLabel) : null}
          placeholder={hasTable(state) ? 'Toplam satırının yazısına dokunun (ör. T.Adet)' : 'Önce ② Eşleme\'de top tablosu sütunlarını işaretleyin'}
          active={target?.kind === 'totals'}
          disabled={!hasTable(state)}
          onPress={() => onTarget({ kind: 'totals' })}
          onClear={() => onChange((s) => ({ ...s, totalsLabel: null }))}
          testID="tanit-toplam-satiri"
        />
      </Frame>
      {state.totalsLabel?.length && hasTable(state) ? <Text style={parts.info}>Gelen metre bu satırdan okunur.</Text> : null}

      <Text style={parts.info} testID="tanit-metre-kaynagi">{`Gelen metre kaynağı: ${meterSourceText(result) ?? 'önizleme bekleniyor'}`}</Text>
      {issues.map((i) => (
        <Text key={i.text} style={parts.warn} testID="tanit-kural-sorun">{`• ${i.text}`}</Text>
      ))}
    </View>
  );
}

function SectionRule({ state, words, onChange, target, onTarget, result }: Omit<Props, 'preview' | 'issues'> & { result: SuggestResult | null }) {
  const sectionText = sectionPreviewText(state, result);
  const assigned = FIELD_OPTIONS.filter((f) => state.fields[f.key]?.length);
  return (
    <>
      <Text style={parts.ask}>Belgede her parti ayrı blok mu?</Text>
      <Frame testID="tanit-kural-bolum">
        <ChoiceRow label="Hayır" hint="Belge tek parti anlatır" checked={!state.repeats} onPress={() => onChange((s) => setRepeats(s, false))} testID="tanit-tekrar-hayir" />
        <ChoiceRow
          label="Evet"
          hint="Bir kağıtta birden çok parti bloğu var"
          checked={state.repeats}
          onPress={() => {
            onChange((s) => setRepeats(s, true));
            onTarget({ kind: 'section' });
          }}
          testID="tanit-tekrar-evet"
        />
        {state.repeats && (
          <TapRow
            label="Bölüm başlangıcı"
            value={state.sectionStart.trim() || null}
            placeholder="Her bloğun başındaki yazıya dokunun"
            active={target?.kind === 'section'}
            onPress={() => onTarget({ kind: 'section' })}
            onClear={() => onChange((s) => ({ ...s, sectionStart: '', sectionWords: [] }))}
            testID="tanit-bolum-baslangic"
          />
        )}
        {state.repeats &&
          assigned.map((f) => (
            <Checkbox.Item
              key={f.key}
              label={`${fieldLabel(f.key)} her blokta ayrı okunur`}
              status={state.sectionFields.includes(f.key) ? 'checked' : 'unchecked'}
              onPress={() => onChange((s) => toggleSectionField(s, f.key))}
              mode="android"
              position="leading"
              labelStyle={parts.label}
              style={parts.row}
              testID={`tanit-bolum-alan-${f.key}`}
            />
          ))}
      </Frame>
      {sectionText && <Text style={parts.info} testID="tanit-bolum-onizleme">{sectionText}</Text>}
    </>
  );
}
