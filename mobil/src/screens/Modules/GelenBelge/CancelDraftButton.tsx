// "Taslağı iptal et": yarım kalan okutma taslağını kaldırır ki aynı kâğıt yeniden okutulabilsin (K27 BLOCK'ta eski taslak
// yeni kaydı tutuyordu). Taslak deftere yazmamıştır → sunucu sert siler; onay kartı satır/parti sayısını önizlemeden okur.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, IconButton, Text } from 'react-native-paper';
import { useMutation, useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import { usePermissions } from '../../../hooks/usePermission';
import { draftCancelService, draftContentsText } from '../../../services/inboundDocDraftCancel';
import { colors, spacing, typography } from '../../../theme';

interface Props {
  note: { id: string; noteNo: string };
  /** İptal sunucuda başarılı → çağıran satırı/kartı kapatır. */
  onCancelled: () => void;
  disabled?: boolean;
  testID?: string;
  /** Tek İE formunun belge satırı: yazısız kırmızı ikon (erişilebilirlik adı aynı). */
  iconOnly?: boolean;
  /** `iconOnly` ikon boyu (vars. 24; tek İE formu üst satırı 28). */
  iconSize?: number;
}

const messageOf = (e: unknown): string =>
  typeof (e as { message?: unknown })?.message === 'string' ? (e as { message: string }).message : 'Taslak iptal edilemedi.';

export default function CancelDraftButton({ note, onCancelled, disabled, testID = 'belge-taslak-iptal', iconOnly = false, iconSize = 24 }: Props) {
  const canWrite = usePermissions().has('gelen-belge:write');
  const [open, setOpen] = useState(false);
  const preview = useQuery({
    queryKey: ['gelen-belge-taslak-iptal-onizleme', note.id],
    queryFn: () => draftCancelService.preview(note.id),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  const cancel = useMutation({
    mutationFn: () => draftCancelService.cancel(note.id),
    onSuccess: () => {
      setOpen(false);
      Toast.show({ type: 'success', text1: `${note.noteNo} taslağı iptal edildi`, text2: 'Aynı belgeyi yeniden okutabilirsiniz.' });
      onCancelled();
    },
    // 409 (bu arada onaylandı) / 404 (başka cihaz iptal etti): kart açık kalır, neden yazılır.
    onError: (e) => Toast.show({ type: 'error', text1: 'Taslak iptal edilemedi', text2: messageOf(e) }),
  });
  if (!canWrite) return null;

  const p = preview.data;
  const blocked = p ? !p.deletable : false;
  return (
    <>
      {iconOnly ? (
        <IconButton
          icon="file-cancel-outline"
          iconColor={colors.dangerDark}
          size={iconSize}
          style={styles.icon}
          onPress={() => setOpen(true)}
          disabled={disabled}
          accessibilityLabel="Taslağı iptal et"
          testID={testID}
        />
      ) : (
      <Button
        mode="outlined"
        icon="file-cancel-outline"
        textColor={colors.dangerDark}
        style={styles.outline}
        contentStyle={styles.btn}
        onPress={() => setOpen(true)}
        disabled={disabled}
        testID={testID}
      >
        Taslağı iptal et
      </Button>
      )}
      <ModuleSheet
        visible={open}
        onDismiss={() => !cancel.isPending && setOpen(false)}
        size="sm"
        title={`${note.noteNo} taslağı iptal edilsin mi?`}
        footer={
          <>
            <Button onPress={() => setOpen(false)} disabled={cancel.isPending} contentStyle={styles.btn}>Vazgeç</Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              onPress={() => cancel.mutate()}
              loading={cancel.isPending}
              disabled={cancel.isPending || !p || blocked}
              contentStyle={styles.btn}
              testID={`${testID}-onay`}
            >
              Taslağı iptal et
            </Button>
          </>
        }
      >
        <View style={styles.body}>
          {preview.isLoading ? <ActivityIndicator testID={`${testID}-yukleniyor`} /> : null}
          {preview.isError ? <Text style={styles.warn}>Taslağın içeriği okunamadı: {messageOf(preview.error)}</Text> : null}
          {p ? (
            <>
              <Text style={styles.count} testID={`${testID}-icerik`}>{draftContentsText(p)}</Text>
              {blocked ? (
                <Text style={styles.warn} testID={`${testID}-engel`}>{p.reason ?? 'Bu belge artık taslak değil; iptal edilemez.'}</Text>
              ) : (
                <>
                  <Text style={sheet.hint}>Taslak ve satırları kalıcı olarak kaldırılır; geri alınamaz. Hiç top doğmadığı için stok etkilenmez.</Text>
                  <Text style={sheet.hint}>Sayfa fotoğrafları silinmez; aynı belge yeniden okutulunca yeni kayda bağlanır.</Text>
                </>
              )}
            </>
          ) : null}
        </View>
      </ModuleSheet>
    </>
  );
}

const styles = StyleSheet.create({
  btn: { minHeight: 56 },
  icon: { width: 56, height: 56, margin: 0 },
  outline: { borderColor: colors.danger },
  body: { gap: spacing.sm },
  count: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  warn: { fontSize: typography.size.base, color: colors.dangerText },
});
