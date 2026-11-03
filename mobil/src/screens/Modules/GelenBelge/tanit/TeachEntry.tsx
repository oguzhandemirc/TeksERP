// Belge Tara okuma sonucunda tanıtmaya giriş (S1b): "Bu belgeyi tanıt" / "Şablonu güncelle"; belge tanınmadıysa "Bu belge hangi tip?"
// (listeden seç = o şablonu bu belgeyle güncelle | yeni tip tanıt). `gelen-belge:template` + `gelen-belge:read` izniyle, okunmuş ve
// bu cihazdaki fotoğrafı eşlenen sayfa varsa çizilir. K30-A: telefonda da açılır (rehberli kip dikey yerleşimde çalışır).
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import PickerModal from '../../../../components/PickerModal';
import { usePermissions } from '../../../../hooks/usePermission';
import { inboundDocService, type InboundNoteDetail } from '../../../../services/inboundDoc.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import { isUnrecognized, teachPages } from './teachPages';
import TeachModal from './TeachModal';
import { USER_TEMPLATES_PREFIX } from './useTeachModal';

interface Props {
  detail: InboundNoteDetail | undefined;
  localPages: readonly { sha256: string; uri: string }[];
  /** Hub "Belge tanıt" (K30-A1): okuma bitince tanıtma ekranı kendiliğinden bir kez açılır. */
  autoOpen?: boolean;
}

// Liste anahtarı detay anahtarlarının öneki — kayıt sonrası tek invalidate ikisini tazeler (useTeachModal).
export const USER_TEMPLATES_KEY = USER_TEMPLATES_PREFIX;

export default function TeachEntry({ detail, localPages, autoOpen = false }: Props) {
  const { has } = usePermissions();
  const allowed = has('gelen-belge:template') && has('gelen-belge:read');
  const pages = allowed ? teachPages(detail, localPages) : [];
  const unknown = isUnrecognized(detail, pages);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<{ code: string | null } | null>(null);
  const list = useQuery({ queryKey: USER_TEMPLATES_KEY, queryFn: () => inboundDocService.listUserTemplates(), enabled: pages.length > 0, retry: false });
  // Belgenin okunduğu şablon bir kullanıcı şablonuysa düğme "Şablonu güncelle" olur.
  const own = detail?.templateId ? (list.data ?? []).find((r) => r.id === detail.templateId) : undefined;
  const ready = pages.length > 0 && !list.isLoading;
  const autoDone = useRef(false);
  const ownCode = own?.code ?? null;
  useEffect(() => {
    if (!autoOpen || !ready || autoDone.current) return;
    autoDone.current = true;
    setOpen({ code: ownCode });
  }, [autoOpen, ready, ownCode]);
  if (pages.length === 0) return null;
  const active = (list.data ?? []).filter((r) => r.isActive);
  return (
    <View style={[styles.box, unknown && styles.unknown]} testID="tanit-giris">
      {unknown && (
        <Text style={styles.text} testID="tanit-taninmadi">
          Bu belgenin tipi tanınmadı; alanlar genel sözlükle okundu. Belge tipini tanıtırsanız sonraki belgeler doğru okunur.
        </Text>
      )}
      <View style={styles.actions}>
        {unknown && (
          <Button mode="outlined" icon="format-list-bulleted" onPress={() => setPicking(true)} contentStyle={styles.btn} testID="tanit-listeden">
            Bu belge hangi tip?
          </Button>
        )}
        <Button mode="contained-tonal" icon="creation" onPress={() => setOpen({ code: own?.code ?? null })} contentStyle={styles.btn} testID="tanit-ac">
          {own ? 'Şablonu güncelle' : unknown ? 'Yeni tip tanıt' : 'Bu belgeyi tanıt'}
        </Button>
      </View>
      <PickerModal
        visible={picking}
        title="Bu belge hangi tip?"
        options={active.map((r) => ({ value: r.code, label: r.name, sublabel: `sürüm ${r.version}` }))}
        loading={list.isLoading}
        emptyText="Henüz tanıtılmış belge tipi yok."
        leadingAction={{ label: 'Yeni tip tanıt', sublabel: 'Listede yok — bu belgeyle tanıt', icon: 'creation', onPress: () => { setPicking(false); setOpen({ code: null }); } }}
        onSelect={(code) => { setPicking(false); setOpen({ code }); }}
        onDismiss={() => setPicking(false)}
      />
      <TeachModal visible={open !== null} pages={pages} code={open?.code ?? null} onDismiss={() => setOpen(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  unknown: { backgroundColor: colors.warningContainer },
  text: { fontSize: typography.size.base, color: colors.warningText },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm },
  btn: { minHeight: 56 },
});
