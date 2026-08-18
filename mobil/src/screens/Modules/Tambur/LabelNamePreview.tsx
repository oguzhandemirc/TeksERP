// =============================================================================
// ETİKETTE NE YAZACAK — Tambur kesim ekranı, KESMEDEN ÖNCE (2026-08-13)
// =============================================================================
// Saha sorunu: Tambur'da kesim ve etiket baskısı AYNI dokunuşta oluyor, yani
// operatörün "müşteride bu kumaş ne diye geçiyor" sorusunu gördüğü tek an
// baskıdan SONRAYDI. Yanlış ad basılınca da çare yoktu: doğru yer (Tanımlar →
// müşteri alias'ı ya da sipariş satırı) başka birinin ekranı.
//
// Bu bileşen iki şey yapar:
//   ① "Kime?" seçiminin altında BASILACAK adı ve KAYNAĞINI gösterir
//   ② yanlışsa yerinde düzelttirir — ve "kalıcı mı, bu siparişte mi" diye SORAR
//
// ⚠️ ZİNCİR BURADA HESAPLANMAZ. Ad backend'den gelir (`/labels/name-preview`),
// çünkü aynı sıra etiket basımında da koşuyor (sipariş override'ı → müşteri
// alias'ı → bizdeki ad). İstemcide tekrar yazmak, önizlemenin bir ad, kâğıdın
// başka bir ad göstermesiyle biterdi — yani özelliğin tek işi olan güveni yok
// ederdi.
//
// ⚠️ ÜÇÜNCÜ BİR "yalnız bu baskı" SEVİYESİ YOK ve bilinçli: ad yalnız o anki
// metin kutusunda yaşasaydı aynı topun etiketi yeniden basıldığında farklı
// çıkardı (kayıt ↔ kâğıt ayrışması). İki hedef de kalıcı ve denetlenebilir bir
// satıra yazar.
// =============================================================================
import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, TextInput, Button, ActivityIndicator } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import AppModal from '../../../components/AppModal';
import { labelService, type LabelNamePreview as Preview } from '../../../services/label.service';
import { usePermissions } from '../../../hooks/usePermission';
import { shouldShowOriginalName } from './labelNameCompare';

/** Ad kaynağının operatöre görünen karşılığı. */
function sourceLabel(src: Preview['itemNameSource'] | null): string {
  if (src === 'OVERRIDE') return 'siparişe özel';
  if (src === 'MASTER') return 'müşteri adı';
  return 'bizdeki ad';
}

export function LabelNamePreview({
  rollId,
  orderLineId,
  customerId,
}: {
  /** Kesilecek KAYNAK top — çocuk henüz doğmadı, ürün/renk ondan miras alınır. */
  rollId: string | null;
  orderLineId: string | null;
  customerId: string | null;
}) {
  const qc = useQueryClient();
  const { has } = usePermissions();
  // Kalıcı (master alias) yazma yetkisi. Yoksa o seçenek HİÇ çizilmez — gri
  // buton, alınamayacak bir yetkiyi vaat etmektir (proje kuralı).
  const canPermanent = has('customer-alias:write');
  // ⚠️ Sipariş kapsamı da AYNI kuralı izlemeli (2026-08-19'da eklendi): eskiden
  // kart yetkiden bağımsız çiziliyordu → operatör adı yazıp Kaydet'e basıyor ve
  // SEBEPSİZ 403 alıyordu. Ölçüldü: sahadaki Tambur operatöründe `label:edit`
  // yoktu, yani düzeltme akışı hiç çalışmamış.
  const canOrder = has('label:edit');

  const q = useQuery({
    queryKey: ['label', 'name-preview', rollId, orderLineId, customerId],
    queryFn: () =>
      labelService.previewCustomerNames({ rollId: rollId!, orderLineId, customerId }),
    enabled: !!rollId,
    staleTime: 30_000,
  });
  const p = q.data?.data ?? null;

  const [editOpen, setEditOpen] = useState(false);
  const [itemName, setItemName] = useState('');
  const [colorName, setColorName] = useState('');
  // Kapsam SEÇİLMEDEN kaydedilemez: "bu siparişte mi, hep mi" sorusunun cevabını
  // yalnız operatör bilir; ön seçim yanlış tarafa yazma riskidir.
  const [scope, setScope] = useState<'ORDER' | 'PERMANENT' | null>(null);

  useEffect(() => {
    if (!editOpen || !p) return;
    setItemName(p.itemName);
    setColorName(p.colorName ?? '');
    // Tek seçenek varsa onu ön-seç: iki seçenekliyken ön seçim YANLIŞ tarafa
    // yazma riskidir, tek seçenekliyken fazladan dokunuştur.
    const orderOk = Boolean(orderLineId) && canOrder;
    if (orderOk && canPermanent) setScope(null);
    else if (orderOk) setScope('ORDER');
    else if (canPermanent) setScope('PERMANENT');
    else setScope(null);
  }, [editOpen, p, orderLineId, canOrder, canPermanent]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!p) return;
      const nextItem = itemName.trim();
      const nextColor = colorName.trim();
      if (scope === 'ORDER') {
        if (!orderLineId) throw new Error('Sipariş satırı yok');
        await labelService.updateOrderLineCustomerNames(orderLineId, {
          customerItemName: nextItem || null,
          customerColorName: nextColor || null,
        });
      } else {
        if (!p.customerId) throw new Error('Müşteri seçili değil');
        // Kalıcı yazımda BOŞ değer gönderilmez: alias'ı silmek ayrı bir karardır
        // (Tanımlar ekranı) — acil düzeltme akışında kazara silinmemeli.
        if (nextItem) {
          await labelService.setCustomerItemAlias(p.customerId, p.itemId, nextItem);
        }
        if (nextColor && p.colorId) {
          await labelService.setCustomerColorAlias(p.customerId, p.colorId, nextColor);
        }
      }
    },
    onSuccess: () => {
      Toast.show({
        type: 'success',
        text1: scope === 'ORDER' ? 'Bu sipariş için güncellendi' : 'Müşteri adı güncellendi',
      });
      void qc.invalidateQueries({ queryKey: ['label', 'name-preview'] });
      void qc.invalidateQueries({ queryKey: ['label', 'roll'] });
      setEditOpen(false);
    },
    onError: (e: Error) =>
      Toast.show({ type: 'error', text1: 'Güncellenemedi', text2: e.message }),
  });

  if (!rollId || q.isLoading || !p) return null;

  // STOK baskısı (müşteri yok): etikete müşteriye özel hiçbir şey basılmaz →
  // düzeltilecek bir şey de yok. Yalnız bilgi satırı.
  const isStock = !p.customerId;

  // Kural TEK KAYNAKTA (labelNameCompare) — bileşende tekrar yazmak, testin
  // gerçek davranışı değil kopyasını sınaması demekti.
  const showOriginal = shouldShowOriginalName(p);

  return (
    <>
      <TouchableRipple
        onPress={isStock ? undefined : () => setEditOpen(true)}
        disabled={isStock}
        style={s.row}
      >
        <View>
          <Text style={s.title}>
            Etikette: <Text style={s.value}>{p.itemName}</Text>
            {p.colorName ? <Text style={s.value}> · {p.colorName}</Text> : null}
          </Text>
          {/* Referans satırı — "Etikette" ile AYNI biçimde ama soluk. Karşılaştırma
              alt alta yapılır; operatör iki satırı göz gezdirerek eşler.
              "Bizde:" etiketi, müşteri belgelerindeki "(Müşteride: X)"
              konvansiyonunun aynadaki karşılığıdır (tek kelime, tek yön). */}
          {showOriginal ? (
            <Text style={s.orig} numberOfLines={1}>
              Bizde: <Text style={s.origValue}>{p.itemNameDefault}</Text>
              {p.colorNameDefault ? (
                <Text style={s.origValue}> · {p.colorNameDefault}</Text>
              ) : null}
            </Text>
          ) : null}
          <Text style={s.sub}>
            {isStock
              ? 'Stok — müşteriye özel ad basılmaz'
              : `${sourceLabel(p.itemNameSource)} · düzeltmek için dokun`}
          </Text>
        </View>
      </TouchableRipple>

      <AppModal visible={editOpen} onDismiss={() => setEditOpen(false)}>
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>Etiketteki adı düzelt</Text>
          <Text style={s.sheetSub}>
            {p.customerName} · bizdeki ad: {p.itemNameDefault}
            {p.colorNameDefault ? ` · ${p.colorNameDefault}` : ''}
          </Text>

          <Text style={s.fieldLabel}>Müşterideki kumaş adı</Text>
          <TextInput
            mode="outlined"
            dense
            value={itemName}
            onChangeText={setItemName}
            style={s.input}
          />
          {p.colorId ? (
            <>
              <Text style={s.fieldLabel}>Müşterideki renk adı</Text>
              <TextInput
                mode="outlined"
                dense
                value={colorName}
                onChangeText={setColorName}
                style={s.input}
              />
            </>
          ) : null}

          <Text style={s.fieldLabel}>Nereye yazılsın?</Text>
          {orderLineId && canOrder ? (
            <ScopeCard
              active={scope === 'ORDER'}
              onPress={() => setScope('ORDER')}
              // ⚠️ "Sadece bu siparişte" YANILTICIYDI: yazma tek SİPARİŞ KALEMİNE
              // gider. Aynı kumaş siparişte iki kalemde geçiyorsa diğeri eski adla
              // basılmaya devam eder — operatör düzelttiğini sanıyordu.
              title="Sadece bu sipariş kaleminde"
              desc="Bu kalemin tüm toplarında geçerli (eskiler yeniden basılırsa da). Aynı siparişin diğer kalemleri ve müşterinin başka siparişleri etkilenmez."
            />
          ) : null}
          {canPermanent ? (
            <ScopeCard
              active={scope === 'PERMANENT'}
              onPress={() => setScope('PERMANENT')}
              title="Bu müşteride hep"
              desc="Kalıcı: bu müşteride bu kumaş bundan sonra hep böyle basılır."
            />
          ) : null}
          {/* Hiç seçenek çizilmediyse SEBEBİ söylenir — boş bir modal, operatöre
              "bozuk" diye okunur ve destek çağrısı üretir. */}
          {!(orderLineId && canOrder) && !canPermanent ? (
            <Text style={s.warn}>
              {orderLineId
                ? 'Etiketteki adı değiştirme yetkiniz yok — düzeltmeyi büro yapmalı.'
                : 'Bu top bir siparişe bağlı değil ve kalıcı ad değiştirme yetkiniz yok — düzeltmeyi büro yapmalı.'}
            </Text>
          ) : null}
          {/* ⚠️ Sıra uyarısı: sipariş override'ı zincirde alias'ın ÖNÜNDE gelir.
              Bu satır olmadan operatör kalıcıyı düzeltir, etiket değişmez ve
              sebebini hiçbir yerde göremezdi. */}
          {scope === 'PERMANENT' && p.itemNameSource === 'OVERRIDE' ? (
            <Text style={s.warn}>
              Bu siparişte özel bir ad girilmiş — kalıcıyı değiştirmek bu siparişin
              etiketini DEĞİŞTİRMEZ. Bunun için "Sadece bu siparişte"yi seç.
            </Text>
          ) : null}

          <View style={s.actions}>
            <Button mode="outlined" onPress={() => setEditOpen(false)} style={s.btn}>
              Vazgeç
            </Button>
            <Button
              mode="contained"
              disabled={!scope || !itemName.trim() || saveMut.isPending}
              onPress={() => saveMut.mutate()}
              style={s.btn}
            >
              {saveMut.isPending ? <ActivityIndicator size={16} /> : scope ? 'Kaydet' : 'Önce seçim yapın'}
            </Button>
          </View>
        </View>
      </AppModal>
    </>
  );
}

function ScopeCard({
  active,
  onPress,
  title,
  desc,
}: {
  active: boolean;
  onPress: () => void;
  title: string;
  desc: string;
}) {
  return (
    <TouchableRipple onPress={onPress} style={[s.scope, active && s.scopeActive]}>
      <View>
        <Text style={[s.scopeTitle, active && s.scopeTitleActive]}>{title}</Text>
        <Text style={s.scopeDesc}>{desc}</Text>
      </View>
    </TouchableRipple>
  );
}

const s = StyleSheet.create({
  row: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  title: { fontSize: 13, color: '#475569' },
  value: { fontWeight: '800', color: '#0f172a' },
  sub: { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  // Basılan addan BELİRGİN ŞEKİLDE daha sönük (kalın değil, bir punto küçük) —
  // istek buydu: görünsün ama "asıl ad bu" diye okunmasın.
  orig: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  origValue: { color: '#64748b', fontWeight: '600' },

  sheet: { backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 6, width: 460, maxWidth: '96%' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  sheetSub: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#64748b', marginTop: 8 },
  input: { backgroundColor: '#fff' },
  scope: {
    marginTop: 6,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    minHeight: 52,
    justifyContent: 'center',
  },
  scopeActive: { borderWidth: 2, borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  scopeTitle: { fontSize: 14, fontWeight: '800', color: '#334155' },
  scopeTitleActive: { color: '#3730a3' },
  scopeDesc: { fontSize: 12, color: '#64748b', marginTop: 2 },
  warn: { fontSize: 12, color: '#b45309', fontWeight: '600', marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1 },
});
