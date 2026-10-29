// =============================================================================
// Belge Tara (Gülkesim D7) — müşteri irsaliyesini fotoğrafla → DRAFT taslak
// =============================================================================
// Tablet YALNIZ tarama + başlık yapar (sahip, gönderen belge no, sayfalar); satır gözden geçirme
// ve onay panelde (SoD, `gelen-belge:approve`). Okuma servisi fotoğrafı arka planda okuyup aynı
// taslağı doldurur. ONLINE-ONLY: çevrimdışı kuyruk yok; yarıda düşen gönderim ekranda kalır ve
// "Yeniden dene" aynı taslağa kalan sayfaları yükler (`submitDocScan` ilerlemesi).
// =============================================================================
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import ScreenChrome from '../../../components/ScreenChrome';
import { colors, spacing, typography } from '../../../theme';
import DocHeader from './DocHeader';
import PageCameraModal from './PageCameraModal';
import PageList from './PageList';
import { removePage } from './docScan';
import { useDocScan } from './useDocScan';

export default function DocScanScreen() {
  const b = useDocScan();
  const [cameraOpen, setCameraOpen] = useState(false);

  return (
    <ScreenChrome title="Belge Tara" subtitle="Müşteri irsaliyesi → taslak">
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {b.done && (
          <View style={styles.doneBox} testID="belge-tara-sonuc">
            <Text style={styles.doneText}>Son gönderilen: {b.done.noteNo} · {b.done.pages} sayfa. Onay panelde.</Text>
          </View>
        )}
        <DocHeader owner={b.owner} onOwner={b.setOwner} senderDocNo={b.senderDocNo} onBarcode={b.setBarcode} locked={b.headerLocked} />
        <PageList pages={b.pages} uploaded={b.progress.uploaded} onRemove={(i) => b.setPages(removePage(b.pages, i))} onAdd={() => setCameraOpen(true)} />
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
            {b.headerLocked ? `Yeniden dene (${b.remaining} sayfa)` : 'Taslak oluştur ve gönder'}
          </Button>
        </View>
      </ScrollView>
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
  doneBox: { padding: spacing.md, borderRadius: 8, backgroundColor: colors.surfaceMuted },
  doneText: { fontSize: typography.size.base, color: colors.text },
});
