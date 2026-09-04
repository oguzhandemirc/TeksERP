import React, { useState } from 'react';
import { View, StyleSheet, useWindowDimensions, ScrollView } from 'react-native';
import AppModal from '../AppModal';
import ModalTextInput from '../ModalTextInput';
import {
  Text,
  Surface,
  IconButton,
  Button,
  Icon,
  ActivityIndicator,
  TouchableRipple,
} from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import { labelService } from '../../services/label.service';
import { usePermissions } from '../../hooks/usePermission';
import type { LabelPayload, NameSource } from '../../types/models';

// =============================================================================
// Refactor 6 + 7 — Etiket önizleme + müşteri-isim override + audit print
// =============================================================================
// - `getRollLabel` ile effective payload alır (cascade ile)
// - Source badge yazı olarak (OVERRIDE "Özel", MASTER "Müşteri", DEFAULT "Standart")
// - `label:edit` yetkili ise modal ile OrderLine override yapar
// - `label:print` yetkili ise audit eventi atar (asıl baskı parent'ta)
// - Açık kumaş Roll'lar (barcode null) için "etiket basılamaz" mesajı
// =============================================================================

interface Props {
  visible: boolean;
  rollId: string | null;
  onDismiss: () => void;
  /** "Bas" — varolan etiketi AYNEN tekrar bas (parent yazıcı tetikler). */
  onPrint?: (payload: LabelPayload) => void;
  /** "Yeni Etiket" — yönlendir: "Etiket kime?" seçip yeni etiket bas. Verilirse
   *  "Bas"ın yanında ikinci buton görünür. */
  onNewLabel?: () => void;
  /** "Müşterisiz (Stok)" — müşteri bilgisi OLMADAN tek dokunuşta bas. Verilirse
   *  "Bas"ın yanında üçüncü buton görünür (parent {stock:true} ile basar). */
  onPrintStock?: () => void;
}

function sourceInfo(s: NameSource | null): { short: string; label: string } {
  if (s === 'OVERRIDE') return { short: 'Özel', label: 'Bu sipariş için özel' };
  if (s === 'MASTER') return { short: 'Müşteri', label: 'Müşteri tanımı (master)' };
  return { short: 'Standart', label: 'Standart ad' };
}

export function LabelPreviewSheet({ visible, rollId, onDismiss, onPrint, onNewLabel, onPrintStock }: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  // Telefonda (dar) modal neredeyse tam en; tablette dengeli/orta genişlik.
  const phone = winW < 600;
  const { has } = usePermissions();
  // Backend `requireAnyPermission(label:*, ...MOBILE_LABEL_PRINTERS)` ile hizalı —
  // mobil istasyon operatörü (kk1/tambur/tarti-paket) label:read/print yetkisi
  // olmadan da kendi ekranında etiket görür+basar. canEdit web-only kalır.
  const isMobileLabelOperator =
    has('mobile:kk1') || has('mobile:tambur') || has('mobile:tarti-paket');
  const canRead = has('label:read') || isMobileLabelOperator;
  const canEdit = has('label:edit');
  const canPrint = has('label:print') || isMobileLabelOperator;
  const qc = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [editItemName, setEditItemName] = useState('');
  const [editColorName, setEditColorName] = useState('');

  const labelQuery = useQuery({
    queryKey: ['label', 'roll', rollId],
    queryFn: () => labelService.getRollLabel(rollId!),
    enabled: visible && !!rollId && canRead,
  });

  const payload: LabelPayload | null = labelQuery.data?.data ?? null;
  // Etiket Stüdyosu v2: şablon yorumu tamamen backend'te (kanvas varyantları).
  // Bu sayfa VERİ özeti gösterir — alan filtresi yok; gerçek etiket görünümü
  // baskı çıktısında/Electron Stüdyo önizlemesinde.

  const updateMut = useMutation({
    mutationFn: (data: { customerItemName: string | null; customerColorName: string | null }) =>
      labelService.updateOrderLineCustomerNames(payload!.orderLineId!, data),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Müşteri ismi güncellendi' });
      qc.invalidateQueries({ queryKey: ['label', 'roll'] });
      setEditOpen(false);
    },
    onError: (err: Error) => {
      Toast.show({ type: 'error', text1: 'Güncellenemedi', text2: err.message });
    },
  });

  const printMut = useMutation({
    mutationFn: (ctx?: { stock?: boolean }) =>
      labelService.recordPrintEvent(
        rollId!,
        ctx?.stock
          ? { stock: true }
          : payload?.orderLineId
            ? { orderLineId: payload.orderLineId }
            : undefined,
      ),
    onError: (err: Error) => {
      // Audit hatası baskıyı engellemez — sadece log.
      console.warn('Print audit failed', err.message);
    },
  });

  const handlePrint = () => {
    if (!payload) return;
    onPrint?.(payload);
    // Audit izi (async, beklenmiyor)
    printMut.mutate(undefined);
  };

  // "Müşterisiz (Stok)" — müşteri bilgisi OLMADAN bas. Parent {stock:true} ile
  // yazıcıyı tetikler; audit snapshot'ı stok işaretler (bozuk müşteri düzelir).
  const handlePrintStock = () => {
    if (!payload) return;
    onPrintStock?.();
    printMut.mutate({ stock: true });
  };

  const openEdit = () => {
    if (!payload) return;
    setEditItemName(payload.itemNameSource === 'OVERRIDE' ? payload.itemName : '');
    setEditColorName(payload.colorNameSource === 'OVERRIDE' ? (payload.colorName ?? '') : '');
    setEditOpen(true);
  };

  if (!canRead) {
    return (
      <AppModal visible={visible} onDismiss={onDismiss}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Yetki yok</Text>
          <Text style={styles.body}>Bu top için etiket görüntüleme yetkin yok.</Text>
          <Button onPress={onDismiss}>Kapat</Button>
        </View>
      </AppModal>
    );
  }

  return (
    <>
      <AppModal visible={visible} onDismiss={onDismiss}>
        <View
          style={[
            styles.sheet,
            { width: phone ? winW * 0.94 : winW * 0.55, maxHeight: winH * 0.85 },
          ]}
        >
          <View style={styles.header}>
            <Icon source="label" size={22} color="#1e40af" />
            <Text variant="titleMedium" style={styles.title}>
              Etiket Önizleme
            </Text>
            <View style={{ flex: 1 }} />
            <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
          </View>

          {labelQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#1e40af" />
            </View>
          ) : labelQuery.isError ? (
            <View style={styles.loadingWrap}>
              <Text style={styles.errorText}>
                Etiket alınamadı: {(labelQuery.error as Error).message}
              </Text>
            </View>
          ) : !payload ? (
            <View style={styles.loadingWrap}>
              <Text style={styles.body}>Veri yok</Text>
            </View>
          ) : !payload.barcode ? (
            <View style={styles.loadingWrap}>
              <Icon source="alert-circle-outline" size={36} color="#94a3b8" />
              <Text style={styles.body}>
                Bu Roll için etiket basılamaz — açık kumaş (Kurşun/KK2 öncesi)
                fiziksel etiket almaz.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scrollBody}>
              <PreviewBody payload={payload} />
            </ScrollView>
          )}

          {payload?.barcode && (
            <View style={styles.actions}>
              {canEdit && payload.orderLineId && (
                <Button
                  mode="outlined"
                  icon="pencil"
                  onPress={openEdit}
                  disabled={updateMut.isPending}
                >
                  Düzenle
                </Button>
              )}
              {canPrint && onNewLabel && (
                <Button
                  mode="outlined"
                  icon="tag-plus-outline"
                  textColor="#4338ca"
                  onPress={onNewLabel}
                >
                  Yeni Etiket
                </Button>
              )}
              {canPrint && onPrintStock && (
                <Button
                  mode="outlined"
                  icon="account-off-outline"
                  textColor="#0f766e"
                  onPress={handlePrintStock}
                >
                  Müşterisiz (Stok)
                </Button>
              )}
              {canPrint && (
                <Button
                  mode="contained"
                  icon="printer"
                  buttonColor="#1e40af"
                  onPress={handlePrint}
                >
                  Bas
                </Button>
              )}
            </View>
          )}
        </View>
      </AppModal>

      <AppModal
        visible={editOpen}
        onDismiss={() => setEditOpen(false)}
        dismissable={!updateMut.isPending}
        position="bottom"
      >
        {/* position="bottom": alttan sheet klavye açılınca tam yukarı kalkar →
            2. input (Renk Adı) + Kaydet kısa/yatay ekranda da klavye üstünde
            kalır. alignSelf:'center' bottom stretch'inde sheet'i yatayda ortalar. */}
        <View
          style={[
            styles.sheet,
            { width: phone ? winW * 0.94 : winW * 0.5, alignSelf: 'center', maxHeight: winH * 0.9 },
          ]}
        >
          <View style={styles.header}>
            <Icon source="pencil" size={22} color="#7c3aed" />
            <Text variant="titleMedium" style={styles.title}>
              Müşteri İsmini Düzenle
            </Text>
            <View style={{ flex: 1 }} />
            <IconButton
              icon="close"
              size={22}
              onPress={() => setEditOpen(false)}
              style={{ margin: 0 }}
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>
            <Text style={styles.body}>
              UYARI: Bu OrderLine'a bağlı TÜM rulleri etkiler (sipariş seviyesi).
              Boş gönderirseniz override silinir, master/default ad geri döner.
            </Text>
            <Text style={styles.label}>Müşterideki Ürün Adı</Text>
            <ModalTextInput
              mode="outlined"
              value={editItemName}
              onChangeText={setEditItemName}
              placeholder={
                payload?.itemNameSource === 'MASTER'
                  ? `Master: ${payload?.itemName}`
                  : `Default: ${payload?.itemNameDefault}`
              }
              dense
              style={styles.input}
            />
            <Text style={styles.label}>Müşterideki Renk Adı</Text>
            <ModalTextInput
              mode="outlined"
              value={editColorName}
              onChangeText={setEditColorName}
              placeholder={
                payload?.colorNameSource === 'MASTER'
                  ? `Master: ${payload?.colorName}`
                  : payload?.colorNameDefault
                    ? `Default: ${payload.colorNameDefault}`
                    : 'Renk yok'
              }
              dense
              style={styles.input}
            />
          </ScrollView>
          <View style={styles.actions}>
            <Button
              mode="outlined"
              onPress={() => setEditOpen(false)}
              disabled={updateMut.isPending}
            >
              Vazgeç
            </Button>
            <Button
              mode="contained"
              icon="check"
              buttonColor="#7c3aed"
              loading={updateMut.isPending}
              onPress={() =>
                updateMut.mutate({
                  customerItemName: editItemName.trim() || null,
                  customerColorName: editColorName.trim() || null,
                })
              }
            >
              Kaydet
            </Button>
          </View>
        </View>
      </AppModal>
    </>
  );
}

function PreviewBody({ payload }: { payload: LabelPayload }) {
  // Tüm dolu alanlar gösterilir — şablon/varyant seçimi baskı anında backend'te.
  const show = (_key: string) => true;

  return (
    <Surface style={styles.preview} elevation={1}>
      {show('barcode') && (
        <View style={styles.line}>
          <Text style={styles.k}>Barkod</Text>
          <Text style={styles.vCode}>{payload.barcode ?? '—'}</Text>
        </View>
      )}
      {show('itemName') && (
        <View style={styles.lineWithBadge}>
          <View style={{ flex: 1 }}>
            <Text style={styles.k}>Ürün</Text>
            <Text style={styles.vBold}>{payload.itemName}</Text>
            {payload.itemNameSource !== 'DEFAULT' && (
              <Text style={styles.subtleText}>Bizdeki ad: {payload.itemNameDefault}</Text>
            )}
          </View>
          <SourceBadge source={payload.itemNameSource} />
        </View>
      )}
      {show('colorName') && payload.colorName && (
        <View style={styles.lineWithBadge}>
          <View style={{ flex: 1 }}>
            <Text style={styles.k}>Renk</Text>
            <Text style={styles.vBold}>{payload.colorName}</Text>
            {payload.colorNameSource &&
              payload.colorNameSource !== 'DEFAULT' &&
              payload.colorNameDefault && (
                <Text style={styles.subtleText}>
                  Bizdeki ad: {payload.colorNameDefault}
                </Text>
              )}
          </View>
          {payload.colorNameSource && <SourceBadge source={payload.colorNameSource} />}
        </View>
      )}
      {show('qualityGrade') && (
        <View style={styles.line}>
          <Text style={styles.k}>Kalite</Text>
          <Text style={styles.v}>{payload.qualityGrade}</Text>
        </View>
      )}
      {show('widthCm') && payload.widthCm != null && (
        <View style={styles.line}>
          <Text style={styles.k}>En</Text>
          <Text style={styles.v}>{payload.widthCm} cm</Text>
        </View>
      )}
      {show('lengthMeters') && (
        <View style={styles.line}>
          <Text style={styles.k}>Metraj</Text>
          <Text style={styles.v}>{payload.lengthMeters.toFixed(1)} m</Text>
        </View>
      )}
      {show('weightKg') && payload.weightKg != null && (
        <View style={styles.line}>
          <Text style={styles.k}>Ağırlık</Text>
          <Text style={styles.v}>{payload.weightKg.toFixed(2)} kg</Text>
        </View>
      )}
      {/* Müşteri satırı — customerName null ise BLOK KOMPLE GİZLENİR */}
      {show('customerName') && payload.customerName && (
        <View style={styles.line}>
          <Text style={styles.k}>Müşteri</Text>
          <Text style={styles.v}>{payload.customerName}</Text>
        </View>
      )}
      {show('orderNumber') && payload.orderNumber && (
        <View style={styles.line}>
          <Text style={styles.k}>Sipariş</Text>
          <Text style={styles.v}>{payload.orderNumber}</Text>
        </View>
      )}
      {show('batchNumber') && payload.batchNumber && (
        <View style={styles.line}>
          <Text style={styles.k}>Parti</Text>
          <Text style={styles.v}>{payload.batchNumber}</Text>
        </View>
      )}
    </Surface>
  );
}

function SourceBadge({ source }: { source: NameSource | null }) {
  const info = sourceInfo(source);
  const bg =
    source === 'OVERRIDE' ? '#fef3c7' : source === 'MASTER' ? '#e0f2fe' : '#f1f5f9';
  const fg =
    source === 'OVERRIDE' ? '#92400e' : source === 'MASTER' ? '#0369a1' : '#475569';
  return (
    <TouchableRipple
      borderless
      onPress={() => Toast.show({ type: 'info', text1: info.label })}
      style={[styles.badge, { backgroundColor: bg }]}
    >
      <Text style={[styles.badgeText, { color: fg }]}>{info.short}</Text>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#fff', borderRadius: 16, padding: 18, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontWeight: '700', color: '#0f172a' },
  body: { fontSize: 13, color: '#475569', lineHeight: 18 },
  scrollBody: { paddingBottom: 8 },
  loadingWrap: { paddingVertical: 32, alignItems: 'center', gap: 8 },
  errorText: { fontSize: 13, color: '#dc2626', textAlign: 'center' },
  label: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginTop: 6 },
  input: { backgroundColor: '#fff' },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  preview: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  lineWithBadge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  k: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  v: { fontSize: 14, color: '#0f172a' },
  vBold: { fontSize: 16, color: '#0f172a', fontWeight: '700' },
  vCode: {
    fontSize: 13,
    color: '#0f172a',
    fontFamily: 'monospace',
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  subtleText: { fontSize: 11, color: '#94a3b8', marginTop: 2, fontStyle: 'italic' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
});
