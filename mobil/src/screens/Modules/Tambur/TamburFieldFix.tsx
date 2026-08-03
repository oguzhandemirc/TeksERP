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

          <ActionRow
            icon="arrow-left-bold-box-outline"
            tint={colors.brand}
            label="Topu Buraya Al"
            hint="Sistemde kayıtlı bir topu bu Tambur adımına getir (önce ne olacağını gösterir)"
            onPress={() => setMode('bring')}
          />
          <ActionRow
            icon="plus-box-outline"
            tint={colors.action}
            label="Manuel Top Ekle"
            hint="Sistemde hiç kaydı olmayan topu elle ekle — metraj + sebep zorunlu"
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

function ActionRow({
  icon,
  tint,
  label,
  hint,
  onPress,
}: {
  icon: string;
  tint: string;
  label: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple onPress={onPress} style={styles.row} borderless>
      <View style={styles.rowInner}>
        <Icon source={icon} size={26} color={tint} />
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowHint}>{hint}</Text>
        </View>
        <Icon source="chevron-right" size={22} color={colors.textMuted} />
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
  // 56dp+ dokunma hedefi (fabrika eldiveni) — mobil/CLAUDE.md.
  row: { borderRadius: radius.md, minHeight: 64, justifyContent: 'center' },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  rowHint: { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
  close: { marginTop: spacing.xs },
});
