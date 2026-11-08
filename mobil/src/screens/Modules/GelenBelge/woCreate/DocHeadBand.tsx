// Belge satırının başı. Toplu liste: "Belge GB…" şeridi + okuma hapı, altında eylem satırı. Tek İE formu: TEK satır — belge no +
// durum ikonu (sorun varsa kısa yazı), sağda Yeniden okut / Taslağı iptal et ikonları. İkisinde de tanıtılmamış şeridi ve kısa
// eylemli iletiler (`docReadNotice`) altta; şablon düzeltmek okuma düzeltmesidir → okuma durumunun yanında durur.
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button, Icon, IconButton, Text } from 'react-native-paper';
import { NoticeStrip } from '../../../../components/form/NoticeStrip';
import { SectionBand } from '../../../../components/form/SectionBand';
import type { BandTone, PillTone } from '../../../../components/form/tone';
import type { PickerOption } from '../../../../components/PickerModal';
import { colors, radius, spacing, typography } from '../../../../theme';
import CancelDraftButton from '../CancelDraftButton';
import { TeachStrip, TemplateName, TemplateUpdateButton } from '../tanit/TeachBanner';
import { useTeachEntry } from '../tanit/useTeachEntry';
import type { useReadResult } from '../useReadResult';
import { docReadNotices, docReadPill, type DocNotice } from './docReadNotice';
import type { DocRow, WoRowsState } from './useWoRows';

export type DocRowVariant = 'list' | 'single';

interface Props {
  row: DocRow;
  wo: WoRowsState;
  read: ReturnType<typeof useReadResult>;
  detailFailed: boolean;
  variant: DocRowVariant;
  /** Tek formda "Yeniden okut": satır kalkar, tarayıcı yeniden açılır. */
  onReread?: () => void;
  /** Belgesiz taslak: sayfa yokken "Belgesiz — elle giriş", iletiler susar, düğme "Belge ekle" (aynı taslağa sayfa). */
  manual?: boolean;
  /** "Taslağı iptal et" başarılı; verilmezse satır listeden kalkar. */
  onDraftCancelled?: () => void;
  customers: readonly PickerOption[];
}

const PILL_COLOR: Record<PillTone, string> = {
  ok: colors.successText, warn: colors.warningText, missing: colors.dangerText, idle: colors.textSecondary, info: colors.textSecondary, busy: colors.textSecondary,
};

const BAND_TONE: Record<PillTone, BandTone> = { ok: 'ok', warn: 'warn', missing: 'missing', idle: 'idle', info: 'idle', busy: 'idle' };

/** Formda belgeden gelen bir değer var mı: satırsız okumada "bilgi çıkmadı" iletisini susturur. */
const formFilled = (row: DocRow) => {
  const f = row.form;
  return !!f && !!(f.ownerCustomerId || f.ownerSuggested || f.customerBatchNo || f.ourBatchNo || f.meters != null || f.multi || f.rolls);
};

export default function DocHeadBand({ row, wo, read, detailFailed, variant, onReread, manual = false, onDraftCancelled, customers }: Props) {
  const single = variant === 'single';
  const no = row.noteNo;
  const done = row.result?.kind === 'OPENED' || row.result?.kind === 'DRAFT';
  // Onaylanmamış belge sunucuda hâlâ taslaktır ("taslak olarak kaydedildi" dahil); onaylı belge yalnız panelde İPTAL edilir.
  const cancellable = row.result?.kind !== 'OPENED';
  const w = read.watch;
  const input = { watch: w, formFilled: formFilled(row), detailFailed };
  const noPages = manual && w?.phase === 'done' && w.summary.state === 'NO_PAGES';
  const pill = noPages ? { tone: 'idle' as PillTone, icon: 'information-outline' as const, text: 'Belgesiz — elle giriş' } : docReadPill(input);
  const notices = done || noPages ? [] : docReadNotices(input);
  const teach = useTeachEntry({ row, wo, tanitim: w?.phase === 'done' ? w.summary.tanitim : undefined, customers });
  const act = (n: DocNotice) => {
    if (n.action === 'recheck') return { label: 'Yeniden bak', icon: 'refresh' as const, onPress: read.recheck };
    if (n.action === 'reread' && onReread && !wo.saving) return { label: 'Yeniden okut', icon: 'camera-retake-outline' as const, onPress: onReread };
    return undefined;
  };
  const busy = w?.phase === 'polling' && !row.form;
  const pillColor = PILL_COLOR[pill.tone];
  return (
    <>
      {single ? (
        <View style={styles.line} testID="ie-serit-belge" accessibilityLabel={`Belge ${no}: ${pill.text}`}>
          <Icon source="file-document-outline" size={22} color={colors.textSecondary} />
          <Text style={styles.no} numberOfLines={1}>{no}</Text>
          {busy ? <ActivityIndicator size="small" /> : <Icon source={pill.icon} size={20} color={pillColor} />}
          {pill.tone !== 'ok' && <Text style={[styles.state, { color: pillColor }]} numberOfLines={1} testID="ie-serit-belge-durum">{pill.text}</Text>}
          <TemplateName entry={teach} />
          <View style={styles.flex} />
          <TemplateUpdateButton entry={teach} />
          {onReread && !done && (
            <IconButton icon={manual ? 'camera-plus-outline' : 'camera-retake-outline'} size={24} iconColor={colors.brand} onPress={onReread} disabled={wo.saving} style={styles.icon}
              accessibilityLabel={manual ? 'Belge ekle' : 'Yeniden okut'} testID={manual ? 'ie-belge-ekle' : 'ie-belge-yeniden-okut'} />
          )}
          {cancellable && (
            <CancelDraftButton iconOnly note={{ id: row.noteId, noteNo: no }} onCancelled={onDraftCancelled ?? (() => wo.removeRow(row.noteId))} disabled={wo.saving} testID="ie-belge-taslak-iptal" />
          )}
        </View>
      ) : (
        <>
          <SectionBand
            title="Belge"
            aside={no}
            icon="file-document-outline"
            tone={BAND_TONE[pill.tone]}
            status={{ icon: pill.icon, text: pill.text }}
            testID={`belge-serit-${no}`}
          />
          <View style={styles.sub} testID={`belge-serit-alt-${no}`}>
            {busy ? <ActivityIndicator size="small" /> : null}
            <TemplateName entry={teach} />
            <View style={styles.flex} />
            <TemplateUpdateButton entry={teach} />
            {!done && (
              <Button mode="outlined" icon="close" onPress={() => wo.removeRow(row.noteId)} disabled={wo.saving} contentStyle={styles.btn} testID={`belge-satir-cikar-${no}`}>
                Listeden çıkar
              </Button>
            )}
            {cancellable && (
              <CancelDraftButton note={{ id: row.noteId, noteNo: no }} onCancelled={onDraftCancelled ?? (() => wo.removeRow(row.noteId))} disabled={wo.saving} testID={`belge-taslak-iptal-${no}`} />
            )}
          </View>
        </>
      )}
      <TeachStrip entry={teach} />
      {notices.map((n) => {
        const a = act(n);
        return (
          <NoticeStrip
            key={n.key}
            tone={n.tone}
            text={n.text}
            action={a && { ...a, testID: `belge-ileti-eylem-${n.key}-${no}` }}
            testID={n.key === 'detay' ? `belge-satir-detay-hata-${no}` : `belge-ileti-${n.key}-${no}`}
          />
        );
      })}
      {teach.modal}
    </>
  );
}

const styles = StyleSheet.create({
  sub: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  flex: { flex: 1 },
  btn: { minHeight: 56 },
  line: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 64, paddingLeft: spacing.md, paddingRight: spacing.xs,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface,
  },
  no: { flexShrink: 0, fontSize: 20, fontWeight: typography.weight.bold, color: colors.text },
  state: { flexShrink: 1, fontSize: typography.size.base, fontWeight: typography.weight.semibold },
  icon: { width: 56, height: 56, margin: 0 },
});
