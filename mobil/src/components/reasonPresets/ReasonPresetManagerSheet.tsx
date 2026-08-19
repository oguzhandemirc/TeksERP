import React, { useState } from 'react';
import { View, ScrollView } from 'react-native';
import { Text, Button, IconButton, Icon, Divider } from 'react-native-paper';

import AppModal from '../AppModal';
import ReasonPresetEditDialog, { type ReasonPresetEditMode } from './ReasonPresetEditDialog';
import { useReasonPresets, isBuiltinPreset } from '../../hooks/useReasonPresets';
import {
  KIND_LABELS,
  type ReasonPreset,
  type ReasonPresetKind,
} from '../../services/reasonPreset.service';

// =============================================================================
// HAZIR SEBEP YÖNETİMİ (2026-08-19)
// =============================================================================
// Bir listenin TÜM satırlarını (gizliler dahil) gösterir; her satırda düzenle +
// çoğalt vardır, altta "yeni sebep".
//
// ⚠️ NEDEN AYRI BİR YÜZEY: iptal ekranındaki chip'ler DOKUNUNCA TOPU İPTAL EDER
// (2026-08-06 tek-dokunuş kararı). Oraya satır içi kalem koymak, yıkıcı bir
// aksiyonun 4 mm yanına düzenleme tuşu koymak olurdu — eldivenli parmakla ıskalama
// bedeli "top iptal oldu"dur. Bu yüzden orada TEK bir "Sebepleri düzenle" tuşu var
// ve düzenleme bu ayrı yüzeyde yapılır. Fire ekranında ise seçim yıkıcı değildir
// (karar ayrı bir "Kaydet" ile onaylanır), orada satır içi tuşlar güvenlidir.
// =============================================================================

export default function ReasonPresetManagerSheet({
  visible,
  kind,
  onDismiss,
}: {
  visible: boolean;
  kind: ReasonPresetKind;
  onDismiss: () => void;
}) {
  // Gizlenmiş satırlar da gelir — "neden listede yok" sorusunun cevabı burada.
  const { presets, isFallback } = useReasonPresets(kind, true);
  const [editing, setEditing] = useState<{ mode: ReasonPresetEditMode; preset: ReasonPreset | null } | null>(null);

  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 8, width: 520, maxWidth: '94%', maxHeight: '85%' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon source="format-list-bulleted" size={20} color="#1d4ed8" />
          <Text variant="titleMedium" style={{ fontWeight: '800', flex: 1 }}>
            {KIND_LABELS[kind]}
          </Text>
          <IconButton icon="close" size={20} onPress={onDismiss} style={{ margin: 0 }} />
        </View>

        {isFallback && (
          // Sunucuya ulaşılamıyorsa düzenleme YAPILAMAZ — listeyi düzenlenebilir
          // gibi göstermek, kaydedilmeyen değişiklik vaat etmek olurdu.
          <Text style={{ fontSize: 12, color: '#b45309' }}>
            Sunucuya ulaşılamıyor — bu liste cihazdaki yedekten geliyor, düzenleme kaydedilemez.
          </Text>
        )}

        <ScrollView style={{ maxHeight: 380 }}>
          {presets.map((r) => (
            <View key={r.code}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 4 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: r.isActive ? '#0f172a' : '#94a3b8' }}>
                    {r.label}
                    {!r.isActive ? '  (gizli)' : ''}
                  </Text>
                  {!!r.fullText && r.fullText !== r.label && (
                    <Text style={{ fontSize: 12, color: '#64748b' }} numberOfLines={2}>
                      {r.fullText}
                    </Text>
                  )}
                </View>
                <IconButton
                  icon="pencil-outline"
                  size={20}
                  disabled={isFallback || isBuiltinPreset(r)}
                  onPress={() => setEditing({ mode: 'edit', preset: r })}
                  style={{ margin: 0 }}
                  accessibilityLabel={`${r.label} — düzenle`}
                />
                <IconButton
                  icon="content-copy"
                  size={20}
                  disabled={isFallback || isBuiltinPreset(r)}
                  onPress={() => setEditing({ mode: 'duplicate', preset: r })}
                  style={{ margin: 0 }}
                  accessibilityLabel={`${r.label} — çoğalt`}
                />
              </View>
              <Divider />
            </View>
          ))}
        </ScrollView>

        <Button
          mode="outlined"
          icon="plus"
          disabled={isFallback}
          onPress={() => setEditing({ mode: 'create', preset: null })}
        >
          Yeni sebep ekle
        </Button>

        <ReasonPresetEditDialog
          visible={!!editing}
          mode={editing?.mode ?? 'edit'}
          kind={kind}
          preset={editing?.preset ?? null}
          onDismiss={() => setEditing(null)}
        />
      </View>
    </AppModal>
  );
}
