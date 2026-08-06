import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon, ActivityIndicator } from 'react-native-paper';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import dayjs from 'dayjs';

import RemoteListSheet from '../../../components/RemoteListSheet';
import {
  workOrderDocumentService,
  printDocument,
  type WorkOrderDocument,
} from '../../../services/workOrderDocuments';
import { colors, spacing, radius } from '../../../theme';

// =============================================================================
// İŞ EMRİ BELGELERİ — sahadaki operatör iş emrine basınca TÜM belgelerine
// ulaşır ve her birini yazdırır. Kaynak TEK uç (`/work-orders/:id/documents`);
// bu ekran listeyi kendisi KURMAZ, yalnız basar — yeni bir belge tipi backend'e
// eklendiğinde burada kod değişmeden görünür.
//
// Grup başlıkları veriden gelir ("İş Emri Belgeleri" + her fason adımının
// istasyon adı). Liste düz; grup değiştiğinde araya başlık satırı basılır —
// SectionList'e geçmemek bilinçli: RemoteListSheet'in loading/error/empty
// kabuğunu ve infinite-scroll sözleşmesini paylaşmak istiyoruz.
// =============================================================================

type Row = { kind: 'header'; key: string; label: string } | { kind: 'doc'; key: string; doc: WorkOrderDocument };

interface Props {
  visible: boolean;
  onDismiss: () => void;
  workOrderId: string | null;
  workOrderNumber?: string | null;
}

export default function WorkOrderDocumentsSheet({
  visible,
  onDismiss,
  workOrderId,
  workOrderNumber,
}: Props) {
  const qc = useQueryClient();
  // Aynı anda yalnız bir baskı — hangi satırın döndüğü görünsün.
  const [printingKey, setPrintingKey] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['work-order-documents', workOrderId],
    queryFn: () => workOrderDocumentService.list(workOrderId as string),
    enabled: visible && Boolean(workOrderId),
  });

  const docs = q.data?.data?.documents ?? [];

  // Grup başlıklarını araya serpiştir. Sıra backend'den geldiği gibi korunur
  // (kart önce, sonra fason belgeleri tarih desc) — istemci yeniden sıralamaz.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastGroup: string | null = null;
    for (const d of docs) {
      if (d.group !== lastGroup) {
        out.push({ kind: 'header', key: `h-${d.group}-${out.length}`, label: d.group });
        lastGroup = d.group;
      }
      out.push({ kind: 'doc', key: `${d.docType}-${d.sourceId}`, doc: d });
    }
    return out;
  }, [docs]);

  const handlePrint = async (doc: WorkOrderDocument, key: string) => {
    if (printingKey) return; // tek soket değil ama çift baskı da istenmez
    setPrintingKey(key);
    try {
      await printDocument(doc);
      if (doc.docType === 'TRAVELER_CARD') {
        // Baskı olayı "bayat" işaretini temizledi → rozetler tazelensin.
        qc.invalidateQueries({ queryKey: ['work-order-documents', workOrderId] });
        qc.invalidateQueries({ queryKey: ['traveler-card-active', workOrderId] });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      // Kullanıcı yazdırma diyaloğunu kapattıysa hata değildir — sessiz geç.
      if (!/cancel|dismiss/i.test(msg)) {
        Toast.show({ type: 'error', text1: 'Belge yazdırılamadı', text2: msg });
      }
    } finally {
      setPrintingKey(null);
    }
  };

  const renderItem = (row: Row) => {
    if (row.kind === 'header') {
      return (
        <Text style={styles.groupHeader}>{row.label.toLocaleUpperCase('tr')}</Text>
      );
    }
    const d = row.doc;
    const busy = printingKey === row.key;
    return (
      <TouchableRipple
        onPress={() => void handlePrint(d, row.key)}
        disabled={busy}
        style={[styles.card, d.cancelled && styles.cardCancelled]}
        borderless={false}
      >
        <View style={styles.cardInner}>
          <View style={styles.cardIcon}>
            <Icon
              source={d.docType === 'TRAVELER_CARD' ? 'card-account-details-outline' : 'file-document-outline'}
              size={22}
              color={d.cancelled ? colors.textMuted : colors.brand}
            />
          </View>
          <View style={styles.cardBody}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {d.title}
              </Text>
              {d.cancelled && <Text style={styles.badgeCancel}>İPTAL</Text>}
              {/* ⚠️ "GÜNCEL DEĞİL" rozeti KALDIRILDI (2026-08-06, kullanıcı kararı) —
                  gerekçe Electron `TravelerCardPrintDialog` başlığında. `contentDirty`
                  yanıtta hâlâ dönüyor; geri koymadan önce oradaki notu oku. */}
            </View>
            <Text style={styles.cardNo} numberOfLines={1}>
              {d.documentNo}
            </Text>
            {!!d.subtitle && (
              <Text style={styles.cardSub} numberOfLines={2}>
                {d.subtitle}
              </Text>
            )}
            <Text style={styles.cardDate}>{dayjs(d.date).format('DD.MM.YYYY HH:mm')}</Text>
          </View>
          <View style={styles.cardAction}>
            {busy ? <ActivityIndicator size={20} /> : <Icon source="printer" size={22} color={colors.textMuted} />}
          </View>
        </View>
      </TouchableRipple>
    );
  };

  return (
    <RemoteListSheet<Row>
      visible={visible}
      onDismiss={onDismiss}
      title={workOrderNumber ? `Belgeler · ${workOrderNumber}` : 'Belgeler'}
      icon="file-document-multiple-outline"
      loading={q.isLoading}
      fetching={q.isFetching}
      isError={q.isError}
      errorMessage={(q.error as Error)?.message}
      onRefresh={() => void q.refetch()}
      items={rows}
      keyExtractor={(r) => r.key}
      renderItem={renderItem}
      emptyIcon="file-document-outline"
      emptyText="Bu iş emrine ait belge yok"
      emptyHint="Refakat kartı iş emri açılışında doğar; fason belgeleri sevk/kabul yapıldıkça listelenir."
      hint={{ text: 'Satıra dokun → belge yazdırılır.', icon: 'printer' }}
      // ScrollView (FlashList değil): liste KISA (bir iş emrinin belgeleri) ve
      // satırlar HETEROJEN (grup başlığı ↔ belge kartı). FlashList farklı tipleri
      // aynı havuzda geri dönüştürür; `getItemType` verilmediğinde başlık ile kart
      // birbirinin yerine kullanılıp kayarken yanlış yükseklik/atlama üretebilir.
      // Sayfalama da yok — kazanç sıfır, risk gerçek.
      useScrollView
      widthRatio={0.94}
      heightRatio={0.9}
    />
  );
}

const styles = StyleSheet.create({
  groupHeader: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  cardCancelled: { opacity: 0.6 },
  cardInner: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.md },
  cardIcon: { width: 32, alignItems: 'center' },
  cardBody: { flex: 1, minWidth: 0, gap: 2 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  badgeCancel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.danger,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  cardNo: { fontSize: 15, fontWeight: '600', color: colors.brand },
  cardSub: { fontSize: 13, color: colors.textMuted },
  cardDate: { fontSize: 12, color: colors.textMuted },
  cardAction: { width: 32, alignItems: 'center' },
});
