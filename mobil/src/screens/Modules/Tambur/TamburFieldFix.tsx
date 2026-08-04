// =============================================================================
// TAMBUR SAHA DÜZELTMESİ — giriş menüsü (iki aksiyonun kapısı)
// =============================================================================
// Tambur operatörü sahada tıkandığında panel başındaki birini beklemesin diye iki
// yetenek: "Topu Buraya Al" (sistemde olan topu bu adıma getir) ve "Manuel Top
// Ekle" (sistemde hiç olmayan topu elle yarat).
//
// NEDEN TEK TETİK + ALT SAYFA (iki ayrı buton değil):
//   • Tambur başlığı zaten dolu (Liste / Tara / Çıkanlar / Kesme / Serbest Etiket
//     + telefonda 2. kat). İki aksiyon daha eklemek her ikisini de sıkıştırırdı.
//   • İkisi de İSTİSNA yolu: normal vardiyada hiç kullanılmaz. Mobil kuralı bunu
//     zaten söylüyor — "manuel/ikincil yol ⋮ menüsünde" (emsal: SackActionsSheet),
//     kartta yalnız sık kullanılan kalır.
//   • Yetki (`mobile:tambur-duzelt` / `roll:manual-adjust`) TEK yerde kapıya
//     konur; yetkisiz operatörde hiçbir iz görünmez (gri/pasif buton YOK — "neden
//     çalışmıyor" sorusu üretir).
//
// Alt modalların ikisi de KARDEŞ DOSYADADIR (`TamburScreen.tsx` ~6000 satır).
// =============================================================================

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Surface, Text, TouchableRipple } from 'react-native-paper';

import AppModal from '../../../components/AppModal';
import TamburBringRollModal from './TamburBringRollModal';
import TamburManualRollModal from './TamburManualRollModal';
import { colors, radius, spacing } from '../../../theme';
import type { QualityGrade } from '../../../types/models';

type Mode = 'menu' | 'bring' | 'manual';

interface Props {
  /** Akış açık mı (menü ya da alt modallardan biri). */
  visible: boolean;
  /** Akışı tamamen kapat — alt modalların "Vazgeç"i de buraya düşer. */
  onDismiss: () => void;
  /** Ekrandaki Tambur adımı (WorkOrderStep) — iki uç da bunu hedef alır. */
  targetStepId: string;
  stationName: string;
  /**
   * Hedef iş emri numarası — MENÜDE AÇIKÇA YAZILIR (2026-08-04 saha geri bildirimi).
   * Önceki hâl "iş emrinden bağımsız bir ekleme yapılıyor" hissi veriyordu; oysa
   * her iki aksiyon da TAM OLARAK bu iş emrinin Tambur adımına yazar (ürün ve renk
   * de ondan miras alınır, operatör değiştiremez).
   */
  workOrderNumber?: string | null;
  qualityGrades: QualityGrade[];
  online: boolean;
  /** Başarılı işlem sonrası — ekran Tambur listesini tazeler. */
  onApplied: () => void;
}

export default function TamburFieldFix({
  visible,
  onDismiss,
  targetStepId,
  stationName,
  workOrderNumber,
  qualityGrades,
  online,
  onApplied,
}: Props) {
  const [mode, setMode] = useState<Mode>('menu');

  // Her açılış menüden başlar (bir önceki akışın yarım formunda açılmasın).
  useEffect(() => {
    if (visible) setMode('menu');
  }, [visible]);

  const close = () => {
    setMode('menu');
    onDismiss();
  };

  return (
    <>
      <AppModal visible={visible && mode === 'menu'} onDismiss={close} position="bottom" contentStyle={styles.wrap}>
        <Surface style={styles.sheet} elevation={4}>
          <Text style={styles.title}>Saha Düzeltmesi</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {stationName} — elindeki mal ekranda görünmüyorsa buradan çöz.
          </Text>

          {/* HEDEF İŞ EMRİ — en üstte, vurgulu. Her iki aksiyon da topu BU iş
              emrinin Tambur adımına yazar; ürün ve renk de ondan gelir. Bunu
              yazmadan ekran "bağımsız bir ekleme" gibi okunuyordu. */}
          {workOrderNumber && (
            <View style={styles.targetBand}>
              <Icon source="clipboard-text-outline" size={18} color={colors.brand} />
              <Text style={styles.targetText}>
                Hedef iş emri: <Text style={styles.targetStrong}>{workOrderNumber}</Text>
                {'  ·  eklenen top bu iş emrine yazılır'}
              </Text>
            </View>
          )}

          {/* Açıklama satırları KALDIRILDI (2026-08-04): hedef iş emri yukarıdaki
              bantta zaten yazıyor, buton adları da ne yaptığını söylüyor. İkisi
              DOLU ve FARKLI renk — yan yana karışmasınlar. */}
          <ActionButton
            icon="database-arrow-right-outline"
            bg="#1d4ed8"
            label="Sistemdeki Topu Bu İşe Aktar"
            onPress={() => setMode('bring')}
          />
          <ActionButton
            icon="plus-box-outline"
            bg="#b45309"
            label="Bu İşe Elle Yeni Top Ekle"
            onPress={() => setMode('manual')}
          />

          <Button onPress={close} style={styles.close}>
            Kapat
          </Button>
        </Surface>
      </AppModal>

      <TamburBringRollModal
        visible={visible && mode === 'bring'}
        onDismiss={close}
        targetStepId={targetStepId}
        stationName={stationName}
        online={online}
        onApplied={onApplied}
      />

      <TamburManualRollModal
        visible={visible && mode === 'manual'}
        onDismiss={close}
        targetStepId={targetStepId}
        stationName={stationName}
        qualityGrades={qualityGrades}
        online={online}
        onCreated={onApplied}
      />
    </>
  );
}

/**
 * Dolu renkli aksiyon butonu — beyaz ikon + beyaz yazı. İki aksiyon FARKLI renk
 * taşır (mavi = mevcut topu aktar, amber = yoktan yeni top): renk tek başına da
 * ayırt edici olsun, operatör metni okumadan doğru tuşa gitsin.
 */
function ActionButton({
  icon,
  bg,
  label,
  onPress,
}: {
  icon: string;
  bg: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple
      onPress={onPress}
      style={[styles.actionBtn, { backgroundColor: bg }]}
      borderless
      rippleColor="rgba(255,255,255,0.24)"
    >
      <View style={styles.rowInner}>
        <Icon source={icon} size={26} color="#fff" />
        <Text style={styles.actionLabel} numberOfLines={2}>
          {label}
        </Text>
        <Icon source="chevron-right" size={22} color="rgba(255,255,255,0.85)" />
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center', marginBottom: spacing.md },
  sheet: {
    width: '100%',
    borderRadius: radius.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, paddingHorizontal: spacing.sm },
  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  // Hedef iş emri bandı — menünün en üstünde, aksiyonlardan önce okunur.
  targetBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  targetText: { flex: 1, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  targetStrong: { fontWeight: '800', color: colors.text, fontFamily: 'monospace' },
  // 56dp+ dokunma hedefi (fabrika eldiveni) — mobil/CLAUDE.md.
  actionBtn: {
    borderRadius: radius.md,
    minHeight: 68,
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  actionLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 21,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  close: { marginTop: spacing.xs },
});
