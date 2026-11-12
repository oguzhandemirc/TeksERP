// "Etiket kimin için" seçici (2026-11-10, yalnız emanet top): sahibi (varsayılan, en üstte sabit) · sahibin alıcıları
// (son kullanılan önce) · "Yeni alıcı yaz" → `ensure` (aynı ad iki kez → aynı kayıt). Eski backend (uç yok) → yalnız sahip.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PickerModal from '../../../components/PickerModal';
import ModalTextInput from '../../../components/ModalTextInput';
import { consigneeService, type Consignee } from '../../../services/consignee.service';
import { showScreenError } from '../../../lib/screenToast';
import { colors, spacing } from '../../../theme/tokens';
import { CONSIGNEE_NAME_MAX, consigneeChoiceText, normalizeConsigneeName } from './consignee';
import type { OwnerRef } from './ownerTarget';

const OWNER_VALUE = '__owner__';

export interface TamburConsigneePickerProps {
  visible: boolean;
  owner: OwnerRef;
  selectedId: string | null;
  onSelect: (c: { id: string; name: string } | null) => void;
  onDismiss: () => void;
}

export const consigneesKey = (ownerId: string) => ['consignees', ownerId] as const;

export default function TamburConsigneePicker({ visible, owner, selectedId, onSelect, onDismiss }: TamburConsigneePickerProps) {
  const qc = useQueryClient();
  const [freeOpen, setFreeOpen] = useState(false);
  const [freeText, setFreeText] = useState('');
  const list = useQuery<Consignee[] | null>({
    queryKey: consigneesKey(owner.id),
    queryFn: () => consigneeService.list(owner.id),
    enabled: visible,
    staleTime: 30_000,
    retry: false,
  });
  const ensure = useMutation({
    mutationFn: (name: string) => consigneeService.ensure(owner.id, name),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: consigneesKey(owner.id) });
      setFreeOpen(false);
      setFreeText('');
      onSelect({ id: c.id, name: c.name });
    },
    onError: (e) => showScreenError(e, 'Alıcı eklenemedi'),
  });
  const rows = list.data ?? [];
  const addFree = () => {
    const name = normalizeConsigneeName(freeText);
    if (name) ensure.mutate(name);
  };

  return (
    <PickerModal
      visible={visible}
      title="Etiket kimin için?"
      pinnedLabel="Malın sahibi"
      pinnedOptions={[{ value: OWNER_VALUE, label: consigneeChoiceText(owner.name, null) }]}
      options={rows.map((c) => ({ value: c.id, label: c.name, sublabel: c.labelTemplate ? `Şablon: ${c.labelTemplate.name}` : undefined }))}
      selectedValue={selectedId ?? OWNER_VALUE}
      numColumns={1}
      disableSort
      loading={list.isLoading}
      emptyText={list.data === null ? 'Bu sunucu alıcı listesini desteklemiyor' : 'Bu müşteride kayıtlı alıcı yok — yeni alıcı yaz'}
      leadingAction={
        list.data === null
          ? undefined
          : {
              label: 'Yeni alıcı yaz',
              sublabel: `${owner.name} malının gideceği firma`,
              icon: 'account-plus-outline',
              onPress: () => setFreeOpen(true),
            }
      }
      quickAddSlot={
        freeOpen ? (
          <FreeConsigneeInput value={freeText} onChange={setFreeText} onSubmit={addFree} onCancel={() => setFreeOpen(false)} busy={ensure.isPending} />
        ) : null
      }
      onSelect={(v) => {
        if (v === OWNER_VALUE) onSelect(null);
        else {
          const c = rows.find((r) => r.id === v);
          if (c) onSelect({ id: c.id, name: c.name });
        }
      }}
      onDismiss={() => {
        setFreeOpen(false);
        onDismiss();
      }}
    />
  );
}

/** "Yeni alıcı yaz" kutusu — Ekle `ensure` çağırır (aynı ad → aynı kayıt). */
function FreeConsigneeInput(p: { value: string; onChange: (t: string) => void; onSubmit: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <View style={s.freeBox}>
      <ModalTextInput
        mode="outlined"
        autoFocus
        value={p.value}
        onChangeText={p.onChange}
        maxLength={CONSIGNEE_NAME_MAX}
        autoCapitalize="characters"
        placeholder="Alıcı adı"
        onSubmitEditing={p.onSubmit}
        testID="tambur-alici-yeni-input"
      />
      <View style={s.actions}>
        <Button mode="contained" buttonColor={colors.textSecondary} textColor={colors.textOnDark} onPress={p.onCancel} contentStyle={s.btn}>
          Vazgeç
        </Button>
        <Button mode="contained" onPress={p.onSubmit} loading={p.busy} disabled={p.busy} contentStyle={s.btn} testID="tambur-alici-yeni-ekle">
          Ekle
        </Button>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  freeBox: { gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  btn: { minHeight: 56 },
});
