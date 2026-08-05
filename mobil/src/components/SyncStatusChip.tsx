import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import Pulse from './motion/Pulse';
import OutboxModal from './outbox/OutboxModal';
import { palette, radius, spacing } from '../theme';
import { useIsOnline, useOfflineReason, usePendingStationOps } from '../offline/hooks';
import { useFailedOps } from '../offline/failedOps';

/**
 * Çevrimdışı / senkron bekleyen / KALICI DÜŞMÜŞ istasyon işlemi rozeti —
 * istasyon ekranlarının header'ında ortak. Önceden 5 ekrana birebir kopyalanmış
 * statik pill'di; tek paylaşılan, animasyonlu komponente çıkarıldı.
 *
 * Dört durum:
 *  - hatalı>0             → "N KAYIT HATALI" (kırmızı, DOKUNULABİLİR → kutu)
 *  - online + bekleyen>0  → "N sync"         (mavi, nabız atan açık nokta = aktarım)
 *  - offline + bekleyen=0 → "Çevrimdışı"      (amber)
 *  - offline + bekleyen>0 → "Çevrimdışı · N"  (kırmızı = veri sırada, dikkat)
 *
 * Tam senkronda (online + bekleyen 0 + hatalı 0) hiç render edilmez.
 *
 * ⚠️ "N KAYIT HATALI" ile KK1'in yazıcı çipi ("N ETİKET HATALI") FARKLI şeylerdir:
 * bu SUNUCUYA YAZILAMAMIŞ kaydı, o basılamamış etiketi anlatır. Metinleri ve
 * ikonları bilinçli olarak ayrıştırıldı — ikisi aynı header'da yan yana durur.
 *
 * NEDEN TEK YER: çakışma/başarısızlık 12 istasyon anahtarının hepsinde mümkün
 * (fason sevk, kartela, QC2 …). KK1'e özel bir kutu, diğer 11'ini sessiz bırakırdı.
 */
export default function SyncStatusChip({
  onPrintBarcode,
}: {
  /** KK1 gibi yazıcı kuyruğu olan ekranlar "Etiketi Bas" yeteneğini enjekte eder. */
  onPrintBarcode?: (barcode: string) => void;
} = {}) {
  const online = useIsOnline();
  const why = useOfflineReason();
  const pending = usePendingStationOps();
  const pendingCount = pending.length;
  const failedCount = useFailedOps((s) => s.rows.length);
  const [outboxOpen, setOutboxOpen] = useState(false);

  if (online && pendingCount === 0 && failedCount === 0) return null;

  let bg: string = palette.blue[800];
  let dot: string = '#bfdbfe'; // blue 200
  let label = `${pendingCount} sync`;
  if (failedCount > 0) {
    // Hata her şeyin önüne geçer — operatörün karar vermesi gereken tek durum bu.
    bg = palette.red[700];
    dot = '#fecaca'; // red 200
    // "GİTMEDİ" — "HATALI" DEĞİL. Saha personeli "hatalı" kelimesini "kayıt
    // yanlış girilmiş" diye okuyor; oysa anlatılmak istenen "kayıt sisteme
    // ULAŞMADI". Ayrıca KK1'in yazıcı çipi zaten "N ETİKET HATALI" diyor ve
    // ikisi aynı header'da yan yana duruyor.
    label = `${failedCount} KAYIT GİTMEDİ${pendingCount > 0 ? ` · ${pendingCount} sırada` : ''}`;
  } else if (!online) {
    // SEBEBİ SÖYLE. "Çevrimdışı" tek başına operatörü yanlış işe yönlendiriyordu:
    // ağ linki varken sunucu ölüyse tablette wifi'yle uğraşmanın faydası yok,
    // haber verilmesi gereken IT'dir. İki durum ayrı metin, ayrı ikon rengi.
    const serverDown = why === 'server';
    bg = pendingCount > 0 ? palette.red[700] : palette.amber[700];
    dot = pendingCount > 0 ? '#fecaca' : '#fde68a';
    label = serverDown ? 'SUNUCUYA ULAŞILAMIYOR' : 'Çevrimdışı';
    if (pendingCount > 0) label += ` · ${pendingCount} sırada`;
  }

  const a11y =
    failedCount > 0
      ? `${failedCount} kayıt gönderilemedi, listeyi açmak için dokun`
      : why === 'server'
        ? `Sunucuya ulaşılamıyor${pendingCount > 0 ? `, ${pendingCount} işlem bekliyor` : ''}`
        : online
          ? `${pendingCount} işlem senkronize bekliyor`
          : pendingCount > 0
            ? `Çevrimdışı, ${pendingCount} işlem bekliyor`
            : 'Çevrimdışı';

  return (
    <>
      <Animated.View
        entering={FadeInDown.springify().damping(16).stiffness(180).mass(0.7)}
        exiting={FadeOut.duration(160)}
        style={[styles.chipWrap, { backgroundColor: bg }]}
        accessibilityLabel={a11y}
      >
        <TouchableRipple
          onPress={() => setOutboxOpen(true)}
          borderless
          accessibilityRole="button"
        >
          {/* TouchableRipple TEK element çocuk ister — fragment kullanma. */}
          <View style={styles.chip}>
            <Pulse color={dot} size={8} />
            <Text style={styles.label}>{label}</Text>
          </View>
        </TouchableRipple>
      </Animated.View>

      <OutboxModal
        visible={outboxOpen}
        onDismiss={() => setOutboxOpen(false)}
        onPrintBarcode={onPrintBarcode}
        online={online}
      />
    </>
  );
}

const styles = StyleSheet.create({
  chipWrap: {
    borderRadius: radius.md,
    marginRight: spacing.sm,
    overflow: 'hidden',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  label: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
