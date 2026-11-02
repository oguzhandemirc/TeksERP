// =============================================================================
// Belge Tara (Gülkesim D7) — müşteri irsaliyesini fotoğrafla → DRAFT taslak
// =============================================================================
// Tablet YALNIZ tarama + başlık yapar (sahip, gönderen belge no, sayfalar); satır gözden geçirme
// ve onay panelde (SoD, `gelen-belge:approve`). Okuma servisi fotoğrafı arka planda okuyup aynı
// taslağı doldurur. ONLINE-ONLY: çevrimdışı kuyruk yok; yarıda düşen gönderim ekranda kalır ve
// "Yeniden dene" aynı taslağa kalan sayfaları yükler (`submitDocScan` ilerlemesi). Gönderimden sonra okuma
// sonucu kartta izlenir (`useReadResult`); "Yeni sayfa çek" aynı taslağa sayfa ekler, "Bitti" yeni belgeye hazırlar.
// =============================================================================
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import ScreenChrome from '../../../components/ScreenChrome';
import { spacing } from '../../../theme';
import DocHeader from './DocHeader';
import PageCameraModal from './PageCameraModal';
import PageList from './PageList';
import PagePreviewModal from './PagePreviewModal';
import ReadResultCard from './ReadResultCard';
import { removePage } from './docScan';
import { usePageSource } from './usePageSource';
import { useDocScan } from './useDocScan';
import { useReadResult } from './useReadResult';

export default function DocScanScreen() {
  const b = useDocScan();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const source = usePageSource(b.pages.length, b.captureMany, () => setCameraOpen(true));
  const read = useReadResult(b.done?.note.id ?? null, b.done?.runKey ?? 0);
  const addPageToNote = () => {
    b.addToNote();
    source.add();
  };
  const sendLabel = b.continuing && b.done
    ? b.progress.uploaded.size ? `Yeniden dene (${b.remaining} sayfa)` : `${b.done.note.noteNo} taslağına ekle`
    : b.headerLocked ? `Yeniden dene (${b.remaining} sayfa)` : 'Taslak oluştur ve gönder';

  const remove = (i: number) => b.setPages(removePage(b.pages, i));
  // Önizlemeden silince komşu sayfada kalınır; son sayfa da gidince önizleme kapanır.
  const removeFromPreview = (i: number) => {
    const left = b.pages.length - 1;
    remove(i);
    setPreviewIndex(left <= 0 ? null : Math.min(i, left - 1));
  };

  return (
    <ScreenChrome title="Belge Tara" subtitle="Müşteri irsaliyesi → taslak">
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {b.done && read.watch && (
          <ReadResultCard watch={read.watch} noteNo={b.done.note.noteNo} actions={{ onAddPage: addPageToNote, onDone: b.finish, onRecheck: read.recheck }} />
        )}
        <DocHeader owner={b.owner} onOwner={b.setOwner} senderDocNo={b.senderDocNo} onBarcode={b.setBarcode} locked={b.headerLocked} />
        <PageList
          pages={b.pages}
          uploaded={b.progress.uploaded}
          onRemove={remove}
          onAdd={source.add}
          onAddClassic={() => setCameraOpen(true)}
          busy={source.busy}
          onOpen={setPreviewIndex}
        />
        <View style={styles.footer}>
          {(b.pages.length > 0 || b.headerLocked) && (
            <Button mode="text" onPress={b.reset} disabled={b.sending}>
              Vazgeç
            </Button>
          )}
          <Button
            mode="contained"
            icon="send"
            onPress={() => void b.send()}
            loading={b.sending}
            disabled={b.sending || b.remaining === 0}
            contentStyle={styles.btn}
            testID="belge-tara-gonder"
          >
            {sendLabel}
          </Button>
        </View>
      </ScrollView>
      <PagePreviewModal
        pages={b.pages}
        index={previewIndex}
        uploaded={b.progress.uploaded}
        onIndex={setPreviewIndex}
        onRemove={removeFromPreview}
        onDismiss={() => setPreviewIndex(null)}
      />
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
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.sm },
  btn: { minHeight: 56 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.lg },
});
