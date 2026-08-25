import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TextInput, TouchableRipple } from 'react-native-paper';

import { useReasonPresets } from '../../hooks/useReasonPresets';
import type { ReasonPresetKind } from '../../services/reasonPreset.service';
import { colors, spacing, radius } from '../../theme';

/**
 * HAZIR SEBEP SEÇİCİ — serbest metin ÜSTTE, chip'ler altında.
 *
 * Bu düzen bir tercih değil, 2026-08-19 kararının ta kendisi: fire ekranında
 * serbest metin kutusu listenin ÜSTÜNE alındı, çünkü hazır listede karşılığı
 * olmayan bir sebebi yazmak isteyen operatör önce chip'leri tarayıp sonra
 * aşağıda kutu aramak zorunda kalıyordu. Aynı kalıp Tambur fire/düzeltme
 * modallarında ve Fason Kabul "kalan gelmeyecek"te elle üç kez yazılmıştı;
 * burada TEK kaynağa alındı.
 *
 * SÖZLEŞME:
 *   • Yazmaya başlamak `requiresText` taşıyan satırı ("Diğer") KENDİLİĞİNDEN
 *     seçer — operatör iki hamle yapmasın.
 *   • Chip'e dokunmak serbest metni TEMİZLER — iki dil aynı anda okunmaz.
 *   • Seçili chip'e tekrar dokunmak seçimi KALDIRIR (`optional` iken):
 *     yanlışlıkla seçilen sebep için "vazgeç" yolu olmalı.
 *   • `optional` (varsayılan false) → hiç seçim yapılmadan devam edilebilir.
 *
 * ⚠️ Kod UYDURULMAZ: serbest metin yazılıp hiçbir chip seçilmediyse `code`
 * `requiresText` satırının kodudur; o satır katalogda yoksa `null` gider. Sunucu
 * bu kind'ta metinden kod TÜRETMEZ (metin saklamayan kind).
 */
export interface ReasonPresetValue {
  code: string | null;
  text: string;
}

interface Props {
  kind: ReasonPresetKind;
  value: ReasonPresetValue;
  onChange: (v: ReasonPresetValue) => void;
  /** Seçim zorunlu değil (yeniden üretim böyle). */
  optional?: boolean;
  disabled?: boolean;
  /** Serbest metin kutusunun ipucu. */
  placeholder?: string;
  maxLength?: number;
}

export default function ReasonPresetPicker({
  kind,
  value,
  onChange,
  optional = false,
  disabled = false,
  placeholder,
  maxLength = 200,
}: Props) {
  const { presets } = useReasonPresets(kind);
  const freeTextPreset = useMemo(() => presets.find((r) => r.requiresText) ?? null, [presets]);

  const handleText = (t: string): void => {
    // Yazmaya başlamak "Diğer"i seçer; kutuyu boşaltmak seçimi geri alır —
    // ama kullanıcı ARADA bir chip seçtiyse ona dokunulmaz.
    if (t.trim() && freeTextPreset && value.code !== freeTextPreset.code) {
      onChange({ code: freeTextPreset.code, text: t });
      return;
    }
    if (!t.trim() && freeTextPreset && value.code === freeTextPreset.code) {
      onChange({ code: null, text: '' });
      return;
    }
    onChange({ ...value, text: t });
  };

  const handleChip = (code: string): void => {
    if (value.code === code && optional) {
      onChange({ code: null, text: '' });
      return;
    }
    // Chip seçimi serbest metni temizler (chip "Diğer" değilse).
    onChange({ code, text: code === freeTextPreset?.code ? value.text : '' });
  };

  return (
    <View style={styles.wrap}>
      <TextInput
        mode="outlined"
        dense
        disabled={disabled}
        value={value.text}
        onChangeText={handleText}
        maxLength={maxLength}
        placeholder={placeholder ?? 'Kendin yaz — ya da aşağıdan seç'}
        left={<TextInput.Icon icon="pencil-outline" />}
        style={styles.input}
      />
      <View style={styles.chips}>
        {presets
          .filter((p) => !p.requiresText)
          .map((p) => {
            const active = value.code === p.code;
            return (
              <TouchableRipple
                key={p.code}
                onPress={() => handleChip(p.code)}
                disabled={disabled}
                style={[styles.chip, active && styles.chipActive]}
                borderless
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                  {p.label}
                </Text>
              </TouchableRipple>
            );
          })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  input: { backgroundColor: colors.surface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    // Eldivenli parmak: dokunma hedefi 44 px altına inmez.
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandSoft },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: colors.brand, fontWeight: '700' },
});
