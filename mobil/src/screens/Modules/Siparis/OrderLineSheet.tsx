import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Surface, Text, Button, TouchableRipple, IconButton, ActivityIndicator } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';

import AppModal from '../../../components/AppModal';
import NumpadInput from '../../../components/NumpadInput';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { itemService } from '../../../services/item.service';
import { colorService } from '../../../services/color.service';
import { orderService } from '../../../services/order.service';
import { useTruncationWarning } from '../../../hooks/useTruncationWarning';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { emptyOrProblemText } from '../../../utils/queryState';
import { colors, spacing, radius } from '../../../theme';
import type { DraftLine } from './useNewOrder';

// =============================================================================
// Sipariş kalemi düzenleyici (alt sayfa). Kapsam BİLİNÇLİ olarak dar: kumaş ·
// renk · metraj · en. Müşterideki kumaş/renk adı override'ı telefondan
// GİRİLMEZ (2026-08-04 ürün kararı) — boş bırakılınca backend etkin adı
// `CustomerItemAlias`/`CustomerColorAlias` master'ından CANLI çözer; buradan
// yazılan bir değer o bağı KALICI olarak dondururdu. Fiyat/özellik/kesim
// talimatı da yok; gerekirse Electron'dan eklenir.
// =============================================================================

interface Props {
  /** null → kapalı. `line` doluysa düzenleme, `null` ise yeni kalem. */
  target: { line: DraftLine | null } | null;
  customerId: string | null;
  onDismiss: () => void;
  onSave: (line: Omit<DraftLine, 'clientId'>) => void;
  /** Yeni kalem modunda "Kaydet ve Devam" — kaydeder, sheet açık kalır. */
  onSaveAndNext: (line: Omit<DraftLine, 'clientId'>) => void;
}

type OpenPicker = 'item' | 'color' | null;


export default function OrderLineSheet({ target, customerId, onDismiss, onSave, onSaveAndNext }: Props) {
  const open = target !== null;
  const editing = target?.line ?? null;

  const [itemId, setItemId] = useState<string | null>(null);
  const [itemName, setItemName] = useState('');
  const [colorId, setColorId] = useState<string | null>(null);
  const [colorName, setColorName] = useState<string | null>(null);
  const [qtyText, setQtyText] = useState('');
  const [widthText, setWidthText] = useState('');
  const [picker, setPicker] = useState<OpenPicker>(null);

  // Sheet her AÇILIŞTA formu tazeler. Bağımlılık `editing` NESNESİ değil
  // `clientId`'sidir: nesne her render'da yeni kimlik alabilir ve efekt
  // operatör yazarken alanları sıfırlardı. "Kaydet + Yeni" akışında da efekt
  // koşmaz (`open` sabit kalır, `editing` null) — sıfırlamayı orası kendi yapar.
  useEffect(() => {
    if (!open) return;
    setItemId(editing?.itemId ?? null);
    setItemName(editing?.itemName ?? '');
    setColorId(editing?.colorId ?? null);
    setColorName(editing?.colorName ?? null);
    setQtyText(editing ? String(editing.quantity) : '');
    setWidthText(editing?.width != null ? String(editing.width) : '');
    setPicker(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.clientId]);

  // ── Kumaş listesi (KK1 ile aynı desen: tek seferde çek, picker in-memory arar) ──
  const itemsQuery = useQuery({
    queryKey: ['items', 'order-line', 'FABRIC'],
    queryFn: () =>
      itemService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: 'name',
        sortOrder: 'asc',
        filters: { isActive: 'true', itemType: 'FABRIC' },
      }),
    enabled: open,
  });
  useTruncationWarning(itemsQuery.data?.pagination, 'Kumaş');
  useRefetchOnOpen(itemsQuery.refetch, picker === 'item');

  // `?? []` her render'da YENİ dizi üretir → aşağıdaki useMemo'ların bağımlılığı
  // sürekli değişir ve memo hiç tutmaz. Kendi memo'suna alınır.
  const items = useMemo(() => itemsQuery.data?.data ?? [], [itemsQuery.data]);
  const selectedItem = useMemo(() => items.find((i) => i.id === itemId) ?? null, [items, itemId]);

  const itemOptions = useMemo<PickerOption[]>(
    () => items.map((i) => ({ value: i.id, label: i.name, sublabel: i.code })),
    [items],
  );

  // Kumaşın izinli renkleri (dolu = YALNIZ bunlar; boş = sınırsız). Backend zaten
  // reddediyor — listeden hiç çıkarmamak, hatayı üç adım sonra göstermekten iyi.
  const allowedColorIds = useMemo(
    () => new Set((selectedItem?.allowedColors ?? []).map((c) => c.colorId)),
    [selectedItem],
  );

  // Genel katalog: müşteriye ATANMIŞ (exclusive) renkler hariç — başka müşterinin
  // özel rengi bu siparişte çıkmasın.
  const publicColorsQuery = useQuery({
    queryKey: ['colors', 'order-line', 'public'],
    queryFn: () =>
      colorService.listPublicForPicker({ page: 1, pageSize: 300, sortBy: 'name', sortOrder: 'asc' }),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });
  useTruncationWarning(publicColorsQuery.data?.pagination, 'Renk');

  // Bu müşterinin ÖZEL renkleri — picker'ın üstünde çerçeveli blok.
  const customerColorsQuery = useQuery({
    queryKey: ['colors', 'order-line', 'assigned', customerId],
    queryFn: () =>
      colorService.listAssignedToCustomer(customerId!, {
        page: 1,
        pageSize: 100,
        sortBy: 'name',
        sortOrder: 'asc',
      }),
    enabled: open && !!customerId,
    staleTime: 10 * 60 * 1000,
  });

  const toColorOption = (c: { id: string; name: string; code?: string | null; hex?: string | null }): PickerOption => ({
    value: c.id,
    label: c.name,
    sublabel: c.code ?? undefined,
    badge: c.hex ? { text: ' ', color: c.hex } : undefined,
  });

  const publicColorOptions = useMemo<PickerOption[]>(() => {
    const rows = publicColorsQuery.data?.data ?? [];
    const filtered = allowedColorIds.size > 0 ? rows.filter((c) => allowedColorIds.has(c.id)) : rows;
    return filtered.map(toColorOption);
  }, [publicColorsQuery.data, allowedColorIds]);

  const customerColorOptions = useMemo<PickerOption[]>(() => {
    const rows = customerColorsQuery.data?.data ?? [];
    const filtered = allowedColorIds.size > 0 ? rows.filter((c) => allowedColorIds.has(c.id)) : rows;
    return filtered.map(toColorOption);
  }, [customerColorsQuery.data, allowedColorIds]);

  const qty = parseFloat(qtyText);
  const width = widthText.trim() ? parseFloat(widthText) : null;
  const qtyValid = Number.isFinite(qty) && qty > 0;
  const widthValid = width === null || (Number.isFinite(width) && width > 0);
  const valid = !!itemId && qtyValid && widthValid;

  // ── Depo ipucu ── Kumaş seçilir seçilmez sorulur; renk/en yazıldıkça daralır.
  // Metraj yazarken her tuşta istek atmamak için en debounce'lanır. ANLIK
  // FOTOĞRAF, rezervasyon DEĞİL — metin bunu açıkça söyler.
  const debouncedWidth = useDebouncedValue(widthValid ? width : null, 400);
  const availQuery = useQuery({
    queryKey: ['spec-availability', itemId, colorId, debouncedWidth],
    queryFn: () => orderService.getSpecAvailability({ itemId: itemId!, colorId, width: debouncedWidth }),
    enabled: open && !!itemId,
    staleTime: 60 * 1000,
  });
  const avail = availQuery.data?.data ?? null;

  const buildLine = (): Omit<DraftLine, 'clientId'> => ({
    itemId: itemId!,
    itemName,
    colorId,
    colorName,
    quantity: qty,
    width,
  });

  const saveAndNext = () => {
    if (!valid) return;
    onSaveAndNext(buildLine());
    // Kumaş KORUNUR (aynı kumaşın farklı renkleri arka arkaya girilir — sahada
    // en sık kalıp); renk + metraj sıfırlanır. En de korunur: bir siparişin
    // kalemleri genelde aynı ende gelir.
    setColorId(null);
    setColorName(null);
    setQtyText('');
  };

  return (
    <>
      <AppModal
        visible={open}
        onDismiss={onDismiss}
        position="center"
        contentStyle={styles.wrap}
      >
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.title}>
            {editing ? 'Kalemi Düzenle' : 'Yeni Kalem'}
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            {/* Kumaş */}
            <TouchableRipple onPress={() => setPicker('item')} style={styles.field} borderless>
              <View style={styles.fieldInner}>
                <View style={styles.fieldTextCol}>
                  <Text style={styles.fieldLabel}>KUMAŞ</Text>
                  <Text style={itemId ? styles.fieldValue : styles.fieldPlaceholder} numberOfLines={1}>
                    {itemName || 'Kumaş seç…'}
                  </Text>
                </View>
                <IconButton icon="chevron-right" size={22} style={styles.chev} />
              </View>
            </TouchableRipple>

            {/* Renk — opsiyonel (NULL = ham talep) */}
            <TouchableRipple
              onPress={() => (itemId ? setPicker('color') : undefined)}
              disabled={!itemId}
              style={[styles.field, !itemId && styles.fieldDisabled]}
              borderless
            >
              <View style={styles.fieldInner}>
                <View style={styles.fieldTextCol}>
                  <Text style={styles.fieldLabel}>RENK (opsiyonel)</Text>
                  <Text style={colorId ? styles.fieldValue : styles.fieldPlaceholder} numberOfLines={1}>
                    {colorName ?? (itemId ? 'Renk seç… (boş = ham)' : 'Önce kumaş seçin')}
                  </Text>
                </View>
                {colorId ? (
                  <IconButton
                    icon="close"
                    size={20}
                    onPress={() => {
                      setColorId(null);
                      setColorName(null);
                    }}
                  />
                ) : (
                  <IconButton icon="chevron-right" size={22} style={styles.chev} />
                )}
              </View>
            </TouchableRipple>

            {/* Metraj + En */}
            <View style={styles.numRow}>
              <NumpadInput
                mode="outlined"
                label="Metraj (m) *"
                value={qtyText}
                onChangeText={setQtyText}
                allowDecimal
                useNativeKeyboard
                style={styles.numInput}
              />
              <NumpadInput
                mode="outlined"
                label="En (cm)"
                value={widthText}
                onChangeText={setWidthText}
                allowDecimal
                useNativeKeyboard
                style={styles.numInput}
              />
            </View>

            {/* Depo ipucu — REZERVASYON DEĞİL, anlık fotoğraf. */}
            {itemId ? (
              <View style={styles.availBox}>
                {availQuery.isLoading ? (
                  <ActivityIndicator size="small" color={colors.brand} />
                ) : avail ? (
                  <>
                    <Text style={styles.availTitle}>Şu an elde (bilgi — rezerve edilmez)</Text>
                    <View style={styles.availRow}>
                      <AvailCell label="Depo" value={avail.freeWarehouse} tone={colors.successDark} />
                      <AvailCell label="Üretimde" value={avail.inProduction} tone={colors.brand} />
                      <AvailCell label="Ham" value={avail.freeStock} tone={colors.textSecondary} />
                    </View>
                  </>
                ) : (
                  <Text style={styles.availTitle}>Stok bilgisi okunamadı</Text>
                )}
              </View>
            ) : null}
          </ScrollView>

          {/* "Kaydet ve yeni ekle" KENDİ SATIRINDA. Üçü yan yanayken tablette
              (560dp) sığıyor ama telefonda ~123dp/buton kalıyor ve ikonlu
              "Kaydet + Yeni" kırpılıyordu — asıl hedef telefon. */}
          {!editing && (
            <Button
              mode="outlined"
              icon="plus"
              style={styles.secondaryBtn}
              contentStyle={styles.btnInner}
              disabled={!valid}
              onPress={saveAndNext}
            >
              Kaydet ve yeni kalem ekle
            </Button>
          )}
          <View style={styles.actions}>
            <Button onPress={onDismiss} style={styles.actionBtn} contentStyle={styles.btnInner}>
              Vazgeç
            </Button>
            <Button
              mode="contained"
              icon="check"
              style={styles.actionBtn}
              contentStyle={styles.btnInner}
              disabled={!valid}
              onPress={() => {
                if (!valid) return;
                onSave(buildLine());
              }}
            >
              Kaydet
            </Button>
          </View>
        </Surface>
      </AppModal>

      <PickerModal
        visible={picker === 'item'}
        title="Kumaş Seç"
        options={itemOptions}
        selectedValue={itemId}
        loading={itemsQuery.isLoading}
        emptyText={emptyOrProblemText(itemsQuery, 'Kumaş bulunamadı')}
        onRefresh={() => void itemsQuery.refetch()}
        onSelect={(value) => {
          setItemId(value);
          setItemName(itemOptions.find((o) => o.value === value)?.label ?? '');
          // Kumaş DEĞİŞTİYSE renk geçersiz olabilir (izinli renk listesi farklı) —
          // sessizce bırakmak backend 400'üne ("izinli renk listesinde değil")
          // kadar görünmezdi.
          if (value !== itemId) {
            setColorId(null);
            setColorName(null);
          }
          setPicker(null);
        }}
        onDismiss={() => setPicker(null)}
      />

      <PickerModal
        visible={picker === 'color'}
        title="Renk Seç"
        options={publicColorOptions}
        pinnedOptions={customerColorOptions}
        pinnedLabel="Müşteri Renkleri"
        selectedValue={colorId}
        loading={publicColorsQuery.isLoading}
        emptyText={emptyOrProblemText(
          // İki sorgudan HANGİSİ düşerse düşsün liste eksik olur; ikisini tek
          // "sorun" sinyalinde birleştir.
          {
            isError: publicColorsQuery.isError || customerColorsQuery.isError,
            isPaused: publicColorsQuery.isPaused || customerColorsQuery.isPaused,
          },
          allowedColorIds.size > 0 ? 'Bu kumaş için tanımlı renk yok' : 'Renk yok',
        )}
        onRefresh={() => {
          void publicColorsQuery.refetch();
          void customerColorsQuery.refetch();
        }}
        onSelect={(value) => {
          setColorId(value);
          const found =
            customerColorOptions.find((o) => o.value === value) ??
            publicColorOptions.find((o) => o.value === value);
          setColorName(found?.label ?? null);
          setPicker(null);
        }}
        onDismiss={() => setPicker(null)}
      />
    </>
  );
}

function AvailCell({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View style={styles.availCell}>
      <Text style={styles.availLabel}>{label}</Text>
      <Text style={[styles.availValue, { color: tone }]}>
        {Number(value ?? 0).toLocaleString('tr-TR')} m
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // GENİŞLİK VERİLMEZ — bu bilinçli. `position="center"` + contentStyle verilmiş
  // olduğunda AppModal genişliği kendisi yazar: `min(ekran − 32, 560)`. Buraya
  // ikinci bir `width` koymak onu EZER (stil dizisinde contentStyle sonra gelir).
  //
  // ⚠️ Buraya `alignSelf: 'center'` EKLEME (ve `position="bottom"`e dönersen hiç
  // ekleme): bottom sarmalayıcısı `alignItems: 'stretch'` ile kuruludur ve
  // alignSelf onu ezer → kutu otomatik boyuta düşer, içteki `width: '100%'`
  // ebeveynin genişliğini ebeveynin çocuğundan çözmeye çalışır (döngüsel) ve kutu
  // MİN-İÇERİĞE büzülür. Telefonda fark edilmez, 1280dp tablette dar bir şeride
  // dönüşüp tüm etiketleri kırpar ("Kumaş" → "Ku…", butonlar → "· + ✓") — tsc,
  // eslint ve testler bu hatada YEŞİL kalır, yalnız ekranda görülür.
  //
  // maxHeight: klavye açıkken AppModal diyaloğu yarı klavye kadar yukarı taşır
  // ama tavana çarpmasın diye clamp'ler; tavanı burada veriyoruz.
  wrap: { maxHeight: '92%' },
  sheet: {
    width: '100%',
    borderRadius: radius.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
  },
  title: { fontWeight: '700', marginBottom: spacing.sm, color: colors.text },
  // flexShrink: içerik uzayınca kaydırma alanı yer bırakır, aksiyon satırı
  // (Vazgeç/Kaydet) sheet'in dışına taşmaz.
  scroll: { flexShrink: 1 },
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  fieldDisabled: { opacity: 0.5 },
  // 56dp dokunma hedefi (fabrika ortamı kuralı) — paddingVertical + minHeight.
  fieldInner: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingLeft: spacing.md },
  // min-w-0 muadili: uzun kumaş adı chevron'un üstüne binmesin diye daraltılabilir kolon.
  fieldTextCol: { flex: 1, minWidth: 0, paddingVertical: spacing.xs },
  fieldLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: colors.textMuted },
  fieldValue: { fontSize: 16, fontWeight: '600', color: colors.text },
  fieldPlaceholder: { fontSize: 16, color: colors.textMuted },
  chev: { margin: 0 },
  numRow: { flexDirection: 'row', gap: spacing.sm },
  numInput: { flex: 1, minWidth: 0 },
  availBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  availTitle: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginBottom: 4 },
  availRow: { flexDirection: 'row', gap: spacing.sm },
  availCell: { flex: 1, minWidth: 0 },
  availLabel: { fontSize: 11, color: colors.textMuted },
  availValue: { fontSize: 15, fontWeight: '800' },
  secondaryBtn: { marginTop: spacing.md, borderRadius: radius.md },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: { flex: 1, minWidth: 0, borderRadius: radius.md },
  // 56dp dokunma hedefi — eldivenli parmak (fabrika ortamı kuralı).
  btnInner: { height: 56 },
});
