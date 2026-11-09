// Belge satırının başı. Toplu liste: "Belge GB…" şeridi + okuma hapı, altında eylem satırı. Tek İE formu: TEK satır — belge no +
// durum ikonu (sorun varsa kısa yazı), sağda Yeniden okut / Taslağı iptal et ikonları. İkisinde de tanıtılmamış şeridi ve kısa
// eylemli iletiler (`docReadNotice`) altta; şablon düzeltmek okuma düzeltmesidir → okuma durumunun yanında durur.
// Sunucu `tanima` gönderince altta yalnız iş gerektiren şerit (`RecognitionStrip`: tanınmadı + Tanıt · çok parti kipi).
// Dar ekranda (<600dp) tek formun ikonları sığmaz: en çok iki ikon görünür, fazlası "⋯" menüsüne iner (birincil: yeniden okut).
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button, Icon, IconButton, Text } from 'react-native-paper';
import { NoticeStrip } from '../../../../components/form/NoticeStrip';
import { SectionBand } from '../../../../components/form/SectionBand';
import type { BandTone, PillTone } from '../../../../components/form/tone';
import type { PickerOption } from '../../../../components/PickerModal';
import AppMenu from '../../../../components/AppMenu';
import { useIsCompact } from '../../../../hooks/useDeviceType';
import { usePermissions } from '../../../../hooks/usePermission';
import { colors, radius, spacing, typography } from '../../../../theme';
import CancelDraftButton from '../CancelDraftButton';
import { TeachStrip, TemplateName, TemplateUpdateButton, templateUpdateLabel } from '../tanit/TeachBanner';
import { useTeachEntry } from '../tanit/useTeachEntry';
import type { useReadResult } from '../useReadResult';
import { docReadNotices, docReadPill, type DocNotice } from './docReadNotice';
import RecognitionStrip from './RecognitionStrip';
import { stripModel } from './stripModel';
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
  /** Tek formda "Belgeyi önizle": okutulan sayfalar tam ekran (yalnız bu cihazda çekilmiş sayfalar varken). */
  onPreview?: () => void;
}

const PILL_COLOR: Record<PillTone, string> = {
  ok: colors.successText, warn: colors.warningText, missing: colors.dangerText, idle: colors.textSecondary, info: colors.textSecondary, busy: colors.textSecondary,
};

/** Tek form üst satırı ikonları: dokunma hedefi 56dp (`styles.icon`), ikon 28. */
const ICON = 28;

const BAND_TONE: Record<PillTone, BandTone> = { ok: 'ok', warn: 'warn', missing: 'missing', idle: 'idle', info: 'idle', busy: 'idle' };

/** Formda belgeden gelen bir değer var mı: satırsız okumada "bilgi çıkmadı" iletisini susturur. */
const formFilled = (row: DocRow) => {
  const f = row.form;
  return !!f && !!(f.ownerCustomerId || f.ownerSuggested || f.customerBatchNo || f.ourBatchNo || f.meters != null || f.multi || f.rolls);
};

export default function DocHeadBand({ row, wo, read, detailFailed, variant, onReread, manual = false, onDraftCancelled, customers, onPreview }: Props) {
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
  const strip = noPages ? null : stripModel({
    tanima: w?.phase === 'done' ? w.summary.tanima : undefined, entry: teach, localTaught: !!row.taught,
    multi: row.form?.multi, locked: wo.saving || !!row.result,
  });
  // Yeni sunucuda (şerit modeli var) şablon adı gösterilmez — tanınmış belgede ✓ yeter; amber şerit yalnız fotoğrafsız açıklama.
  const name = strip ? null : <TemplateName entry={teach} />;
  const act = noticeActor(read.recheck, onReread && !wo.saving ? onReread : undefined);
  const busy = w?.phase === 'polling' && !row.form;
  const pillColor = PILL_COLOR[pill.tone];
  const compact = useIsCompact();
  const compactActions = useCompactHeadActions(single && compact, { teach, manual, done, cancellable, saving: wo.saving, onReread, onPreview });
  return (
    <>
      {single && compact ? (
        <CompactBand no={no} pill={pill} pillColor={pillColor} busy={busy} actions={compactActions}
          cancel={cancellable ? { note: { id: row.noteId, noteNo: no }, onCancelled: onDraftCancelled ?? (() => wo.removeRow(row.noteId)) } : null} />
      ) : single ? (
        <View style={styles.line} testID="ie-serit-belge" accessibilityLabel={`Belge ${no}: ${pill.text}`}>
          <Icon source="file-document-outline" size={22} color={colors.textSecondary} />
          <Text style={styles.no} numberOfLines={1}>{no}</Text>
          {busy ? <ActivityIndicator size="small" /> : <Icon source={pill.icon} size={20} color={pillColor} />}
          {pill.tone !== 'ok' && <Text style={[styles.state, { color: pillColor }]} numberOfLines={1} testID="ie-serit-belge-durum">{pill.text}</Text>}
          {name}
          <View style={styles.flex} />
          <TemplateUpdateButton entry={teach} />
          {onPreview && (
            <IconButton icon="file-eye-outline" size={ICON} iconColor={colors.brand} onPress={onPreview} style={styles.icon}
              accessibilityLabel="Belgeyi önizle" testID="ie-belge-onizle" />
          )}
          {onReread && !done && (
            <IconButton icon={manual ? 'camera-plus-outline' : 'camera-retake-outline'} size={ICON} iconColor={colors.brand} onPress={onReread} disabled={wo.saving} style={styles.icon}
              accessibilityLabel={manual ? 'Belge ekle' : 'Yeniden okut'} testID={manual ? 'ie-belge-ekle' : 'ie-belge-yeniden-okut'} />
          )}
          {cancellable && (
            <CancelDraftButton iconOnly iconSize={ICON} note={{ id: row.noteId, noteNo: no }} onCancelled={onDraftCancelled ?? (() => wo.removeRow(row.noteId))} disabled={wo.saving} testID="ie-belge-taslak-iptal" />
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
            {name}
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
      {strip && <RecognitionStrip model={strip} noteNo={no} multi={row.form?.multi} onTeach={teach.open} onMode={(m) => wo.setMulti(row.noteId, m)} />}
      {(!strip || teach.noPhoto) && <TeachStrip entry={teach} />}
      <BandNotices notices={notices} act={act} no={no} />
      {teach.modal}
    </>
  );
}

interface CompactBandProps {
  no: string;
  pill: { tone: PillTone; icon: string; text: string };
  pillColor: string;
  busy: boolean;
  actions: HeadAction[];
  cancel: { note: { id: string; noteNo: string }; onCancelled: () => void } | null;
}

/** Dar ekran tek form belge satırı: no + durum, sağda en çok iki ikon (+ ⋯); iptal onay kartı menüden açılır. */
function CompactBand({ no, pill, pillColor, busy, actions, cancel }: CompactBandProps) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const wired = actions.map((x) => (x.key === 'cancel' ? { ...x, onPress: () => setCancelOpen(true) } : x));
  return (
    <View style={styles.line} testID="ie-serit-belge" accessibilityLabel={`Belge ${no}: ${pill.text}`}>
      <Icon source="file-document-outline" size={22} color={colors.textSecondary} />
      <Text style={styles.noCompact} numberOfLines={1}>{no}</Text>
      {busy ? <ActivityIndicator size="small" /> : <Icon source={pill.icon} size={20} color={pillColor} />}
      {pill.tone !== 'ok' && <Text style={[styles.state, { color: pillColor }]} numberOfLines={1} testID="ie-serit-belge-durum">{pill.text}</Text>}
      <View style={styles.flex} />
      <HeadActions actions={wired} />
      {cancel && <CancelDraftButton note={cancel.note} onCancelled={cancel.onCancelled} externalOpen={cancelOpen} onExternalClose={() => setCancelOpen(false)} />}
    </View>
  );
}

interface ActionInput {
  teach: ReturnType<typeof useTeachEntry>;
  manual: boolean;
  done: boolean;
  cancellable: boolean;
  saving: boolean;
  onReread?: () => void;
  onPreview?: () => void;
}

/** Dar ekran belge satırı eylemleri, öncelik sırasıyla (ilki her zaman ikon kalır); iptalin onay kartını CompactBand bağlar. */
function useCompactHeadActions(on: boolean, a: ActionInput): HeadAction[] {
  const canWrite = usePermissions().has('gelen-belge:write');
  if (!on) return [];
  const out: HeadAction[] = [];
  if (a.onReread && !a.done) out.push({ key: 'reread', icon: a.manual ? 'camera-plus-outline' : 'camera-retake-outline', label: a.manual ? 'Belge ekle' : 'Yeniden okut', onPress: a.onReread, disabled: a.saving, testID: a.manual ? 'ie-belge-ekle' : 'ie-belge-yeniden-okut' });
  if (a.onPreview) out.push({ key: 'preview', icon: 'file-eye-outline', label: 'Belgeyi önizle', onPress: a.onPreview, testID: 'ie-belge-onizle' });
  const t = a.teach;
  if ((t.kind === 'taught' || t.kind === 'system') && !t.noPhoto) out.push({ key: 'template', icon: 'file-replace-outline', label: templateUpdateLabel(t.kind), onPress: t.open, testID: 'tanit-serit-guncelle' });
  if (a.cancellable && canWrite) out.push({ key: 'cancel', icon: 'file-cancel-outline', label: 'Taslağı iptal et', onPress: () => undefined, disabled: a.saving, testID: 'ie-belge-taslak-iptal', danger: true });
  return out;
}

interface HeadAction { key: string; icon: string; label: string; onPress: () => void; disabled?: boolean; testID: string; danger?: boolean }

/** Dar ekran: ikiye kadar eylem ikon; fazlasında ilk eylem ikon + kalanlar "⋯" menüsünde (aynı testID'lerle). */
const COMPACT_VISIBLE_ICONS = 2;

function HeadActions({ actions }: { actions: HeadAction[] }) {
  const [menu, setMenu] = useState(false);
  const shown = actions.length <= COMPACT_VISIBLE_ICONS ? actions : actions.slice(0, 1);
  const rest = actions.slice(shown.length);
  return (
    <>
      {shown.map((a) => (
        <IconButton key={a.key} icon={a.icon} size={ICON} iconColor={a.danger ? colors.dangerDark : colors.brand} onPress={a.onPress} disabled={a.disabled} style={styles.icon}
          accessibilityLabel={a.label} testID={a.testID} />
      ))}
      {rest.length > 0 && (
        <AppMenu
          visible={menu}
          onDismiss={() => setMenu(false)}
          anchor={<IconButton icon="dots-horizontal" size={ICON} iconColor={colors.textSecondary} onPress={() => setMenu(true)} style={styles.icon} accessibilityLabel="Diğer belge işlemleri" testID="ie-belge-menu" />}
        >
          {rest.map((a) => (
            <AppMenu.Item key={a.key} title={a.label} leadingIcon={a.icon} disabled={a.disabled} style={styles.menuItem} testID={a.testID}
              titleStyle={a.danger ? styles.menuDanger : undefined}
              onPress={() => { setMenu(false); a.onPress(); }} />
          ))}
        </AppMenu>
      )}
    </>
  );
}

/** Kısa iletinin eylemi: yeniden bak her zaman; yeniden okut yalnız kayıt sürmüyorken. */
function noticeActor(recheck: () => void, reread: (() => void) | undefined) {
  return (n: DocNotice): NoticeAction => {
    if (n.action === 'recheck') return { label: 'Yeniden bak', icon: 'refresh' as const, onPress: recheck };
    if (n.action === 'reread' && reread) return { label: 'Yeniden okut', icon: 'camera-retake-outline' as const, onPress: reread };
    return undefined;
  };
}

type NoticeAction = { label: string; icon: 'refresh' | 'camera-retake-outline'; onPress: () => void } | undefined;

/** Kısa eylemli okuma iletileri (Yeniden bak / Yeniden okut). */
function BandNotices({ notices, act, no }: { notices: DocNotice[]; act: (n: DocNotice) => NoticeAction; no: string }) {
  return (
    <>
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
  noCompact: { flexShrink: 1, fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text },
  menuItem: { minHeight: 56 },
  menuDanger: { color: colors.dangerDark },
});
