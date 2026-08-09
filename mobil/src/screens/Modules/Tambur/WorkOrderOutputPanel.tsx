// =============================================================================
// BU İŞ EMRİNDEN ÇIKAN TOPLAR — Tambur sağ sütun paneli (2026-08-09)
// =============================================================================
// Saha isteği birebir: *"iş emri içindeki topların göründüğü bölümün birkaç
// satır altına bu iş emrinde son çıkan topları gösterdiğimiz bir alan yapalım.
// Orada KALAN değil BASTIĞIM toplam metraj, top sayısı, topların barkodu,
// saat:dk'sını göreyim, yazdırabileyim, geri alabileyim."*
//
// Kapsam kararı: **aktif iş emrinin TÜM çıkan topları** (vardiya/oturum fark
// etmez). "Ben ne yaptım" değil "bu iş ne çıkardı" sorusuna bakar — gece
// vardiyasının çıkardığı toplar da görünür.
//
// ⚠️ BACKEND ZATEN HAZIRDI: `GET /tambur/recent-output-rolls?workOrderId=`
// süzgeci vardı ama hiçbir istemci kullanmıyordu. Yeni uç YAZILMADI.
//
// ⚠️ ÜST SAYAÇ "BASILAN" METRAJDIR, kalan değil: `initialQty` toplanır,
// `currentQty` DEĞİL. Çıkan bir top sonradan kesilirse `currentQty` düşer ve
// "bu işten ne çıktı" sorusunun cevabı geriye dönük küçülürdü.
//
// ⚠️ GERİ ALMA ANA EKRANI DA DEĞİŞTİRİR (kalan metraj artar, kapanmış iş emri
// dirilebilir) → `onUndone` ile parent tazelenir. Tazelenmezse operatör elle
// "yenile"ye basmak zorunda kalır (2026-08-04'te `RecentOutputModal`'da
// birebir bu yaşandı).
// =============================================================================
import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Icon, IconButton, TouchableRipple, ActivityIndicator } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';

import { tamburService } from '../../../services/tambur.service';
import type { Roll } from '../../../types/models';

/** "SS:dd" — panelde tarih GEREKMEZ: kapsam zaten tek iş emri. */
function hhmm(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function WorkOrderOutputPanel({
  workOrderId,
  onPrint,
  onUndo,
}: {
  workOrderId: string | null;
  /** Etiketi yeniden bas — parent'ın yazıcı akışına verir. */
  onPrint: (roll: Roll) => void;
  /** Geri alma önizlemesini aç (yıkıcı-işlem kuralı: onaysız iptal yok). */
  onUndo: (roll: Roll) => void;
}) {
  const q = useQuery({
    queryKey: ['tambur', 'wo-output', workOrderId],
    queryFn: () =>
      tamburService.recentOutputRolls({ workOrderId: workOrderId!, limit: 100, withTotal: true }),
    enabled: !!workOrderId,
    staleTime: 10_000,
  });

  const rolls: Roll[] = useMemo(() => q.data?.data ?? [], [q.data]);
  const totals = useMemo(() => {
    let meters = 0;
    for (const r of rolls) meters += Number(r.initialQty ?? 0);
    return { count: rolls.length, meters };
  }, [rolls]);

  if (!workOrderId) return null;

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Icon source="tray-arrow-up" size={16} color="#1e40af" />
        <Text style={s.headerTitle}>Bu işten çıkanlar</Text>
        <View style={{ flex: 1 }} />
        {q.isFetching ? (
          <ActivityIndicator size={14} color="#1e40af" />
        ) : (
          <IconButton
            icon="refresh"
            size={16}
            onPress={() => void q.refetch()}
            style={{ margin: 0 }}
            accessibilityLabel="Yenile"
          />
        )}
      </View>

      {/* ÜST SAYAÇ — operatörün en çok baktığı iki sayı. "Kalan"la
          karıştırılmasın diye etiket açıkça "Basılan". */}
      <View style={s.totals}>
        <View style={s.totalBox}>
          <Text style={s.totalValue}>{totals.count}</Text>
          <Text style={s.totalLabel}>top</Text>
        </View>
        <View style={s.totalDivider} />
        <View style={s.totalBox}>
          <Text style={s.totalValue}>{totals.meters.toFixed(1)}</Text>
          <Text style={s.totalLabel}>m basılan</Text>
        </View>
      </View>

      {q.isLoading ? (
        <View style={s.empty}>
          <ActivityIndicator color="#94a3b8" />
        </View>
      ) : rolls.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>Bu işten henüz top çıkmadı</Text>
        </View>
      ) : (
        <ScrollView style={s.list} nestedScrollEnabled>
          {rolls.map((r) => (
            <TouchableRipple
              key={r.id}
              onPress={() => onPrint(r)}
              rippleColor="rgba(30,64,175,0.12)"
              style={s.row}
            >
              <View style={s.rowInner}>
                <Text style={s.rowTime}>{hhmm(r.createdAt)}</Text>
                <Text style={s.rowBarcode} numberOfLines={1}>
                  {r.barcode ?? '—'}
                </Text>
                <Text style={s.rowQty}>{Number(r.initialQty ?? 0).toFixed(1)} m</Text>
                <IconButton
                  icon="printer"
                  size={18}
                  iconColor="#1e40af"
                  onPress={() => onPrint(r)}
                  style={s.rowBtn}
                  accessibilityLabel="Etiketi bas"
                />
                <IconButton
                  icon="undo-variant"
                  size={18}
                  iconColor="#b45309"
                  onPress={() => onUndo(r)}
                  style={s.rowBtn}
                  accessibilityLabel="Geri al"
                />
              </View>
            </TouchableRipple>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    // ⚠️ Yükseklik SINIRLI: panel iş emri top listesinin ALTINDA duruyor ve
    // sınırsız büyürse asıl listeyi ekrandan iter. Saha onayı: "klavyenin
    // altında kalabilir bir kısmı sorun değil".
    maxHeight: 260,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
  },
  headerTitle: { fontSize: 13, fontWeight: '800', color: '#1e40af' },
  totals: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 12,
  },
  totalBox: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  totalValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    fontVariant: ['tabular-nums'],
  },
  totalLabel: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  totalDivider: { width: 1, height: 18, backgroundColor: '#cbd5e1' },
  list: { flexGrow: 0 },
  row: { borderTopWidth: 1, borderTopColor: '#eef2f6', backgroundColor: '#fff' },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 2,
    minHeight: 44,
    gap: 8,
  },
  rowTime: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    width: 44,
  },
  // min-w-0 muadili: uzun barkod komşularını ekrandan itmesin.
  rowBarcode: {
    flex: 1,
    minWidth: 0,
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  rowQty: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    fontVariant: ['tabular-nums'],
  },
  rowBtn: { margin: 0, width: 34, height: 34 },
  empty: { paddingVertical: 18, alignItems: 'center' },
  emptyText: { fontSize: 13, color: '#94a3b8' },
});
