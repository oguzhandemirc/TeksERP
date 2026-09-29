import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import Pulse from './motion/Pulse';
import { palette, radius, spacing } from '../theme';
import { useIsOnline, useOfflineReason, usePendingStationOps } from '../offline/hooks';
import type { OfflineReason } from '../offline/serverReachability';

/**
 * Bağlantı DURUMU rozeti — istasyon ekranlarının header'ında ortak.
 *
 * Dört durum:
 *  - online + bekleyen>0  → "N sync"        (mavi, nabız atan nokta = aktarım)
 *  - online + lisans reddi → "Lisans nedeniyle bekleyen N kayıt" (amber; kayıt silinmez)
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
/** Nabız noktası renkleri (açık tonlar; zemin koyu). */
const DOT = { blue: '#bfdbfe', red: '#fecaca', amber: '#fde68a' } as const;

/** Çipin görünümü — saf karar (null = çizilmez). `licensePending` ⊆ `pending`. */
export function syncChipView(
  online: boolean,
  why: OfflineReason,
  pending: number,
  licensePending: number,
): { bg: string; dot: string; label: string; a11y: string } | null {
  if (online && pending === 0) return null;
  if (online && licensePending > 0) {
    // D7: lisans reddi kaydı SİLMEZ; kayıt kuyrukta uzun aralıkla bekler. Sebep AYRI söylenir —
    // "sync" ya da "çevrimdışı" sanılırsa operatör ağla uğraşır, iş yöneticinindir.
    const others = pending - licensePending;
    const label = `Lisans nedeniyle bekleyen ${licensePending} kayıt${others > 0 ? ` · ${others} sync` : ''}`;
    return { bg: palette.amber[700], dot: DOT.amber, label, a11y: label };
  }
  if (online) {
    const label = `${pending} sync`;
    return { bg: palette.blue[800], dot: DOT.blue, label, a11y: `${pending} işlem senkronize bekliyor` };
  }
  // SEBEBİ SÖYLE. "Çevrimdışı" tek başına operatörü yanlış işe yönlendiriyordu:
  // ağ linki varken sunucu ölüyse tablette wifi'yle uğraşmanın faydası yok,
  // haber verilmesi gereken IT'dir. İki durum ayrı metin, ayrı ikon rengi.
  const serverDown = why === 'server';
  let label = serverDown ? 'SUNUCUYA ULAŞILAMIYOR' : 'Çevrimdışı';
  if (pending > 0) label += ` · ${pending} sırada`;
  const a11y = serverDown
    ? `Sunucuya ulaşılamıyor${pending > 0 ? `, ${pending} işlem bekliyor` : ''}`
    : pending > 0
      ? `Çevrimdışı, ${pending} işlem bekliyor`
      : 'Çevrimdışı';
  return {
    bg: pending > 0 ? palette.red[700] : palette.amber[700],
    dot: pending > 0 ? DOT.red : DOT.amber,
    label,
    a11y,
  };
}

export default function SyncStatusChip() {
  const online = useIsOnline();
  const why = useOfflineReason();
  const ops = usePendingStationOps();
  const view = syncChipView(online, why, ops.length, ops.filter((o) => o.licenseBlocked).length);
  if (!view) return null;
  const { bg, dot, label, a11y } = view;

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
