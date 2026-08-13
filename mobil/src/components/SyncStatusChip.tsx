import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import Pulse from './motion/Pulse';
import { palette, radius, spacing } from '../theme';
import { useIsOnline, useOfflineReason, usePendingStationOps } from '../offline/hooks';

/**
 * Bağlantı DURUMU rozeti — istasyon ekranlarının header'ında ortak.
 *
 * Üç durum:
 *  - online + bekleyen>0  → "N sync"        (mavi, nabız atan nokta = aktarım)
 *  - offline + bekleyen=0 → "Çevrimdışı" / "SUNUCUYA ULAŞILAMIYOR" (amber)
 *  - offline + bekleyen>0 → yukarıdaki + " · N sırada" (kırmızı = veri sırada)
 *
 * Tam senkronda (online + bekleyen 0) hiç render edilmez.
 *
 * ⚠️ ROZET DURUM BİLDİRİR, İŞ İSTEMEZ — bu yüzden DOKUNULAMAZ. 2026-08-12'ye
 * kadar buradan bir "ölü mektup kutusu" (kalıcı düşmüş kayıtların listesi)
 * açılıyordu; kaldırıldı. Gerekçe: kutu iki bambaşka olayı ("sunucuya
 * ulaşamadım" ve "sunucu 409 ile soru sordu") tek kırmızı başlık altında
 * topluyor ve ikincisi için "bilgisayara ULAŞMADI" diyerek operatöre yanlış
 * zihinsel model veriyordu. Üstelik KK1'de aynı 409 hem modal hem kutu satırı
 * doğurduğu için karar iki kez soruluyordu. Kalıcı düşüş artık OLDUĞU ANDA
 * toast ile söylenir (offline/queryClient.ts) ve hiçbir yere yazılmaz —
 * operatör kaydı yeniden girer, sunucudaki mükerrer tuzağı da onu karşılar.
 *
 * ⚠️ KK1'in "etiket çıkmadı" bandıyla KARIŞTIRMA: bu SUNUCUYA YAZILAMAMIŞ
 * kaydı, o basılamamış ETİKETİ anlatır (top kayıtlıdır). İkisi ayrı yüzeydir.
 */
export default function SyncStatusChip() {
  const online = useIsOnline();
  const why = useOfflineReason();
  const pendingCount = usePendingStationOps().length;

  if (online && pendingCount === 0) return null;

  let bg: string = palette.blue[800];
  let dot: string = '#bfdbfe'; // blue 200
  let label = `${pendingCount} sync`;
  if (!online) {
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
    why === 'server'
      ? `Sunucuya ulaşılamıyor${pendingCount > 0 ? `, ${pendingCount} işlem bekliyor` : ''}`
      : online
        ? `${pendingCount} işlem senkronize bekliyor`
        : pendingCount > 0
          ? `Çevrimdışı, ${pendingCount} işlem bekliyor`
          : 'Çevrimdışı';

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(16).stiffness(180).mass(0.7)}
      exiting={FadeOut.duration(160)}
      style={[styles.chipWrap, { backgroundColor: bg }]}
      accessibilityLabel={a11y}
    >
      <View style={styles.chip}>
        <Pulse color={dot} size={8} />
        <Text style={styles.label}>{label}</Text>
      </View>
    </Animated.View>
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
