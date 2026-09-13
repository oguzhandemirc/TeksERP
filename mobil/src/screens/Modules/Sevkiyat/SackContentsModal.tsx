import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Surface, Text, ActivityIndicator, Icon, Divider, Button, IconButton } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import AppModal from '../../../components/AppModal';
import { packingService, type SackStoreShipmentLite } from '../../../services/packing.service';
import { qualityGradeService } from '../../../services/qualityGrade.service';
import { roleOfCode } from '../../../utils/qualityRole';

const fmtM = (m: number) => m.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
const fmtKg = (kg: number | null) => (kg != null ? `${kg.toLocaleString('tr-TR')} kg` : 'tartılmadı');

interface Props {
  shipment: SackStoreShipmentLite | null;
  onDismiss: () => void;
  /** PLANNED sevkiyatta çuval çıkarma — verilirse her çuval başlığında çöp ikonu görünür. */
  onRemoveSack?: (sackId: string, label: string) => void;
  removing?: boolean;
}

/**
 * Çuval Depo kartına tıklayınca açılan içerik modalı. Sevkiyatın çuval+rulo
 * dökümünü LAZY çeker (board listesi rulo taşımaz). Tek sevkiyat = sınırlı kapsam.
 */
export default function SackContentsModal({ shipment, onDismiss, onRemoveSack, removing }: Props) {
  const q = useQuery({
    queryKey: ['sack-contents', shipment?.id],
    queryFn: () => packingService.getShipmentSackContents(shipment!.id),
    enabled: shipment !== null,
    staleTime: 30_000,
  });
  const detail = q.data?.data;
  // Kalite kataloğu — "bu top 1. kalite mi" sorusunu cevaplamak için (karar ①).
  // ⚠️ Bu ekran kataloğu HİÇ yüklemiyordu; o yüzden soruyu ancak gömülü bir
  // literalle cevaplayabiliyordu (`!== '1.KALITE'`). Anahtar diğer ekranlarla
  // AYNI (`['quality-grades','active']`) ⇒ react-query tekilleştirir, maliyet
  // paylaşılan tek fetch. Mantık saf fonksiyonda (`utils/qualityRole.ts`).
  const gradesQuery = useQuery({
    queryKey: ['quality-grades', 'active'],
    queryFn: () => qualityGradeService.list({ pageSize: 100 }),
    staleTime: 10 * 60 * 1000,
  });
  const grades = gradesQuery.data?.data ?? [];

  return (
    <AppModal visible={shipment !== null} onDismiss={onDismiss} position="bottom">
      <Surface style={styles.sheet} elevation={4}>
        {shipment && (
          <>
            <View style={styles.head}>
              <Text style={styles.shipNo}>{shipment.shipmentNo}</Text>
              <Text style={styles.meta}>
                {shipment.sackCount} çuval · {fmtM(shipment.totalQty)}m ·{' '}
                {shipment.totalKg.toLocaleString('tr-TR')} kg
              </Text>
            </View>
            <Text style={styles.customer} numberOfLines={1}>
              {shipment.customer.name}
              {shipment.branch ? ` · ${shipment.branch.name}` : ''}
            </Text>

            {detail && (detail.plateNumber || detail.driverName || detail.carrier) && (
              <View style={styles.transportRow}>
                <Icon source="truck" size={14} color="#64748b" />
                <Text style={styles.transport}>
                  {[detail.plateNumber, detail.driverName, detail.carrier].filter(Boolean).join(' · ')}
                </Text>
              </View>
            )}

            <Divider style={{ marginVertical: 10 }} />

            {q.isLoading ? (
              <ActivityIndicator style={{ marginVertical: 24 }} />
            ) : !detail || detail.sacks.length === 0 ? (
              <Text style={styles.empty}>Bu sevkiyatta çuval yok.</Text>
            ) : (
              <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 8 }}>
                {detail.sacks.map((sk) => (
                  <View key={sk.id} style={styles.sackBlock}>
                    <View style={styles.sackHead}>
                      <View style={styles.sackChip}>
                        <Icon source="sack" size={13} color="#4338ca" />
                        <Text style={styles.sackChipText}>{sk.sackNo || `#${sk.seq}`}</Text>
                      </View>
                      <Text style={styles.sackMeta}>
                        {fmtKg(sk.weightKg)} · {sk.rollCount} top
                        {sk.swatchCount > 0 ? ` · ${sk.swatchCount} kartela` : ''}
                      </Text>
                      {onRemoveSack && (
                        <IconButton
                          icon="close-circle"
                          size={20}
                          iconColor="#dc2626"
                          disabled={removing}
                          style={styles.removeBtn}
                          onPress={() => onRemoveSack(sk.id, sk.sackNo || `#${sk.seq}`)}
                          accessibilityLabel="Çuvalı sevkiyattan çıkar"
                        />
                      )}
                    </View>

                    {sk.rolls.length === 0 && sk.swatches.length === 0 ? (
                      <Text style={styles.emptyText}>Boş çuval.</Text>
                    ) : (
                      <View style={styles.rollList}>
                        {sk.rolls.map((r) => (
                          <View key={r.id} style={styles.rollRow}>
                            <View style={styles.rollLeft}>
                              {r.color?.hex && (
                                <View style={[styles.dot, { backgroundColor: r.color.hex }]} />
                              )}
                              <Text style={styles.barcode} numberOfLines={1}>
                                {r.barcode ?? 'Açık Kumaş'}
                              </Text>
                            </View>
                            <Text style={styles.rollMeta} numberOfLines={1}>
                              {r.item.name}
                              {r.color ? ` · ${r.color.name}` : ''}
                              {r.width != null ? ` · ${r.width}cm` : ''}
                              {/* 1. kalite GİZLENİR (norm), diğerleri yazılır — rol
                                  sorusudur, kod değil. Katalog gelmeden rol
                                  çözülemez; o an kod yazılır (bilgi kaybı yok). */}
                              {r.qualityGrade && roleOfCode(grades, r.qualityGrade) !== 'FIRST'
                                ? ` · ${r.qualityGrade}`
                                : ''}
                            </Text>
                            <Text style={styles.rollQty}>{fmtM(r.qty)}m</Text>
                          </View>
                        ))}
                        {sk.swatches.map((s) => (
                          <View key={s.id} style={styles.rollRow}>
                            <Text style={styles.barcode} numberOfLines={1}>
                              {s.barcode ?? 'Kartela'}
                            </Text>
                            <Text style={styles.rollMeta} numberOfLines={1}>
                              {s.item.name}
                              {s.color ? ` · ${s.color.name}` : ''} · kartela
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}

            <Button mode="contained-tonal" onPress={onDismiss} style={{ marginTop: 10 }}>
              Kapat
            </Button>
          </>
        )}
      </Surface>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: { borderRadius: 16, padding: 16, backgroundColor: '#fff', alignSelf: 'stretch' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shipNo: { fontSize: 15, fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
  meta: { fontSize: 12, color: '#64748b' },
  customer: { fontSize: 13, color: '#334155', marginTop: 2 },
  transportRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  transport: { fontSize: 12, color: '#475569' },
  empty: { fontSize: 13, color: '#94a3b8', textAlign: 'center', marginVertical: 24 },
  scroll: { maxHeight: 380 },
  sackBlock: { marginBottom: 12 },
  sackHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  removeBtn: { margin: 0 },
  sackChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#eef2ff',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sackChipText: { fontSize: 11, fontWeight: '700', color: '#4338ca', fontFamily: 'monospace' },
  sackMeta: { fontSize: 12, color: '#64748b' },
  emptyText: { fontSize: 12, color: '#94a3b8', marginLeft: 4 },
  rollList: { gap: 4 },
  rollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  rollLeft: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  barcode: { fontSize: 12, fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
  rollMeta: { flex: 1, fontSize: 11, color: '#64748b' },
  rollQty: { fontSize: 12, fontWeight: '600', color: '#0f172a', flexShrink: 0 },
});
