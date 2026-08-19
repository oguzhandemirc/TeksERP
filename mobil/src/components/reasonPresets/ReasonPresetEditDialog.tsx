import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, Button, TextInput, Icon, useTheme } from 'react-native-paper';
import { useMutation } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import AppModal from '../AppModal';
import {
  reasonPresetService,
  KIND_STORES_TEXT,
  type ReasonPreset,
  type ReasonPresetKind,
} from '../../services/reasonPreset.service';
import { useInvalidateReasonPresets, isBuiltinPreset } from '../../hooks/useReasonPresets';

// =============================================================================
// HAZIR SEBEP DÜZENLEME (2026-08-19)
// =============================================================================
// Tek satırlık düzenleyici: ad değiştir · çoğalt · yeni ekle · gizle.
//
// ⚠️ KOD GÖSTERİLİR AMA DÜZENLENMEZ. Rapor kırılımının anahtarı odur; satırlar
// kodu taşıdığı için ADI değiştirmek geçmişi bozmaz — ama kodu değiştirmek altı
// aylık fire kırılımını ikiye bölerdi. Bu yüzden alan yok, sadece bilgi satırı.
//
// ⚠️ METİN SAKLAYAN İKİ LİSTE (elle ekleme / iptal) UYARILIR: orada kayda metnin
// KENDİSİ yazılıyor, dolayısıyla düzenleme yalnız BUNDAN SONRAKİ kayıtları
// etkiler ve raporda eski metin ayrı satır olarak kalır.
//
// ⚠️ SİLME YOK, GİZLEME VAR. Silinen kodun geçmiş kayıtları etiketsiz kalırdı;
// sistem satırı zaten bir sonraki sunucu açılışında geri gelirdi.
// =============================================================================

export type ReasonPresetEditMode = 'edit' | 'duplicate' | 'create';

export default function ReasonPresetEditDialog({
  visible,
  mode,
  kind,
  preset,
  onDismiss,
  onSaved,
}: {
  visible: boolean;
  mode: ReasonPresetEditMode;
  kind: ReasonPresetKind;
  /** `edit` ve `duplicate` modunda zorunlu. */
  preset?: ReasonPreset | null;
  onDismiss: () => void;
  onSaved?: (row: ReasonPreset) => void;
}) {
  const theme = useTheme();
  const invalidate = useInvalidateReasonPresets();
  const storesText = KIND_STORES_TEXT[kind];

  const [label, setLabel] = useState('');
  const [fullText, setFullText] = useState('');

  useEffect(() => {
    if (!visible) return;
    if (mode === 'create') {
      setLabel('');
      setFullText('');
    } else if (preset) {
      setLabel(mode === 'duplicate' ? `${preset.label} (kopya)` : preset.label);
      setFullText(preset.fullText ?? '');
    }
  }, [visible, mode, preset]);

  const save = useMutation({
    mutationFn: async (): Promise<ReasonPreset> => {
      const trimmed = label.trim();
      const text = storesText ? fullText.trim() || trimmed : undefined;
      if (mode === 'edit' && preset) {
        return reasonPresetService.update(preset.id, { label: trimmed, fullText: text ?? null });
      }
      if (mode === 'duplicate' && preset) {
        // Sunucu kopyayı KAYNAĞIN ALTINA koyar ve yeni kod üretir; ardından tam
        // metin ayrıca yazılır (çoğaltma ucu etiketten türetir).
        const row = await reasonPresetService.duplicate(preset.id, trimmed);
        return text && text !== row.fullText
          ? reasonPresetService.update(row.id, { fullText: text })
          : row;
      }
      return reasonPresetService.create({ kind, label: trimmed, fullText: text ?? null });
    },
    onSuccess: (row) => {
      invalidate();
      Toast.show({ type: 'success', text1: mode === 'edit' ? 'Sebep güncellendi' : 'Sebep eklendi' });
      onSaved?.(row);
      onDismiss();
    },
    onError: (err: Error) => {
      Toast.show({ type: 'error', text1: 'Kaydedilemedi', text2: err.message });
    },
  });

  const hide = useMutation({
    mutationFn: () => reasonPresetService.update(preset!.id, { isActive: false }),
    onSuccess: () => {
      invalidate();
      Toast.show({
        type: 'success',
        text1: 'Sebep gizlendi',
        text2: 'Listeden düştü — geçmiş kayıtlar etkilenmedi',
      });
      onDismiss();
    },
    onError: (err: Error) => {
      // Sunucu "son aktif satır gizlenemez" diyebilir — mesajı AYNEN göster,
      // operatör neden olmadığını bilmeli.
      Toast.show({ type: 'error', text1: 'Gizlenemedi', text2: err.message });
    },
  });

  const busy = save.isPending || hide.isPending;
  const canSave = label.trim().length >= 2 && !busy;
  const canHide = mode === 'edit' && !!preset && !isBuiltinPreset(preset);

  return (
    <AppModal visible={visible} onDismiss={busy ? () => {} : onDismiss} dismissable={!busy}>
      <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 10, width: 420, maxWidth: '92%' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon
            source={mode === 'edit' ? 'pencil' : mode === 'duplicate' ? 'content-copy' : 'plus-circle-outline'}
            size={20}
            color={theme.colors.primary}
          />
          <Text variant="titleMedium" style={{ fontWeight: '800' }}>
            {mode === 'edit' ? 'Sebebi düzenle' : mode === 'duplicate' ? 'Sebebi çoğalt' : 'Yeni sebep'}
          </Text>
        </View>

        <TextInput
          mode="outlined"
          dense
          autoFocus
          label="Görünen ad"
          value={label}
          onChangeText={setLabel}
          maxLength={120}
          disabled={busy}
          style={{ backgroundColor: '#fff' }}
        />

        {storesText && (
          <>
            <TextInput
              mode="outlined"
              dense
              label="Kayda yazılacak tam metin"
              value={fullText}
              onChangeText={setFullText}
              maxLength={500}
              multiline
              disabled={busy}
              placeholder={label.trim() || 'Boş bırakılırsa görünen ad kullanılır'}
              style={{ backgroundColor: '#fff' }}
            />
            <Text style={{ fontSize: 12, color: '#b45309' }}>
              ⚠️ Bu listede kayda metnin kendisi yazılır. Metni değiştirirsen ESKİ kayıtlar
              eski metinle kalır ve raporda ayrı satır olarak görünür.
            </Text>
          </>
        )}

        {mode !== 'create' && preset && (
          <Text style={{ fontSize: 12, color: '#64748b' }}>
            Kod: <Text style={{ fontWeight: '700' }}>{preset.code}</Text>
            {mode === 'edit' ? ' — değişmez, raporlar bu kodu kullanır.' : ' → kopyaya yeni kod verilir.'}
          </Text>
        )}

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          {canHide && (
            <Button
              mode="outlined"
              icon="eye-off-outline"
              textColor="#b91c1c"
              onPress={() => hide.mutate()}
              disabled={busy}
            >
              Gizle
            </Button>
          )}
          <View style={{ flex: 1 }} />
          <Button mode="outlined" onPress={onDismiss} disabled={busy}>
            Vazgeç
          </Button>
          <Button mode="contained" onPress={() => save.mutate()} disabled={!canSave} loading={save.isPending}>
            Kaydet
          </Button>
        </View>
      </View>
    </AppModal>
  );
}
