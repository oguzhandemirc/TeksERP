// Belge satırının başı: "Belge GB…" şeridi + okuma hapı, altında tek satır (Şablon: <ad> · Yeniden okut · Şablonu güncelle ·
// toplu listede Listeden çıkar · Taslağı iptal et), tanıtılmamış şeridi ve kısa eylemli iletiler (`docReadNotice`). Şablon düzeltmek bir okuma
// düzeltmesidir → okuma durumunun yanında durur, müşterinin üstünde değil.
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button } from 'react-native-paper';
import { NoticeStrip } from '../../../../components/form/NoticeStrip';
import { SectionBand } from '../../../../components/form/SectionBand';
import type { BandTone, PillTone } from '../../../../components/form/tone';
import type { PickerOption } from '../../../../components/PickerModal';
import { spacing } from '../../../../theme';
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
  return (
    <>
      <SectionBand
        title="Belge"
        aside={no}
        icon="file-document-outline"
        tone={BAND_TONE[pill.tone]}
        status={{ icon: pill.icon, text: pill.text }}
        testID={single ? 'ie-serit-belge' : `belge-serit-${no}`}
      />
      <View style={styles.sub} testID={single ? 'ie-serit-belge-alt' : `belge-serit-alt-${no}`}>
        {w?.phase === 'polling' && !row.form ? <ActivityIndicator size="small" /> : null}
        <TemplateName entry={teach} />
        <View style={styles.flex} />
        {single && onReread && !done && (
          <Button mode="outlined" icon={manual ? 'camera-plus-outline' : 'camera-retake-outline'} onPress={onReread} disabled={wo.saving} contentStyle={styles.btn} testID={manual ? 'ie-belge-ekle' : 'ie-belge-yeniden-okut'}>
            {manual ? 'Belge ekle' : 'Yeniden okut'}
          </Button>
        )}
        <TemplateUpdateButton entry={teach} />
        {!single && !done && (
          <Button mode="outlined" icon="close" onPress={() => wo.removeRow(row.noteId)} disabled={wo.saving} contentStyle={styles.btn} testID={`belge-satir-cikar-${no}`}>
            Listeden çıkar
          </Button>
        )}
        {cancellable && (
          <CancelDraftButton
            note={{ id: row.noteId, noteNo: no }}
            onCancelled={onDraftCancelled ?? (() => wo.removeRow(row.noteId))}
            disabled={wo.saving}
            testID={single ? 'ie-belge-taslak-iptal' : `belge-taslak-iptal-${no}`}
          />
        )}
      </View>
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
});
