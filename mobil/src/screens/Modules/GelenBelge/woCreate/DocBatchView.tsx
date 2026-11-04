// Belge okut (K6/K8): mevcut tarayıcı (ML Kit + galeri + klasik kamera, sayfa toplama) → taslak + okuma → satır formu.
// Birden çok belge art arda okutulur; her biri ayrı satır, "Hepsini kaydet" satır başına sonuç yazar.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import type { PickerOption } from '../../../../components/PickerModal';
import TruncatedText from '../../../../components/TruncatedText';
import { inboundDocService } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { TERIM } from '../../../../lib/terim';
import { colors, radius, spacing, typography } from '../../../../theme';
import { INBOUND_DOC_CONTEXT_KEY } from '../DocHeader';
import PageCameraModal from '../PageCameraModal';
import MultiPageCameraModal from '../MultiPageCameraModal';
import PageList from '../PageList';
import PagePreviewModal from '../PagePreviewModal';
import { removePage, type ScanPage } from '../docScan';
import { useDocScan } from '../useDocScan';
import { usePageSource } from '../usePageSource';
import { DuplicateDocNoDialog } from '../DuplicateDocNoDialog';
import DocRowCard from './DocRowCard';
import { useWoRows, type WoRowsState } from './useWoRows';
import { shortcutTitle, type FormApproval } from './woFromDoc';

const MODE_TEXT: Record<FormApproval, string> = {
  get WITH_WORK_ORDER() { return `Kaydet: belge + müşteri malı top + ${TERIM.terbiyeIsEmri.tekilKucuk} tek seferde.`; },
  get SEPARATE() { return `Fabrika ayarı ayrı onay: kayıt taslak olarak kalır, ${TERIM.terbiyeIsEmri.tekilKucuk} panelde onaylanınca açılır.`; },
  get UNKNOWN() { return `Kaydet: ${TERIM.terbiyeIsEmri.tekilKucuk} açılmaya çalışılır; ayar ayrı onay istiyorsa taslak kalır.`; },
};

/** `multi`: birden çok belge art arda (satır listesi + "Hepsini kaydet"); değilse tek belge okunur, sonra tarayıcı gizlenir.
 *  `autoStart`: "Belge okut"a basınca tarayıcı ek dokunuşsuz açılır. */
export default function DocBatchView({ route, multi = true, autoStart = false }: { route: ProductionRoute; multi?: boolean; autoStart?: boolean }) {
  const wo = useWoRows(route);
  const b = useDocScan({ successHint: 'Okuma bitince form dolar; kontrol edip kaydedin.' });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // Tarayıcı/galeri belgenin bütün sayfalarını tek seferde verir → yükleme + okuma kendiliğinden başlar (ayrı "gönder" yok).
  // Klasik kamera sayfa sayfa çeker: belgenin bittiğini kullanıcı "Belgeyi gönder ve oku" ile söyler.
  const onPages = (ps: ScanPage[]) => {
    const next = b.captureMany(ps);
    if (next) void b.send(next);
  };
  const source = usePageSource(b.pages.length, onPages);
  const started = useRef(false);
  const { add } = source;
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    add();
  }, [autoStart, add]);
  const ctx = useQuery({ queryKey: INBOUND_DOC_CONTEXT_KEY, queryFn: inboundDocService.tabletContext, staleTime: 60_000 });
  const customers: PickerOption[] = useMemo(() => (ctx.data?.data.customers ?? []).map((x) => ({ value: x.id, label: x.name })), [ctx.data]);

  // Gönderilen her belge bir satır olur (aynı taslağa sayfa eklenirse satır yeniden okunur).
  const { addNote } = wo;
  const doneNote = b.done?.note;
  const doneRun = b.done?.runKey ?? 0;
  useEffect(() => {
    if (doneNote) addNote(doneNote, doneRun);
  }, [doneNote, doneRun, addNote]);

  const remove = (i: number) => b.setPages(removePage(b.pages, i));
  const removeFromPreview = (i: number) => {
    const left = b.pages.length - 1;
    remove(i);
    setPreviewIndex(left <= 0 ? null : Math.min(i, left - 1));
  };
  const c = wo.counts;
  const saveLabel = !multi
    ? wo.mode === 'SEPARATE' ? 'Taslak kaydet' : 'Kaydet'
    : wo.mode === 'SEPARATE' ? `Hepsini taslak kaydet (${c.ready})` : `Hepsini kaydet (${c.ready})`;
  const showScanner = multi || wo.rows.length === 0;

  return (
    <>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.banner} testID="belge-ie-kip">
          <TruncatedText style={styles.bannerTitle}>{shortcutTitle(route)}</TruncatedText>
          <Text style={styles.bannerText}>{MODE_TEXT[wo.mode]}</Text>
          {wo.autoPrint && <Text style={styles.bannerText}>Refakat kartı her açılan {TERIM.terbiyeIsEmri.tekilKucuk} için otomatik yazdırılır.</Text>}
        </View>
        {wo.rows.map((r) => (
          <DocRowCard key={r.noteId} row={r} wo={wo} customers={customers} customersLoading={ctx.isLoading} />
        ))}
        {showScanner && (
          <ScannerSection b={b} hasRows={wo.rows.length > 0} onAdd={source.add} busy={source.busy} onClassic={() => setCameraOpen(true)} onRemove={remove} onOpen={setPreviewIndex} />
        )}
      </ScrollView>
      {wo.rows.length > 0 && <SaveBar wo={wo} label={saveLabel} />}
      <DuplicateDocNoDialog conflict={wo.duplicate?.conflict ?? null} busy={wo.saving} onCancel={wo.dismissDuplicate} onConfirm={() => void wo.confirmDuplicate()} />
      <PagePreviewModal
        pages={b.pages}
        index={previewIndex}
        uploaded={b.progress.uploaded}
        onIndex={setPreviewIndex}
        onRemove={removeFromPreview}
        onDismiss={() => setPreviewIndex(null)}
      />
      <MultiPageCameraModal {...source.camera} onError={(m) => Toast.show({ type: 'error', text1: m })} />
      <PageCameraModal
        visible={cameraOpen}
        pageNo={b.pages.length + 1}
        onDismiss={() => setCameraOpen(false)}
        onCaptured={(p) => {
          setCameraOpen(false);
          b.capture(p);
        }}
        onError={(m) => Toast.show({ type: 'error', text1: m })}
      />
    </>
  );
}

function SaveBar({ wo, label }: { wo: WoRowsState; label: string }) {
  const c = wo.counts;
  const parts = [`${c.total} belge`, c.reading ? `${c.reading} okunuyor` : '', c.opened ? `${c.opened} açıldı` : '', c.drafts ? `${c.drafts} taslak` : '', c.failed ? `${c.failed} hata` : ''];
  return (
    <View style={styles.bar}>
      <Text style={styles.barText}>{parts.filter(Boolean).join(' · ')}</Text>
      <Button
        mode="contained"
        icon="content-save-all"
        onPress={() => void wo.saveAll()}
        loading={wo.saving}
        disabled={wo.saving || c.ready === 0}
        contentStyle={styles.btn}
        testID="belge-ie-hepsini-kaydet"
      >
        {label}
      </Button>
    </View>
  );
}

interface ScannerProps {
  b: ReturnType<typeof useDocScan>;
  hasRows: boolean;
  onAdd: () => void;
  busy: boolean;
  onClassic: () => void;
  onRemove: (i: number) => void;
  onOpen: (i: number) => void;
}

/** Sıradaki belgenin sayfaları + gönder (mevcut Belge Tara bileşenleri). */
export function ScannerSection({ b, hasRows, onAdd, busy, onClassic, onRemove, onOpen }: ScannerProps) {
  return (
    <>
      <Text style={styles.section}>{hasRows ? 'Sıradaki belge' : 'Belgeyi okutun'}</Text>
      <PageList pages={b.pages} uploaded={b.progress.uploaded} onRemove={onRemove} onAdd={onAdd} onAddClassic={onClassic} busy={busy} onOpen={onOpen} />
      {(b.pages.length > 0 || b.headerLocked) && <View style={styles.footer}>
        <Button mode="text" onPress={b.reset} disabled={b.sending}>
          Vazgeç
        </Button>
        <Button
          mode="outlined"
          icon="send"
          onPress={() => void b.send()}
          loading={b.sending}
          disabled={b.sending || b.remaining === 0}
          contentStyle={styles.btn}
          testID="belge-ie-gonder"
        >
          {b.headerLocked ? `Yeniden dene (${b.remaining} sayfa)` : 'Belgeyi gönder ve oku'}
        </Button>
      </View>}
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  banner: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, gap: spacing.xs },
  bannerTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text },
  bannerText: { fontSize: typography.size.sm, color: colors.textSecondary },
  section: { marginTop: spacing.md, fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.sm },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  barText: { flex: 1, fontSize: typography.size.sm, color: colors.textSecondary },
  btn: { minHeight: 56 },
});
