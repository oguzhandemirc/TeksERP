import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon, ActivityIndicator } from 'react-native-paper';
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

  /**
   * Kâğıt boyu rozeti — ÜÇ durumlu: `Ayar → A4 → A5 → Ayar`.
   *
   * ⚠️ "Ayar" durumu ŞART ve kaldırılmamalı. Mobil, sunucudaki KALICI belge
   * ayarının ne olduğunu BİLMİYOR; rozette varsayılan olarak "A4" göstermek,
   * ayar A5 iken ekranın YALAN söylemesi olurdu. Üçüncü durum hem dürüst hem de
   * geri dönülebilir: operatör seçimini iptal edip kalıcı ayara dönebilir.
   * (İki durumlu yapılırsa "kalıcı ayarı kullan" hâline bir daha ulaşılamaz.)
   */
  const cyclePageSize = async (docType: string) => {
    const cur = docPageSize[docType];
    const next: DocPageSize | null = cur == null ? 'A4' : cur === 'A4' ? 'A5' : null;
    if (next == null) await clearDocPageSize(docType);
    else await setDocPageSize(docType, next);
  };

  const renderScan = (sc: IncomingScanItem) => {
    const busy = scans.openingId === sc.scanId;
    return (
      <TouchableRipple
        onPress={() => void scans.open(sc)}
        disabled={busy || !sc.viewable}
        style={[styles.card, styles.cardScan, !sc.viewable && styles.cardCancelled]}
        borderless={false}
        accessibilityLabel={`${sc.title} ${sc.subtitle}`}
        testID={`ie-gelen-belge-${sc.scanId}`}
      >
        <View style={styles.cardInner}>
          <View style={styles.cardIcon}>
            <Icon source="image-outline" size={22} color={sc.viewable ? colors.brand : colors.textMuted} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {sc.title}
            </Text>
            <Text style={styles.cardSub}>{sc.blockedReason ? `${sc.subtitle} · ${sc.blockedReason}` : sc.subtitle}</Text>
          </View>
          <View style={styles.cardAction}>
            {busy ? <ActivityIndicator size={20} /> : <Icon source={sc.viewable ? 'magnify-plus-outline' : 'image-off-outline'} size={24} color={colors.textMuted} />}
          </View>
        </View>
      </TouchableRipple>
    );
  };

  const renderItem = (row: Row) => {
    if (row.kind === 'header') {
      return (
        <Text style={styles.groupHeader}>{upperTr(row.label)}</Text>
      );
    }
    if (row.kind === 'scan') return renderScan(row.scan);
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
            <Text style={styles.cardDate}>{formatFactory(d.date, 'dd.MM.yyyy HH:mm')}</Text>
          </View>
          <View style={styles.cardAction}>
            {/* KÂĞIT BOYU ROZETİ — dokunmak BASMAZ, yalnız boyu değiştirir.
                İç TouchableRipple dokunmayı yakalar (RN responder sistemi:
                en içteki kazanır), bu yüzden kartın baskı onPress'i tetiklenmez. */}
            <TouchableRipple
              onPress={() => void cyclePageSize(d.docType)}
              disabled={busy}
              style={styles.sizeBadge}
              borderless={false}
            >
              <Text style={styles.sizeBadgeText}>{docPageSize[d.docType] ?? 'Ayar'}</Text>
            </TouchableRipple>
            {busy ? <ActivityIndicator size={20} /> : <Icon source="printer" size={22} color={colors.textMuted} />}
          </View>
        </View>
      </TouchableRipple>
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
      hint={{
        text: 'Gelen belge fotoğrafına dokun → tam ekran açılır. Diğer satırlara dokun → yazdırılır; kâğıt boyu için sağdaki kutu (bu cihazda hatırlanır).',
        icon: 'printer',
      }}
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
  cardScan: { minHeight: 56, borderColor: colors.brand },
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
  // Rozet + yazıcı ikonu alt alta; genişlik rozete göre büyüdü.
  cardAction: { width: 56, alignItems: 'center', gap: 6 },
  // ⚠️ Dokunma hedefi bilerek geniş (min 44dp): eldivenli operatör rozete
  // isabet edemezse kartın baskı onPress'i tetiklenir ve YANLIŞLIKLA basar.
  sizeBadge: {
    minWidth: 44,
    minHeight: 30,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeBadgeText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
});
