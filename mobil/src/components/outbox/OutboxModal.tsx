// =============================================================================
// OutboxModal — "Kayıt Kuyruğu": bekleyen + KALICI DÜŞMÜŞ istasyon kayıtları
// =============================================================================
// Deseni KK1'in `PrintQueueModal`'ından alır (aynı operatör, aynı okuma alışkanlığı):
// üstte "Başarısız (N)" bölümü + satır başına aksiyon, altta "Sırada (N)".
//
// ⚠️ YAZICI KUYRUĞUYLA KARIŞTIRMA: o "N ETİKET HATALI" der ve etiket BASIMINI
// anlatır; bu "N KAYIT HATALI" der ve SUNUCUYA YAZILAMAMIŞ kaydı anlatır.
// İkisinin ikonu ve metni bilinçli olarak ayrıştırıldı.
// =============================================================================

import React, { useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Icon, IconButton, Text } from 'react-native-paper';
import AppModal from '../AppModal';
import ConfirmDialog from '../ConfirmDialog';
import { colors, palette, radius, spacing } from '../../theme';
import { useFailedOps, type FailedOp } from '../../offline/failedOps';
import { retryFailedOp } from '../../offline/retryFailedOp';
import { stationOpLabel } from '../../offline/mutations';
import { usePendingStationOps } from '../../offline/hooks';
import { formatRelativeWait } from '../../utils/relativeTime';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** KK1'den enjekte edilen yetenek — yazıcı kuyruğu yalnız o ekranda var. */
  onPrintBarcode?: (barcode: string) => void;
  online: boolean;
}

/** Payload'ın operatöre anlamlı özeti. Ham `variables` GÖSTERİLMEZ. */
function describeVars(row: FailedOp): string | null {
  const v = row.variables as Record<string, unknown> | null;
  if (!v || typeof v !== 'object') return null;
  const parts: string[] = [];
  if (typeof v.initialQty === 'number') parts.push(`${v.initialQty} mt`);
  if (typeof v.width === 'number' && v.width > 0) parts.push(`en ${v.width} cm`);
  if (typeof v.barcode === 'string') parts.push(v.barcode);
  return parts.length ? parts.join(' · ') : null;
}

export default function OutboxModal({ visible, onDismiss, onPrintBarcode, online }: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const rows = useFailedOps((s) => s.rows);
  const clear = useFailedOps((s) => s.clear);
  const pending = usePendingStationOps();
  const [confirmDelete, setConfirmDelete] = useState<FailedOp | null>(null);

  return (
    <>
      <AppModal visible={visible} onDismiss={onDismiss}>
        <View style={[styles.card, { width: Math.min(winW - 32, 620), maxHeight: winH * 0.85 }]}>
          <View style={styles.header}>
            <Icon source="tray-arrow-up" size={22} color={colors.brand} />
            <Text style={styles.title}>Kayıt Kuyruğu</Text>
            <View style={{ flex: 1 }} />
            <IconButton icon="close" size={20} onPress={onDismiss} accessibilityLabel="Kapat" />
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator>
            {rows.length === 0 && pending.length === 0 ? (
              <Text style={styles.empty}>
                Her şey gönderildi.{'\n'}Bekleyen ya da gönderilemeyen işlem yok.
              </Text>
            ) : null}

            {rows.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>GÖNDERİLEMEYEN İŞLEMLER ({rows.length})</Text>
                <View style={styles.warnBox}>
                  <Icon source="alert" size={18} color={palette.red[700]} />
                  <Text style={styles.warnText}>
                    Bu işlemler bilgisayara <Text style={styles.warnStrong}>ULAŞMADI</Text> —
                    sistemde kaydı YOK. Sen karar verene kadar burada dururlar, kaybolmazlar.
                  </Text>
                </View>
                {rows.map((row) => {
                  const isDup = row.code === 'POSSIBLE_DUPLICATE';
                  const meta = describeVars(row);
                  return (
                    <View key={row.id} style={styles.row}>
                      <View style={styles.rowHead}>
                        <Icon source="alert-circle" size={18} color={palette.red[600]} />
                        <Text style={styles.rowTitle}>{stationOpLabel(row.key)}</Text>
                        <Text style={styles.rowTime}>
                          {formatRelativeWait(new Date(row.failedAt))}
                        </Text>
                      </View>
                      {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
                      <Text style={styles.rowMsg}>{row.message}</Text>
                      {/* Ne yapacağını SÖYLE — hata metni "ne oldu"yu anlatır,
                          operatörün ihtiyacı olan "şimdi ne yapayım"dır. */}
                      <Text style={styles.rowAsk}>
                        {isDup
                          ? `Elindeki top ${row.barcode ?? 'kayıtlı top'} ile AYNI mı, yoksa ikinci bir top mu?`
                          : 'Top hâlâ elindeyse tekrar gönder; yoksa bu işlemden vazgeç.'}
                      </Text>

                      {/* RENK = SONUÇ. Operatör metni okumadan da ayırt edebilmeli:
                          AMBER = yeni kayıt DOĞURUR (geri alması zor) ·
                          MOR   = aynı işi tekrar dener (yeni kayıt doğurmaz) ·
                          MAVİ  = yalnız kâğıt basar, veriye dokunmaz ·
                          KIRMIZI = kaydı yok eder. */}
                      <View style={styles.actions}>
                        {isDup ? (
                          <Button
                            mode="contained"
                            icon="plus-box"
                            buttonColor={colors.warningDark}
                            textColor="#fff"
                            onPress={() => retryFailedOp(row, { confirmDuplicate: true })}
                            style={styles.btn}
                            contentStyle={styles.btnContent}
                          >
                            AYRI TOP — Yine de Kaydet
                          </Button>
                        ) : (
                          <Button
                            mode="contained"
                            icon="refresh"
                            buttonColor={colors.brand}
                            textColor="#fff"
                            onPress={() => retryFailedOp(row)}
                            style={styles.btn}
                            contentStyle={styles.btnContent}
                          >
                            Tekrar Gönder
                          </Button>
                        )}
                        {row.barcode && onPrintBarcode ? (
                          <Button
                            mode="outlined"
                            icon="printer"
                            // Etiket basımı topu SUNUCUDAN okumayı gerektirir →
                            // çevrimdışıyken sebebi söylenerek kapatılır.
                            disabled={!online}
                            textColor={colors.infoDark}
                            // ⚠️ Basmak satırı SİLMEZ (bilinçli). Kutunun sözü
                            // "karar verene kadar kaybolmaz"; etiket basmak bu
                            // kayıt hakkında bir KARAR değil, teşhistir. Karar
                            // "AYRI TOP" / "Tekrar Gönder" / "Sil"dir.
                            onPress={() => onPrintBarcode(row.barcode!)}
                            style={[styles.btn, { borderColor: colors.infoDark, borderWidth: 1.5 }]}
                            contentStyle={styles.btnContent}
                          >
                            Var Olanın Etiketini Bas
                          </Button>
                        ) : null}
                        <Button
                          mode="outlined"
                          icon="trash-can-outline"
                          textColor={colors.dangerDark}
                          onPress={() => setConfirmDelete(row)}
                          style={[styles.btn, { borderColor: colors.dangerDark, borderWidth: 1.5 }]}
                          contentStyle={styles.btnContent}
                        >
                          Vazgeç, Sil
                        </Button>
                      </View>

                      {row.barcode && !onPrintBarcode ? (
                        <Text style={styles.rowHint}>
                          Etiket basmak için Ham Giriş ekranını aç.
                        </Text>
                      ) : null}
                      {row.barcode && onPrintBarcode && !online ? (
                        <Text style={styles.rowHint}>
                          Etiket basmak için ağ bağlantısı gerekir — şu an çevrimdışısın.
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </>
            ) : null}

            {pending.length > 0 ? (
              <>
                <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>
                  SIRADA BEKLEYENLER ({pending.length})
                </Text>
                <Text style={styles.sectionHint}>
                  Bunlar yolda. Ağ bağlantısı gelince kendiliğinden gönderilir —
                  yapman gereken bir şey yok.
                </Text>
              </>
            ) : null}
          </ScrollView>
        </View>
      </AppModal>

      <ConfirmDialog
        visible={!!confirmDelete}
        kind="destructive"
        title="Bu işlemden vazgeç"
        description={
          'Bu top sisteme KAYDEDİLMEDİ. Silersen bir daha gönderilmez ve hiçbir yerde izi kalmaz — ' +
          'yani depoda bu top hiç girilmemiş sayılır.\n\n' +
          'Elindeki top gerçekten varsa SİLME: "Tekrar Gönder" ya da "AYRI TOP — Yine de Kaydet" seç.'
        }
        confirmLabel="Evet, Sil"
        onConfirm={() => {
          if (confirmDelete) clear(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onDismiss={() => setConfirmDelete(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceSunken,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  body: { padding: spacing.lg, paddingTop: spacing.md },
  empty: {
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    fontSize: 16,
    lineHeight: 24,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  sectionHint: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: spacing.sm },
  // Kırmızı zeminli uyarı bandı — operatör metni okumadan da "burada bir sorun
  // var" sinyalini alsın (fabrika ışığında düz gri açıklama fark edilmiyor).
  warnBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.dangerContainer,
    borderLeftWidth: 4,
    borderLeftColor: palette.red[600],
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  warnText: { flex: 1, color: palette.red[900], fontSize: 14, lineHeight: 20 },
  warnStrong: { fontWeight: '900' },
  btn: { borderRadius: radius.md },
  // 56dp dokunma hedefi (CLAUDE.md UI kuralı) — eldivenli parmak için.
  btnContent: { height: 52, paddingHorizontal: spacing.md },
  row: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: palette.red[500],
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { color: colors.text, fontWeight: '700', fontSize: 15, flex: 1 },
  rowTime: { color: colors.textMuted, fontSize: 12 },
  rowMeta: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  rowMsg: { color: palette.red[700], fontSize: 14, marginTop: spacing.xs, lineHeight: 20 },
  rowAsk: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  rowHint: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs, fontStyle: 'italic' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});
