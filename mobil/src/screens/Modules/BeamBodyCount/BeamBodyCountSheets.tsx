// =============================================================================
// GÖVDE SAYIMI — onay kartları (`ModuleSheet`): satır düzeltmesi (elle geçiş önizlemesi) · sayımı bitir (özet)
// =============================================================================
// Düzeltme gövde durumunu yazar (geri alınabilir: panel › Levent Gövdeleri › geçmiş); sayım bitişi hiçbir şey yazmaz.
// =============================================================================
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import StationActionButton from '../../../components/StationActionButton';
import { palette, spacing } from '../../../theme';
import type { CountPreview } from '../../../services/beamBodyCount.service';
import { MAIN_BLUE } from '../DevereKabul/devereKabul.styles';
import { tabCounts } from './beamBodyCount';
import type { FixDraft } from './useBeamBodyCount';

export function FixSheet({ draft, pending, isOnline, onApply, onBack }: { draft: FixDraft; pending: boolean; isOnline: boolean; onApply: () => void; onBack: () => void }) {
  const { line, plan } = draft;
  return (
    <ModuleSheet
      visible
      onDismiss={onBack}
      title={`${line.bodyNo} — ${plan.kindLabel}`}
      subtitle={`Şu an "${plan.body.statusLabel}" → "${plan.toLabel}" olacak. Yanlışsa panelde Levent Gövdeleri › geçmişten geri alınır.`}
      footer={<Button onPress={onBack} disabled={pending}>Vazgeç</Button>}
    >
      <View style={sheet.box}>
        <View style={sheet.summaryRow}><Text style={sheet.summaryLabel}>Kayıttaki yer</Text><Text style={sheet.summaryValue}>{line.placeLabel}</Text></View>
        {line.code ? <View style={sheet.summaryRow}><Text style={sheet.summaryLabel}>Okunan</Text><Text style={sheet.summaryValue}>{line.code}</Text></View> : null}
      </View>
      {plan.warnings.map((w) => <Text key={w} style={sheet.warn}>{w}</Text>)}
      <View style={styles.action}>
        <StationActionButton label={`KAYDET — ${plan.kindLabel}`} icon="check" onPress={onApply} tint={MAIN_BLUE} loading={pending} loadingLabel="Kaydediliyor…" disabled={!isOnline} large testID="govde-sayim-duzelt-kaydet" />
      </View>
    </ModuleSheet>
  );
}

export function FinishSheet({ preview, scope, codeCount, onNew, onBack }: { preview: CountPreview | undefined; scope: string; codeCount: number; onNew: () => void; onBack: () => void }) {
  const c = tabCounts(preview);
  const rows: [string, string, boolean][] = [
    ['Okunan / beklenen', `${c.matched} / ${preview?.expectedCount ?? 0}`, false],
    ['Eksik (okunmadı)', String(c.missing), c.missing > 0],
    ['Başka yerde kayıtlı', String(c.unexpected), c.unexpected > 0],
    ['Tanımsız okutma', String(c.unknown), c.unknown > 0],
  ];
  return (
    <ModuleSheet
      visible
      onDismiss={onBack}
      title={`Sayım özeti — ${scope}`}
      subtitle={`${codeCount} okutma. Sayım kaydı tutulmaz; farklar satırdaki öneriyle ya da panelden düzeltilir.`}
      footer={<Button onPress={onBack}>Saymaya devam et</Button>}
    >
      <View style={sheet.box}>
        {rows.map(([k, v, warn]) => (
          <View key={k} style={sheet.summaryRow}>
            <Text style={sheet.summaryLabel}>{k}</Text>
            <Text style={[sheet.summaryValue, warn ? styles.warn : null]}>{v}</Text>
          </View>
        ))}
      </View>
      <View style={styles.action}>
        <StationActionButton label="YENİ SAYIM — okutmaları temizle" icon="restart" onPress={onNew} tint={palette.emerald[700]} large testID="govde-sayim-yeni" />
      </View>
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: spacing.md },
  warn: { color: palette.orange[800] },
});
