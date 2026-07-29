import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import {
  Surface,
  Text,
  Button,
  IconButton,
  TouchableRipple,
  ActivityIndicator,
  Divider,
} from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { useQuery } from '@tanstack/react-query';
import AppModal from '../AppModal';
import { labelTemplateService } from '../../services/labelTemplate.service';

// =============================================================================
// Serbest Etiket Bas — topa/kartelaya bağlı OLMAYAN tek başına etiket şablonu
// seçilir, kopya sayısı ayarlanır ve istasyon yazıcısında basılır. Yazıcı device
// bağlamından (x-device-id) backend'de çözülür; burada manuel yazıcı seçimi YOK.
// =============================================================================

const MIN_COPIES = 1;
const MAX_COPIES = 100;

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** Seçim + kopya onaylanınca çağrılır — parent baskı işini (job) kurar. */
  onPrint: (templateId: string, copies: number) => void;
}

export default function StandaloneLabelSheet({ visible, onDismiss, onPrint }: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  // Tablet/yatayda yarı genişlik ama 460px tavanlı, telefon dikeyde %92.
  const sheetWidth = winH > winW ? winW * 0.92 : Math.min(winW * 0.5, 460);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copies, setCopies] = useState(MIN_COPIES);

  const q = useQuery({
    queryKey: ['label-templates', 'standalone'],
    queryFn: () => labelTemplateService.listStandalone(),
    enabled: visible,
    staleTime: 60_000,
  });
  const templates = q.data ?? [];

  const clampCopies = (n: number) => Math.max(MIN_COPIES, Math.min(MAX_COPIES, n));
  const bump = (delta: number) => {
    Haptics.selectionAsync().catch(() => {});
    setCopies((c) => clampCopies(c + delta));
  };

  const reset = () => {
    setSelectedId(null);
    setCopies(MIN_COPIES);
  };
  const cancel = () => {
    reset();
    onDismiss();
  };
  const submit = () => {
    if (!selectedId) {
      Toast.show({ type: 'info', text1: 'Etiket seçin', text2: 'Basılacak bir şablon seçin.' });
      return;
    }
    const id = selectedId;
    const n = clampCopies(copies);
    reset();
    onPrint(id, n);
  };

  return (
    <AppModal visible={visible} onDismiss={cancel}>
      <Surface style={[styles.sheet, { width: sheetWidth }]} elevation={4}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text variant="titleMedium" style={styles.title}>
              Serbest Etiket Bas
            </Text>
            <Text style={styles.subtitle}>Şablon seç, kopya sayısını ayarla ve bas.</Text>
          </View>
          <IconButton
            icon="close"
            size={22}
            onPress={cancel}
            accessibilityLabel="Kapat"
            style={styles.closeBtn}
          />
        </View>
        <Divider style={{ marginVertical: 8 }} />

        {q.isLoading ? (
          <ActivityIndicator style={{ marginVertical: 24 }} />
        ) : q.isError ? (
          <Text style={styles.empty}>Etiketler yüklenemedi. Tekrar deneyin.</Text>
        ) : templates.length === 0 ? (
          <Text style={styles.empty}>Henüz serbest etiket yok</Text>
        ) : (
          <ScrollView style={styles.list}>
            {templates.map((t) => {
              const selected = t.id === selectedId;
              return (
                <TouchableRipple
                  key={t.id}
                  onPress={() => setSelectedId(t.id)}
                  style={[styles.row, selected && styles.rowActive]}
                >
                  <View>
                    <Text style={styles.rowName}>
                      {t.name}
                      {selected ? '  ✓' : ''}
                    </Text>
                    {t.variants.length > 0 ? (
                      <View style={styles.chipRow}>
                        {t.variants.map((v) => (
                          <View
                            key={v.id}
                            style={[styles.chip, v.isPrimary && styles.chipPrimary]}
                          >
                            <Text style={styles.chipText}>
                              {v.widthMm}×{v.heightMm}mm
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </TouchableRipple>
              );
            })}
          </ScrollView>
        )}

        {/* Kopya sayacı — 1..100, varsayılan 1. */}
        <View style={styles.stepperRow}>
          <Text style={styles.stepperLabel}>Kopya</Text>
          <View style={styles.stepper}>
            <IconButton
              icon="minus"
              mode="contained-tonal"
              size={22}
              disabled={copies <= MIN_COPIES}
              onPress={() => bump(-1)}
              accessibilityLabel="Kopya azalt"
            />
            <Text style={styles.copyValue}>{copies}</Text>
            <IconButton
              icon="plus"
              mode="contained-tonal"
              size={22}
              disabled={copies >= MAX_COPIES}
              onPress={() => bump(1)}
              accessibilityLabel="Kopya artır"
            />
          </View>
        </View>

        <Button
          mode="contained"
          icon="printer"
          onPress={submit}
          disabled={!selectedId || templates.length === 0}
          style={styles.printBtn}
        >
          Bas
        </Button>
      </Surface>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: '#fff',
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  headerText: { flex: 1, paddingTop: 8 },
  closeBtn: { margin: 0, marginRight: -8 },
  title: { fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#475569', marginTop: 4 },
  list: { maxHeight: 300 },
  empty: { fontSize: 13, color: '#94a3b8', textAlign: 'center', marginVertical: 24 },
  row: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 },
  rowActive: { backgroundColor: '#eef2ff' },
  rowName: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  chipPrimary: { borderColor: '#4f46e5', backgroundColor: '#f5f3ff' },
  chipText: { fontSize: 11, color: '#475569', fontWeight: '600' },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingHorizontal: 4,
  },
  stepperLabel: { fontSize: 14, fontWeight: '600', color: '#334155' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  copyValue: {
    minWidth: 44,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  printBtn: { marginTop: 14, borderRadius: 10 },
});
