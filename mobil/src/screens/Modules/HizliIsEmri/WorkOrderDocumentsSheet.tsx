import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Icon, IconButton, ActivityIndicator } from 'react-native-paper';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import RemoteListSheet from '../../../components/RemoteListSheet';
import {
  workOrderDocumentService,
  printDocument,
  type WorkOrderDocument,
} from '../../../services/workOrderDocuments';
import { colors, spacing, radius } from '../../../theme';
import { useDeviceSettingsStore, type DocPageSize } from '../../../store/deviceSettingsStore';
import { upperTr } from '../../../utils/trCase';
import { formatFactory } from '../../../lib/factory-time';
import { TERIM } from '../../../lib/terim';
import { useIncomingScans } from './useIncomingScans';
import type { IncomingScanItem } from './incomingScans';

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

// Gelen belge fotoğrafları listenin EN ÜSTÜNDE (kullanıcı 2026-11-09: Belgeler'de önce kaynak belge görünsün).
type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'scan'; key: string; scan: IncomingScanItem }
  | { kind: 'doc'; key: string; doc: WorkOrderDocument };

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
  // Kâğıt boyu CİHAZDA hatırlanır (kullanıcıda değil): boy, o istasyona bağlı
  // YAZICININ özelliğidir — vardiya değişince yazıcı değişmez.
  const docPageSize = useDeviceSettingsStore((s) => s.docPageSize);
  const setDocPageSize = useDeviceSettingsStore((s) => s.setDocPageSize);
  const clearDocPageSize = useDeviceSettingsStore((s) => s.clearDocPageSize);

  const q = useQuery({
    queryKey: ['work-order-documents', workOrderId],
    queryFn: () => workOrderDocumentService.list(workOrderId as string),
    enabled: visible && Boolean(workOrderId),
  });

  const docs = q.data?.data?.documents ?? [];
  const scans = useIncomingScans(workOrderId, visible);

  // Grup başlıklarını araya serpiştir. Sıra backend'den geldiği gibi korunur
  // (kart önce, sonra fason belgeleri tarih desc) — istemci yeniden sıralamaz.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (scans.items.length > 0) out.push({ kind: 'header', key: 'h-gelen-belge', label: 'Gelen Belge' });
    for (const sc of scans.items) out.push({ kind: 'scan', key: `scan-${sc.scanId}`, scan: sc });
    let lastGroup: string | null = null;
    for (const d of docs) {
      if (d.group !== lastGroup) {
        out.push({ kind: 'header', key: `h-${d.group}-${out.length}`, label: d.group });
        lastGroup = d.group;
      }
      out.push({ kind: 'doc', key: `${d.docType}-${d.sourceId}`, doc: d });
    }
    return out;
  }, [docs, scans.items]);

  const handlePrint = async (doc: WorkOrderDocument, key: string) => {
    if (printingKey) return; // tek soket değil ama çift baskı da istenmez
    setPrintingKey(key);
    try {
      // Kayıt yoksa `undefined` gider ve istemci parametreyi HİÇ göndermez →
      // backend kalıcı ayarı uygular (bugünkü davranış birebir korunur).
      await printDocument(doc, docPageSize[doc.docType]);
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

  const cyclePageSize = async (docType: string) => {
    const cur = docPageSize[docType];
    const next: DocPageSize | null = cur == null ? 'A4' : cur === 'A4' ? 'A5' : null;
    if (next == null) await clearDocPageSize(docType);
    else await setDocPageSize(docType, next);
    Toast.show({ type: 'info', text1: next ? `Kâğıt boyu: ${next}` : 'Kâğıt boyu: belge ayarı', text2: 'Bu cihazda hatırlanır.' });
  };

  // Satır yalnız ikon + belge adı · no (+ gerekiyorsa kısa tarih); eylemler sağda 56dp ikon düğmesi.
  const renderScan = (sc: IncomingScanItem) => {
    const busy = scans.openingId === sc.scanId;
    const sub = [sc.subtitle, sc.blockedReason].filter(Boolean).join(' · ');
    return (
      <View style={[styles.card, !sc.viewable && styles.cardCancelled]} testID={`ie-gelen-belge-${sc.scanId}`}>
        <Icon source="image-outline" size={24} color={sc.viewable ? colors.brand : colors.textMuted} />
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{sc.title}</Text>
          {sub ? <Text style={styles.cardSub}>{sub}</Text> : null}
        </View>
        {busy ? (
          <View style={styles.actionBox}><ActivityIndicator size={22} /></View>
        ) : (
          <IconButton
            icon={sc.viewable ? 'magnify-plus-outline' : 'image-off-outline'}
            size={26}
            onPress={() => void scans.open(sc)}
            disabled={!sc.viewable}
            accessibilityLabel={`Tam ekran aç: ${sc.title}`}
            testID={`ie-gelen-belge-ac-${sc.scanId}`}
            style={styles.actionBtn}
          />
        )}
      </View>
    );
  };

  const renderItem = (row: Row) => {
    if (row.kind === 'header') {
      return <Text style={styles.groupHeader}>{upperTr(row.label)}</Text>;
    }
    if (row.kind === 'scan') return renderScan(row.scan);
    const d = row.doc;
    const busy = printingKey === row.key;
    const size = docPageSize[d.docType] ?? null;
    return (
      <View style={[styles.card, d.cancelled && styles.cardCancelled]} testID={`ie-belge-${row.key}`}>
        <Icon
          source={d.docType === 'TRAVELER_CARD' ? 'card-account-details-outline' : 'file-document-outline'}
          size={24}
          color={d.cancelled ? colors.textMuted : colors.brand}
        />
        <View style={styles.cardBody}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>{[d.title, d.documentNo].filter(Boolean).join(' · ')}</Text>
            {d.cancelled && <Text style={styles.badgeCancel}>İPTAL</Text>}
            {/* ⚠️ "GÜNCEL DEĞİL" rozeti KALDIRILDI (2026-08-06, kullanıcı kararı) — gerekçe Electron
                `TravelerCardPrintDialog` başlığında; `contentDirty` yanıtta hâlâ dönüyor. */}
          </View>
          <Text style={styles.cardSub}>{formatFactory(d.date, 'dd.MM.yyyy')}</Text>
        </View>
        {/* Kâğıt boyu üç durumlu (belge ayarı → A4 → A5 → belge ayarı): mobil sunucunun kalıcı ayarını bilmez,
            "belge ayarı" durumu kaldırılmamalı. Seçim varsa ikonun altında küçük yazar; değişim tostla söylenir. */}
        <View style={styles.actionBox}>
          <IconButton
            icon="cog-outline"
            size={22}
            onPress={() => void cyclePageSize(d.docType)}
            disabled={busy}
            accessibilityLabel={`Kâğıt boyu: ${size ?? 'belge ayarı'}`}
            testID={`ie-belge-boyut-${row.key}`}
            style={styles.actionBtn}
          />
          {size ? <Text style={styles.sizeCaption}>{size}</Text> : null}
        </View>
        {busy ? (
          <View style={styles.actionBox}><ActivityIndicator size={22} /></View>
        ) : (
          <IconButton
            icon="printer"
            size={26}
            onPress={() => void handlePrint(d, row.key)}
            accessibilityLabel={`Yazdır: ${d.title}`}
            testID={`ie-belge-yazdir-${row.key}`}
            style={styles.actionBtn}
          />
        )}
      </View>
    );
  };

  return (
    <>
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
      emptyText={`Bu ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} ait belge yok`}
      emptyHint={`Refakat kartı ${TERIM.terbiyeIsEmri.tekilKucuk} açılışında doğar; fason belgeleri sevk/kabul yapıldıkça listelenir.`}
      // ScrollView (FlashList değil): liste KISA (bir iş emrinin belgeleri) ve
      // satırlar HETEROJEN (grup başlığı ↔ belge kartı). FlashList farklı tipleri
      // aynı havuzda geri dönüştürür; `getItemType` verilmediğinde başlık ile kart
      // birbirinin yerine kullanılıp kayarken yanlış yükseklik/atlama üretebilir.
      // Sayfalama da yok — kazanç sıfır, risk gerçek.
      useScrollView
      widthRatio={0.94}
      heightRatio={0.9}
    />
    {/* Görüntüleyici listenin KARDEŞİ: sonra mount olan portal üstte kalır, kapanınca listeye dönülür. */}
    {scans.viewer}
    </>
  );
}

// Kart ve başlık aynı yatay iç boşlukla (ScrollView kipinde RemoteListSheet liste dolgusu vermez).
const EDGE = spacing.xl;

const styles = StyleSheet.create({
  groupHeader: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    marginHorizontal: EDGE,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 72,
    marginHorizontal: EDGE,
    marginBottom: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardCancelled: { opacity: 0.6 },
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
  cardSub: { fontSize: 13, color: colors.textMuted },
  actionBox: { minWidth: 56, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  actionBtn: { margin: 0, width: 56, height: 56 },
  sizeCaption: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: -8 },
});
