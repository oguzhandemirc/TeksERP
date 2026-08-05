import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TextInput, Button, TouchableRipple, Switch, Surface, Icon, Divider } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import ScreenChrome from '../../../components/ScreenChrome';
import MultiSelectSheet, { type MultiSelectOption } from '../../../components/MultiSelectSheet';
import { useOnlineStatus } from '../../../hooks/useOnlineStatus';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useTruncationWarning } from '../../../hooks/useTruncationWarning';
import {
  itemService,
  UNIT_FOR_ITEM_TYPE,
  ITEM_TYPE_LABEL,
  type ItemType,
} from '../../../services/item.service';
import { colorService } from '../../../services/color.service';
import { fabricPropertyService } from '../../../services/fabricProperty.service';
import { queryProblem, QUERY_PROBLEM_TEXT } from '../../../utils/queryState';
import { colors, spacing, radius } from '../../../theme';

// =============================================================================
// KUMAŞ EKLE — Electron ürün formunun (`Items/ItemFormDialog`) mobil ikizi.
// Alan kümesi BİREBİR aynı: kod (ops.) · ad · tip · birim (türetilir) · aktif ·
// izinli renkler · izinli özellikler.
//
// İki şey bilinçli olarak Electron'daki gibi:
//   • BİRİM SORULMAZ — tipten türer (FABRIC→MT, YARN→KG, CONSUMABLE→ADET).
//     Kullanıcıya seçtirmek, backend'in zaten zorladığı bir değeri yanlış
//     girebilecekleri bir alan haline getirirdi.
//   • KOD BOŞ BIRAKILABİLİR — backend STK-NNNNNN üretir. `STK-` öneki otomatik
//     sayaca rezerve; elle girilirse backend 400 döner, o yüzden burada da
//     baştan engellenir (hatayı sunucuya gidip dönmeden söyle).
//
// KK1 içindeki "yeni desen" (`mobile:kk1-desen`) ile KARIŞTIRMA: o yalnız ad
// alır ve `pendingReview=true` işaretler (admin sonra tamamlar). Bu ekran tam
// tanım açar ve `pendingReview` göndermez.
//
// Ekran master-data'dır — oturum/yer onayı İSTEMEZ (stationScreens'e girmez).
// =============================================================================

const ITEM_TYPES: ItemType[] = ['FABRIC', 'YARN', 'CONSUMABLE'];

/** Backend `validateCode` + DB VarChar(32) ile hizalı (Electron şemasının aynısı). */
function codeError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null; // boş = otomatik kod, geçerli
  if (v.length > 32) return 'Kod en fazla 32 karakter olabilir';
  if (!/^[A-Za-z0-9_-]+$/.test(v)) return 'Kod sadece harf, rakam, tire (-) ve alt çizgi (_) içerebilir';
  if (/^stk-/i.test(v)) return 'STK- öneki otomatik kodlara ayrılmıştır — boş bırakın, sistem versin';
  return null;
}

export default function KumasScreen() {
  usePortraitLock(useDeviceType() === 'phone');
  const online = useOnlineStatus();
  const qc = useQueryClient();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [itemType, setItemType] = useState<ItemType>('FABRIC');
  const [isActive, setIsActive] = useState(true);
  const [colorIds, setColorIds] = useState<string[]>([]);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [sheet, setSheet] = useState<'color' | 'property' | null>(null);
  const [created, setCreated] = useState<{ code: string; name: string } | null>(null);

  // Electron ile aynı kaynak: TÜM aktif renkler (public scope DEĞİL — izinli
  // renk listesi müşteriye özel renkleri de kapsayabilir).
  const colorsQ = useQuery({
    queryKey: ['colors', 'item-form', 'all-active'],
    queryFn: () =>
      colorService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: 'name',
        sortOrder: 'asc',
        filters: { isActive: 'true' },
      }),
    staleTime: 10 * 60 * 1000,
  });
  useTruncationWarning(colorsQ.data?.pagination, 'Renk');

  const propsQ = useQuery({
    queryKey: ['fabric-properties', 'item-form', 'all-active'],
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: 'name',
        sortOrder: 'asc',
        filters: { isActive: 'true' },
      }),
    staleTime: 10 * 60 * 1000,
  });
  useTruncationWarning(propsQ.data?.pagination, 'Özellik');

  const colorOptions = useMemo<MultiSelectOption[]>(
    () =>
      (colorsQ.data?.data ?? []).map((c) => ({
        id: c.id,
        label: c.name,
        sublabel: c.code,
        swatch: c.hex ?? null,
      })),
    [colorsQ.data],
  );

  const propertyOptions = useMemo<MultiSelectOption[]>(
    () =>
      (propsQ.data?.data ?? []).map((p) => ({ id: p.id, label: p.name, sublabel: p.code })),
    [propsQ.data],
  );

  const codeErr = codeError(code);
  const nameTrimmed = name.trim();
  const nameErr =
    nameTrimmed.length === 0 ? null : nameTrimmed.length > 100 ? 'Ad en fazla 100 karakter olabilir' : null;
  const canSubmit = nameTrimmed.length > 0 && !codeErr && !nameErr;

  const mut = useMutation({
    mutationFn: () =>
      itemService.create({
        name: nameTrimmed,
        itemType,
        // Boş kod payload'a HİÇ konmaz — backend otomatik üretsin.
        ...(code.trim() ? { code: code.trim() } : {}),
        isActive,
        allowedColorIds: colorIds,
        allowedPropertyIds: propertyIds,
      }),
    onSuccess: (res) => {
      const it = res.data;
      setCreated({ code: it?.code ?? '—', name: it?.name ?? nameTrimmed });
      Toast.show({ type: 'success', text1: 'Kumaş eklendi', text2: `${it?.code ?? ''} · ${it?.name ?? ''}` });
      // KK1 ve sipariş formu aynı kataloğu okur — yeni tanım hemen görünsün.
      void qc.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Eklenemedi', text2: e.message }),
  });

  const resetForm = () => {
    setCode('');
    setName('');
    setItemType('FABRIC');
    setIsActive(true);
    setColorIds([]);
    setPropertyIds([]);
    setCreated(null);
  };

  // ── Sonuç ekranı ──────────────────────────────────────────────────────────
  if (created) {
    return (
      <ScreenChrome title="Kumaş Ekle" subtitle="Tanım oluşturuldu">
        <View style={styles.doneWrap}>
          <Surface style={styles.doneCard} elevation={2}>
            <Icon source="check-circle" size={52} color={colors.successDark} />
            <Text style={styles.doneTitle}>Kumaş eklendi</Text>
            <Text style={styles.doneLabel}>KOD</Text>
            <Text style={styles.doneCode}>{created.code}</Text>
            <Text style={styles.doneName}>{created.name}</Text>
            <Button
              mode="contained"
              icon="plus"
              onPress={resetForm}
              style={styles.doneBtn}
              contentStyle={styles.btnInner}
            >
              Yeni Kumaş Ekle
            </Button>
          </Surface>
        </View>
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome title="Kumaş Ekle" subtitle="Yeni ürün tanımı">
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <TextInput
            mode="outlined"
            label="Ad *"
            value={name}
            onChangeText={setName}
            autoCapitalize="characters"
            error={!!nameErr}
            style={styles.input}
          />
          {nameErr ? <Text style={styles.fieldErr}>{nameErr}</Text> : null}
          <Text style={styles.hint}>Ad sistemde BÜYÜK harfe çevrilir (arama/filtre tutarlılığı).</Text>

          <TextInput
            mode="outlined"
            label="Kod (boş bırakılabilir)"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            error={!!codeErr}
            style={styles.input}
          />
          {codeErr ? (
            <Text style={styles.fieldErr}>{codeErr}</Text>
          ) : (
            <Text style={styles.hint}>Boş bırakırsanız sistem otomatik STK- kodu üretir.</Text>
          )}

          <Text style={styles.sectionLabel}>TİP</Text>
          <View style={styles.chipRow}>
            {ITEM_TYPES.map((t) => {
              const active = itemType === t;
              return (
                <TouchableRipple
                  key={t}
                  onPress={() => setItemType(t)}
                  style={[styles.typeChip, active && styles.typeChipOn]}
                  borderless
                >
                  <Text style={[styles.typeText, active && styles.typeTextOn]}>{ITEM_TYPE_LABEL[t]}</Text>
                </TouchableRipple>
              );
            })}
          </View>
          {/* Birim tipten türer — Electron'da da salt-okunur. */}
          <Text style={styles.hint}>Birim: {UNIT_FOR_ITEM_TYPE[itemType]} (tipe göre otomatik)</Text>

          <Divider style={styles.divider} />

          <PickerRow
            label="İZİNLİ RENKLER (opsiyonel)"
            value={
              colorIds.length === 0
                ? 'Tümü serbest'
                : `${colorIds.length} renk seçili`
            }
            onPress={() => setSheet('color')}
          />
          <PickerRow
            label="İZİNLİ ÖZELLİKLER (opsiyonel)"
            value={
              propertyIds.length === 0
                ? 'Tümü serbest'
                : `${propertyIds.length} özellik seçili`
            }
            onPress={() => setSheet('property')}
          />
          <Text style={styles.hint}>
            Boş bırakılırsa kısıt yok — kumaş her renkte/özellikte üretilebilir.
          </Text>

          <Divider style={styles.divider} />

          <View style={styles.switchRow}>
            <View style={styles.switchCol}>
              <Text style={styles.switchLabel}>Aktif</Text>
              <Text style={styles.hint}>Pasif tanım listelerde çıkmaz.</Text>
            </View>
            <Switch value={isActive} onValueChange={setIsActive} />
          </View>

          {!online && (
            <View style={styles.offlineBox}>
              <Icon source="wifi-off" size={18} color={colors.dangerText} />
              <Text style={styles.offlineText}>
                Çevrimdışısınız. Kodu sunucu ürettiği için bu ekran çevrimdışı kaydedemez.
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Button
            mode="contained"
            icon="content-save"
            style={styles.saveBtn}
            contentStyle={styles.btnInner}
            loading={mut.isPending}
            disabled={!canSubmit || mut.isPending || !online}
            onPress={() => mut.mutate()}
          >
            Kumaşı Kaydet
          </Button>
        </View>
      </View>

      <MultiSelectSheet
        visible={sheet === 'color'}
        onDismiss={() => setSheet(null)}
        title="İzinli Renkler"
        options={colorOptions}
        loading={colorsQ.isLoading}
        errorText={queryProblem(colorsQ) ? QUERY_PROBLEM_TEXT[queryProblem(colorsQ)!] : null}
        value={colorIds}
        onChange={setColorIds}
        emptyText="Tanımlı renk yok"
      />
      <MultiSelectSheet
        visible={sheet === 'property'}
        onDismiss={() => setSheet(null)}
        title="İzinli Özellikler"
        options={propertyOptions}
        loading={propsQ.isLoading}
        errorText={queryProblem(propsQ) ? QUERY_PROBLEM_TEXT[queryProblem(propsQ)!] : null}
        value={propertyIds}
        onChange={setPropertyIds}
        emptyText="Tanımlı özellik yok"
      />
    </ScreenChrome>
  );
}

function PickerRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <TouchableRipple onPress={onPress} style={styles.field} borderless>
      <View style={styles.fieldInner}>
        <View style={styles.fieldCol}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Text style={styles.fieldValue} numberOfLines={1}>
            {value}
          </Text>
        </View>
        <Icon source="chevron-right" size={22} color={colors.textMuted} />
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  body: { padding: spacing.md, paddingBottom: spacing.xl },
  input: { backgroundColor: colors.surface, marginTop: spacing.sm },
  fieldErr: { color: colors.dangerText, fontSize: 12, marginTop: 3, marginLeft: 4 },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 3, marginLeft: 4 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  typeChip: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  typeChipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  typeText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  typeTextOn: { color: colors.brand, fontWeight: '800' },
  divider: { marginVertical: spacing.lg },
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  fieldInner: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: spacing.md },
  fieldCol: { flex: 1, minWidth: 0, paddingVertical: spacing.xs },
  fieldLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: colors.textMuted },
  fieldValue: { fontSize: 16, fontWeight: '600', color: colors.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchCol: { flex: 1, minWidth: 0 },
  switchLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  offlineBox: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.dangerContainer,
    marginTop: spacing.lg,
  },
  offlineText: { flex: 1, minWidth: 0, fontSize: 12, color: colors.dangerText, lineHeight: 17 },
  footer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  saveBtn: { borderRadius: radius.md },
  // 56dp dokunma hedefi.
  btnInner: { height: 56 },
  doneWrap: { flex: 1, backgroundColor: colors.appBg, justifyContent: 'center', padding: spacing.lg },
  doneCard: {
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
  },
  doneTitle: { fontSize: 16, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.xs },
  doneLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: colors.textMuted, marginTop: spacing.sm },
  doneCode: { fontSize: 24, fontWeight: '900', color: colors.text },
  doneName: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
  doneBtn: { marginTop: spacing.lg, borderRadius: radius.md, alignSelf: 'stretch' },
});
