import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Keyboard,
  Pressable,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  Surface,
  TouchableRipple,
  Icon,
  ActivityIndicator,
} from 'react-native-paper';
import { useMutation, useQuery, useQueryClient, onlineManager } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import dayjs from 'dayjs';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import ScreenChrome from '../../../components/ScreenChrome';
import SyncStatusChip from '../../../components/SyncStatusChip';
import RefreshButton from '../../../components/RefreshButton';
import AppModal from '../../../components/AppModal';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import { useKartelaMeasurementEnabled } from '../../../hooks/useFeatureFlags';
import { SkeletonList } from '../../../components/motion';
import {
  kartelaService,
  type KartelaOutstandingItem,
  type KartelaReceiveRequest,
  type KartelaReceiveReturn,
} from '../../../services/kartela.service';
import { STATION_MUT } from '../../../offline/mutations';
import { colors, spacing, radius } from '../../../theme';
import type { MainStackParamList } from '../../../navigation/types';
import AsyncStorage from '@react-native-async-storage/async-storage';

// O12 fix: uzun kabul formu (per-top sayım + cm/kg ölçümleri) Android LMK
// kill'inde sıfırlanıyordu — FasonKabul'daki draft deseni (debounce + savedAt
// + 8h TTL + restore guard) buraya da uygulandı.
const DRAFT_KEY = 'kartela_kabul_draft_v1';
const DRAFT_TTL_MS = 8 * 60 * 60 * 1000;

type RollProp = { id: string; name: string; color: string | null };

/** Per-top kabul girişi: bir varsayılan ölçü (hepsi için) + sadece farklı olanlar (istisna). */
interface RollEntry {
  count: string;
  defCm: string;
  defKg: string;
  /** index (0-bazlı) → o kartelanın override'ı; boş alan varsayılana düşer. */
  exceptions: Record<number, { cm?: string; kg?: string }>;
  included: boolean;
}

/** Bir kartela sevki (iş) — outstanding düz listesinden dispatch'e göre gruplanır. */
interface KartelaJob {
  dispatchId: string;
  dispatchNo: string;
  dispatchedAt: string;
  firm: { id: string; name: string };
  rolls: KartelaOutstandingItem[];
  totalDispatchedQty: number;
  itemNames: string[];
  colorNames: string[];
  properties: RollProp[];
}

const parseNum = (s: string): number | null => {
  const n = parseFloat((s ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const hasVal = (s?: string) => !!s && s.trim().length > 0;

/** Dolu (değeri olan) istisna sayısı. */
const exceptionCount = (ex: RollEntry['exceptions']): number =>
  Object.values(ex).filter((x) => x && (hasVal(x.cm) || hasVal(x.kg))).length;

const uniqStr = (arr: (string | null | undefined)[]): string[] =>
  Array.from(new Set(arr.filter((s): s is string => !!s)));

/** Kumaş·renk özeti: ilk kumaş · ilk renk (+N kumaş). */
const fabricSummary = (j: KartelaJob): string => {
  const item = j.itemNames[0] ?? '';
  const color = j.colorNames[0] ?? '';
  const extra = j.itemNames.length - 1;
  let s = item;
  if (color) s += ` · ${color}`;
  if (extra > 0) s += ` (+${extra} kumaş)`;
  return s || '—';
};

const isHex6 = (c: string | null): c is string => !!c && /^#[0-9a-fA-F]{6}$/.test(c);

/** Tek özellik rozeti — property.color varsa tonlu, yoksa nötr. */
function Chip({ p }: { p: RollProp }) {
  const tint = isHex6(p.color) ? p.color : null;
  return (
    <View style={[styles.chip, tint ? { backgroundColor: `${tint}22`, borderColor: `${tint}55` } : null]}>
      <Text style={[styles.chipText, tint ? { color: tint } : null]} numberOfLines={1}>
        {p.name}
      </Text>
    </View>
  );
}

/** Özellik rozetleri — sarmalı (wrap) veya tek satır. limit aşılırsa "+N". */
function PropChips({
  items,
  limit,
  nowrap,
  style,
}: {
  items: RollProp[];
  limit?: number;
  nowrap?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (items.length === 0) return null;
  const shown = limit ? items.slice(0, limit) : items;
  const extra = items.length - shown.length;
  return (
    <View style={[nowrap ? styles.chipRowNowrap : styles.chipRow, style]}>
      {shown.map((p) => (
        <Chip key={p.id} p={p} />
      ))}
      {extra > 0 && (
        <View style={styles.chip}>
          <Text style={styles.chipText}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Tek satır özellik rozetleri; içerik kaba sığmıyorsa OTOMATİK yatay kayar (ping-pong,
 * uçlarda bekleyerek) → "+N" ile gizlemeden hepsi okunur, yeni satır eklenmez.
 * Sığıyorsa hareket etmez. Liste kartı için (bounded küçük liste → perf sorunsuz).
 */
function ChipMarquee({ items, style }: { items: RollProp[]; style?: StyleProp<ViewStyle> }) {
  const [cw, setCw] = useState(0); // kap genişliği
  const [content, setContent] = useState(0); // içerik (rozetler) genişliği
  const tx = useSharedValue(0);
  const overflow = Math.max(0, content - cw);

  useEffect(() => {
    tx.value = 0;
    if (overflow > 4) {
      const dur = Math.round(overflow * 28) + 500;
      tx.value = withDelay(
        900,
        withRepeat(
          withSequence(
            withTiming(-overflow, { duration: dur, easing: Easing.inOut(Easing.quad) }),
            withDelay(1200, withTiming(-overflow, { duration: 0 })), // sonda bekle
            withTiming(0, { duration: dur, easing: Easing.inOut(Easing.quad) }),
            withDelay(1200, withTiming(0, { duration: 0 })), // başta bekle
          ),
          -1,
          false,
        ),
      );
    }
    return () => {
      tx.value = 0;
    };
  }, [overflow, tx]);

  const aStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  if (items.length === 0) return null;
  return (
    <View style={[styles.marqueeClip, style]} onLayout={(e) => setCw(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.marqueeRow, aStyle]} onLayout={(e) => setContent(e.nativeEvent.layout.width)}>
        {items.map((p) => (
          <Chip key={p.id} p={p} />
        ))}
      </Animated.View>
    </View>
  );
}

/** Top kutucuğu durum özeti. */
function entrySummary(e: RollEntry | undefined): { included: boolean; text: string } {
  if (!e?.included) return { included: false, text: 'Ölçü gir' };
  const count = parseInt(e.count, 10) || 0;
  const defLen = parseNum(e.defCm);
  const ex = exceptionCount(e.exceptions);
  let t = `${count} kartela`;
  if (defLen != null) t += ` · ${defLen} cm`;
  if (ex > 0) t += ` (${ex} farklı)`;
  return { included: true, text: t };
}

export default function KartelaKabulScreen() {
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const insets = useSafeAreaInsets();
  const measureEnabled = useKartelaMeasurementEnabled();
  const [selectedDispatchId, setSelectedDispatchId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Record<string, RollEntry>>({});
  const [sheetRollId, setSheetRollId] = useState<string | null>(null);
  const [manifestNo, setManifestNo] = useState('');
  const [notes, setNotes] = useState('');
  const [extrasOpen, setExtrasOpen] = useState(false);

  // O12: draft restore (mount'ta bir kez) + debounced save. savedAt guard'ı
  // eski taslağın (önceki vardiya) üzerine yazmayı engeller.
  const draftRestoredRef = useRef(false);
  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY).then((raw) => {
      if (raw) {
        try {
          const d = JSON.parse(raw) as Record<string, unknown>;
          const age = typeof d.savedAt === 'number' ? Date.now() - d.savedAt : Infinity;
          if (age < DRAFT_TTL_MS) {
            if (typeof d.selectedDispatchId === 'string') setSelectedDispatchId(d.selectedDispatchId);
            if (d.rows && typeof d.rows === 'object') setRows(d.rows as Record<string, RollEntry>);
            if (typeof d.manifestNo === 'string' && d.manifestNo) setManifestNo(d.manifestNo);
            if (typeof d.notes === 'string' && d.notes) setNotes(d.notes);
          } else {
            AsyncStorage.removeItem(DRAFT_KEY);
          }
        } catch {
          AsyncStorage.removeItem(DRAFT_KEY);
        }
      }
      draftRestoredRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftRestoredRef.current) return;
    const t = setTimeout(() => {
      if (!selectedDispatchId) {
        AsyncStorage.removeItem(DRAFT_KEY);
        return;
      }
      AsyncStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ savedAt: Date.now(), selectedDispatchId, rows, manifestNo, notes }),
      );
    }, 600);
    return () => clearTimeout(t);
  }, [selectedDispatchId, rows, manifestNo, notes]);

  // Firmasız: kartela fasonundaki TÜM açık işleri (AT_KARTELA toplar) getirir.
  const outstandingQuery = useQuery({
    queryKey: ['kartela', 'outstanding'],
    queryFn: () => kartelaService.outstanding(),
  });
  const outstanding: KartelaOutstandingItem[] = outstandingQuery.data?.data ?? [];

  const refresh = useManualRefresh(() => outstandingQuery.refetch(), 'Bekleyen işler güncellendi');

  // Düz outstanding listesini sevke (iş) göre grupla.
  const jobs = useMemo<KartelaJob[]>(() => {
    const map = new Map<string, KartelaJob>();
    for (const o of outstanding) {
      let j = map.get(o.dispatch.id);
      if (!j) {
        j = {
          dispatchId: o.dispatch.id,
          dispatchNo: o.dispatch.dispatchNo,
          dispatchedAt: o.dispatch.dispatchedAt,
          firm: o.dispatch.subcontractor,
          rolls: [],
          totalDispatchedQty: 0,
          itemNames: [],
          colorNames: [],
          properties: [],
        };
        map.set(o.dispatch.id, j);
      }
      j.rolls.push(o);
      j.totalDispatchedQty += Number(o.dispatchedQty) || 0;
    }
    const list = Array.from(map.values());
    for (const j of list) {
      j.itemNames = uniqStr(j.rolls.map((r) => r.roll.item.name));
      j.colorNames = uniqStr(j.rolls.map((r) => r.roll.color?.name));
      const pmap = new Map<string, RollProp>();
      for (const r of j.rolls) for (const rp of r.roll.properties) if (!pmap.has(rp.property.id)) pmap.set(rp.property.id, rp.property);
      j.properties = Array.from(pmap.values());
    }
    // Yeni → eski.
    list.sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt));
    return list;
  }, [outstanding]);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr');
    if (q.length < 2) return jobs;
    const hit = (s?: string | null) => !!s && s.toLocaleLowerCase('tr').includes(q);
    const hitAny = (arr: string[]) => arr.some((s) => hit(s));
    return jobs.filter(
      (j) =>
        hit(j.firm.name) ||
        hit(j.dispatchNo) ||
        hitAny(j.itemNames) ||
        hitAny(j.colorNames) ||
        j.rolls.some((r) => hit(r.roll.barcode)),
    );
  }, [jobs, search]);

  // Seçili iş; kabul sonrası/refetch'te kaybolursa null → listeye düşer.
  const selectedJob = useMemo(
    () => jobs.find((j) => j.dispatchId === selectedDispatchId) ?? null,
    [jobs, selectedDispatchId],
  );

  // Açık sheet'in topu (seçili iş içinde).
  const sheetItem = useMemo(
    () => selectedJob?.rolls.find((o) => o.roll.id === sheetRollId) ?? null,
    [selectedJob, sheetRollId],
  );

  const selectedReturns = useMemo<KartelaReceiveReturn[]>(() => {
    if (!selectedJob) return [];
    const out: KartelaReceiveReturn[] = [];
    for (const o of selectedJob.rolls) {
      const e = rows[o.roll.id];
      if (!e?.included) continue;
      const count = parseInt(e.count, 10);
      if (!Number.isFinite(count) || count <= 0) continue;
      const bulkLengthCm = parseNum(e.defCm);
      const bulkWeightKg = parseNum(e.defKg);
      if (exceptionCount(e.exceptions) === 0) {
        // Hepsi varsayılan → sade bulk.
        out.push({ rollId: o.roll.id, count, bulkLengthCm, bulkWeightKg });
      } else {
        // Varsayılan + istisna: items[i] doluysa override, boşsa backend bulk'a düşer.
        const items = Array.from({ length: count }, (_, i) => {
          const ex = e.exceptions[i];
          return {
            lengthCm: ex ? parseNum(ex.cm ?? '') : null,
            weightKg: ex ? parseNum(ex.kg ?? '') : null,
          };
        });
        out.push({ rollId: o.roll.id, count, bulkLengthCm, bulkWeightKg, items });
      }
    }
    return out;
  }, [selectedJob, rows]);

  const totalKartela = useMemo(() => selectedReturns.reduce((s, r) => s + r.count, 0), [selectedReturns]);

  const openJob = (j: KartelaJob) => {
    setSelectedDispatchId(j.dispatchId);
    setRows({});
    setManifestNo('');
    setNotes('');
    setExtrasOpen(false);
    // Tek-toplu işte doğrudan ölçü sheet'ini aç.
    setSheetRollId(j.rolls.length === 1 ? j.rolls[0].roll.id : null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const backToList = () => {
    setSelectedDispatchId(null);
    setSheetRollId(null);
    setRows({});
  };

  const saveEntry = (rollId: string, e: RollEntry) => {
    setRows((prev) => ({ ...prev, [rollId]: e }));
    setSheetRollId(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const clearEntry = (rollId: string) => {
    setRows((prev) => {
      const next = { ...prev };
      delete next[rollId];
      return next;
    });
    setSheetRollId(null);
  };

  // Y9 fix: KK1/FasonKabul deseniyle hizalandı — mutationFn registry default'undan
  // gelir (offline/mutations.ts), payload VARIABLES olarak geçer. Eski kod closure
  // fn + parametresiz mutate() kullanıyordu: persist yalnız mutationKey+variables
  // sakladığından, offline pause + app restart sonrası replay receive(undefined)
  // ile boş body atıyor ve per-top SAYIM/ÖLÇÜM KAYBOLUYORDU.
  const receiveMutation = useMutation<unknown, Error, KartelaReceiveRequest>({
    mutationKey: STATION_MUT.KARTELA_KABUL_RECEIVE,
    // O11 fix: offline'da kabul sıraya girdi bilgisi (FasonSevk deseni).
    onMutate: () => {
      if (!onlineManager.isOnline()) {
        Toast.show({
          type: 'info',
          text1: 'Çevrimdışı — kabul sıraya alındı',
          text2: 'Bağlantı gelince otomatik gönderilecek',
        });
      }
    },
    onSuccess: (_data, vars) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Kartela kabulü yapıldı',
        text2: `${vars.returns.length} top → ${vars.returns.reduce((s, r) => s + r.count, 0)} kartela`,
      });
      setRows({});
      setManifestNo('');
      setNotes('');
      setSheetRollId(null);
      setSelectedDispatchId(null);
      AsyncStorage.removeItem(DRAFT_KEY); // O12: başarılı kabul → taslak temizle
      qc.invalidateQueries({ queryKey: ['kartela'] });
      outstandingQuery.refetch();
    },
    onError: (err) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Kabul başarısız', text2: err.message });
    },
  });

  const buildReceivePayload = (): KartelaReceiveRequest => ({
    subcontractorId: selectedJob!.firm.id,
    dispatchId: selectedJob!.dispatchId,
    manifestNo: manifestNo.trim() || null,
    notes: notes.trim() || null,
    returns: selectedReturns,
  });

  const canSubmit = !!selectedJob && selectedReturns.length > 0 && !receiveMutation.isPending;

  return (
    <ScreenChrome
      title="Kartela Kabul"
      headerExtras={
        <>
          {/* O11 fix: offline kuyruk göstergesi — diğer istasyon ekranlarıyla aynı. */}
          <SyncStatusChip />
          <RefreshButton
            headerStyle
            label="Yenile"
            onPress={refresh.onRefresh}
            refreshing={refresh.refreshing}
            isError={refresh.isError}
            errorMessage={refresh.errorMessage}
            successMessage={refresh.successMessage}
          />
        </>
      }
    >
      <View style={styles.flex}>
        {selectedJob ? (
          // ── B) Seçili iş: top kutucukları (her birine dokun → ölçü sheet'i) ──
          <KeyboardAwareScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            bottomOffset={16}
          >
            {/* İşi değiştir + iş özeti */}
            <Surface style={styles.card} elevation={1}>
              <TouchableRipple onPress={backToList} borderless style={styles.backRow}>
                <View style={styles.backRowInner}>
                  <Icon source="chevron-left" size={22} color={colors.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium" style={styles.jobNo}>
                      {selectedJob.dispatchNo}
                    </Text>
                    <Text variant="bodySmall" style={styles.rollMeta}>
                      {selectedJob.firm.name} · {dayjs(selectedJob.dispatchedAt).format('DD.MM HH:mm')}
                    </Text>
                  </View>
                  <Text variant="labelMedium" style={styles.backHint}>
                    İşi değiştir
                  </Text>
                </View>
              </TouchableRipple>
            </Surface>

            {/* Tek satır uyarı/yönerge */}
            <View style={styles.hintBanner}>
              <Icon source="gesture-tap" size={15} color="#b45309" />
              <Text style={styles.hintText} numberOfLines={1}>
                {selectedJob.rolls.length} top — her birine dokunup adet ve ölçü girin
              </Text>
            </View>

            {/* Top kutucukları — tıklanabilir kart, içerik tasarruflu */}
            {selectedJob.rolls.map((o) => {
              const e = rows[o.roll.id];
              const sum = entrySummary(e);
              const props = o.roll.properties.map((p) => p.property);
              return (
                <Surface key={o.roll.id} style={styles.tileCard} elevation={1}>
                  <TouchableRipple onPress={() => setSheetRollId(o.roll.id)} style={styles.tileTouch}>
                    <View style={styles.tileRow}>
                      <View style={styles.tileMain}>
                        <Text variant="bodyMedium" style={styles.tileFabric} numberOfLines={1}>
                          {o.roll.item.name}
                          {o.roll.color ? ` · ${o.roll.color.name}` : ''} · {o.dispatchedQty} mt
                        </Text>
                        <View style={styles.tileMetaRow}>
                          {/* Barkod her zaman tam (kısaltma yok); özellikler sığmazsa kayar */}
                          <Text variant="bodySmall" style={styles.tileBarcode}>
                            {o.roll.barcode ?? o.roll.id.slice(0, 8)}
                          </Text>
                          <ChipMarquee items={props} style={styles.tileChips} />
                        </View>
                        <View style={styles.tileStatusRow}>
                          <Icon
                            source={sum.included ? 'check-circle' : 'plus-circle-outline'}
                            size={14}
                            color={sum.included ? '#16a34a' : '#b45309'}
                          />
                          <Text
                            style={[styles.tileStatus, { color: sum.included ? '#16a34a' : '#b45309' }]}
                            numberOfLines={1}
                          >
                            {sum.text}
                          </Text>
                        </View>
                      </View>
                      <Icon source="chevron-right" size={22} color={colors.textMuted} />
                    </View>
                  </TouchableRipple>
                </Surface>
              );
            })}

            {/* Kabul bilgileri — opsiyonel, aç/kapa */}
            <Surface style={styles.card} elevation={1}>
              <TouchableRipple onPress={() => setExtrasOpen((v) => !v)} borderless style={styles.exHeader}>
                <View style={styles.exHeaderInner}>
                  <Icon
                    source={extrasOpen ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.textSecondary}
                  />
                  <Text variant="labelLarge" style={styles.cardTitle}>
                    İrsaliye / Kabul notu (opsiyonel)
                  </Text>
                  {!extrasOpen && (manifestNo.trim() || notes.trim()) ? (
                    <Icon source="circle-medium" size={18} color="#16a34a" />
                  ) : null}
                </View>
              </TouchableRipple>
              {extrasOpen && (
                <>
                  <TextInput mode="outlined" label="İrsaliye No (opsiyonel)" value={manifestNo} onChangeText={setManifestNo} dense />
                  <TextInput mode="outlined" label="Kabul notu (opsiyonel)" value={notes} onChangeText={setNotes} dense multiline />
                </>
              )}
            </Surface>
          </KeyboardAwareScrollView>
        ) : (
          // ── A) İş listesi ───────────────────────────────────────────────
          <View style={styles.flex}>
            <View style={styles.searchRow}>
              <Icon source="magnify" size={18} color={colors.textMuted} />
              <TextInput
                mode="flat"
                placeholder="Firma, sevk no, kumaş ara…"
                value={search}
                onChangeText={setSearch}
                style={styles.searchInput}
                underlineColor="transparent"
                activeUnderlineColor="transparent"
                dense
              />
              {search.length > 0 && (
                <IconButton icon="close-circle" size={16} onPress={() => setSearch('')} />
              )}
            </View>

            {outstandingQuery.isLoading ? (
              <View style={styles.body}>
                <SkeletonList count={4} />
              </View>
            ) : filteredJobs.length === 0 ? (
              <View style={styles.body}>
                <Surface style={styles.card} elevation={1}>
                  <Text variant="bodyMedium" style={styles.empty}>
                    {jobs.length === 0
                      ? 'Kartela fasonunda bekleyen iş yok.'
                      : 'Aramayla eşleşen iş yok.'}
                  </Text>
                </Surface>
              </View>
            ) : (
              <FlashList
                data={filteredJobs}
                keyExtractor={(j) => j.dispatchId}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item: j }) => <KartelaJobCard job={j} onPress={() => openJob(j)} />}
              />
            )}
          </View>
        )}

        {/* Alt bar — FasonKabul deseni (30/40/30): Geçmiş · Kabul Et · Bekleyen */}
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom, marginBottom: -insets.bottom }]}>
          <View style={styles.bottomBarRow}>
            <View style={styles.bottomBarCellSide}>
              <TouchableRipple
                onPress={() => nav.navigate('KartelaKabulGecmisi')}
                style={styles.bottomBarBtn}
                rippleColor="rgba(71, 85, 105, 0.12)"
                accessibilityLabel="Kabul geçmişi"
              >
                <View style={styles.bottomBarBtnInner}>
                  <Icon source="history" size={24} color="#475569" />
                  <Text style={[styles.bottomBarBtnText, { color: '#475569' }]}>Geçmiş</Text>
                </View>
              </TouchableRipple>
            </View>

            <View style={styles.bottomBarCellPrimary}>
              <TouchableRipple
                onPress={() => {
                  if (canSubmit) {
                    receiveMutation.mutate(buildReceivePayload());
                  } else {
                    Toast.show({
                      type: 'info',
                      text1: !selectedJob
                        ? 'Önce kabul edilecek iş seçin'
                        : selectedReturns.length === 0
                          ? 'Bir topa dokunup ölçü girin'
                          : 'Kabul işleniyor…',
                    });
                  }
                }}
                style={[styles.bottomBarBtn, styles.bottomBarBtnPrimaryFill]}
                rippleColor="rgba(255,255,255,0.25)"
                accessibilityLabel="Kabul et"
              >
                <View style={styles.bottomBarBtnInner}>
                  {receiveMutation.isPending ? (
                    <ActivityIndicator size={22} color="#fff" />
                  ) : (
                    <Icon source="package-down" size={28} color="#fff" />
                  )}
                  <Text style={[styles.bottomBarBtnText, { color: '#fff' }]}>
                    {selectedReturns.length > 0
                      ? `Kabul Et (${selectedReturns.length}→${totalKartela})`
                      : 'Kabul Et'}
                  </Text>
                </View>
              </TouchableRipple>
            </View>

            <View style={styles.bottomBarCellSide}>
              <TouchableRipple
                onPress={() => {
                  void outstandingQuery.refetch();
                  Toast.show({
                    type: 'info',
                    text1: selectedJob
                      ? `${selectedJob.rolls.length} bekleyen top`
                      : `${jobs.length} iş · ${outstanding.length} top`,
                  });
                }}
                style={styles.bottomBarBtn}
                rippleColor="rgba(217, 119, 6, 0.12)"
                accessibilityLabel="Bekleyen işler"
              >
                <View style={styles.bottomBarBtnInner}>
                  <Icon source="format-list-bulleted" size={24} color="#d97706" />
                  <Text style={[styles.bottomBarBtnText, { color: '#d97706' }]}>
                    Bekleyen{selectedJob ? ` (${selectedJob.rolls.length})` : ` (${jobs.length})`}
                  </Text>
                </View>
              </TouchableRipple>
            </View>
          </View>
        </View>
      </View>

      {/* Per-top ölçü sheet'i */}
      <KartelaRollSheet
        visible={!!sheetItem}
        item={sheetItem}
        initial={sheetRollId ? rows[sheetRollId] : undefined}
        showMeasure={measureEnabled}
        onSave={(e) => sheetRollId && saveEntry(sheetRollId, e)}
        onClear={() => sheetRollId && clearEntry(sheetRollId)}
        onDismiss={() => setSheetRollId(null)}
      />
    </ScreenChrome>
  );
}

/** İş listesi kartı — kompakt 3 satır: sevkno/tarih · (firma · kumaş · renk) · (top/mt + özellik rozetleri). */
function KartelaJobCard({ job, onPress }: { job: KartelaJob; onPress: () => void }) {
  return (
    <Surface style={styles.jobCard} elevation={1}>
      <TouchableRipple onPress={onPress} borderless style={styles.jobTouch}>
        <View style={{ gap: 3 }}>
          <View style={styles.jobTopRow}>
            <Text variant="bodyMedium" style={styles.jobNo} numberOfLines={1}>
              {job.dispatchNo}
            </Text>
            <Text style={styles.jobDate}>{dayjs(job.dispatchedAt).format('DD.MM HH:mm')}</Text>
          </View>

          {/* Firma · kumaş · renk tek satır */}
          <View style={styles.jobMetaRow}>
            <Icon source="factory" size={13} color={colors.textSecondary} />
            <Text variant="bodySmall" style={styles.jobMeta} numberOfLines={1}>
              {job.firm.name} · {fabricSummary(job)}
            </Text>
          </View>

          {/* top/mt + özellik rozetleri (otomatik kayan tek satır) + chevron */}
          <View style={styles.jobFooter}>
            <Text style={styles.jobQty}>
              {job.rolls.length} top · {job.totalDispatchedQty.toFixed(1)} mt
            </Text>
            <ChipMarquee items={job.properties} style={styles.jobFooterChips} />
            <Icon source="chevron-right" size={20} color={colors.textMuted} />
          </View>
        </View>
      </TouchableRipple>
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Per-top ölçü sheet'i (alttan AppModal): adet + varsayılan ölçü + istisnalar.
// Ölçüler opsiyonel; istisna = sadece farklı olan kartela.
// ---------------------------------------------------------------------------
function KartelaRollSheet({
  visible,
  item,
  initial,
  showMeasure,
  onSave,
  onClear,
  onDismiss,
}: {
  visible: boolean;
  item: KartelaOutstandingItem | null;
  initial: RollEntry | undefined;
  showMeasure: boolean;
  onSave: (e: RollEntry) => void;
  onClear: () => void;
  onDismiss: () => void;
}) {
  const { height } = useWindowDimensions();
  const [count, setCount] = useState('');
  const [defCm, setDefCm] = useState('');
  const [defKg, setDefKg] = useState('');
  const [exceptions, setExceptions] = useState<Record<number, { cm?: string; kg?: string }>>({});
  const [exOpen, setExOpen] = useState(false);

  // Açılışta (top değişince) mevcut girişten tohumla. Yazarken RE-SEED OLMAZ
  // (deps yalnız visible + roll id) → controlled input'un değeri sıfırlanmaz.
  useEffect(() => {
    if (visible && item) {
      setCount(initial?.count ?? '');
      setDefCm(initial?.defCm ?? '');
      setDefKg(initial?.defKg ?? '');
      setExceptions(initial?.exceptions ?? {});
      setExOpen(initial ? exceptionCount(initial.exceptions) > 0 : false);
    }
    // initial'ı kasten dışarıda tuttuk: yalnız açılış/top değişiminde tohumla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, item?.roll.id]);

  const n = parseInt(count, 10);
  const validCount = Number.isFinite(n) && n > 0;

  // Bir satır VARSAYILANDAN FARKLI mı? (override var ve değeri varsayılana eşit değil)
  const differsAt = (idx: number) => {
    const ex = exceptions[idx];
    if (!ex) return false;
    const cmDiff = ex.cm != null && parseNum(ex.cm) !== parseNum(defCm);
    const kgDiff = ex.kg != null && parseNum(ex.kg) !== parseNum(defKg);
    return cmDiff || kgDiff;
  };
  // "Farklı" sayısı = geçerli aralıkta (idx<n) varsayılandan sapan satırlar.
  const exCount = validCount
    ? Array.from({ length: n }, (_, i) => i).filter(differsAt).length
    : 0;

  // count handler TEK setState — yazarken ikinci bir state güncellemesi YOK
  // (taşan istisnalar kayıt anında temizlenir, handleSave).
  const onCountChange = (v: string) => setCount(v.replace(/[^0-9]/g, ''));

  // İstisna satırını güncelle; alanı BOŞALTMAK override'ı kaldırır → satır
  // varsayılan değeri (gerçek metin olarak) göstermeye geri döner.
  const setEx = (i: number, patch: { cm?: string; kg?: string }) =>
    setExceptions((prev) => {
      const cur: { cm?: string; kg?: string } = { ...prev[i] };
      for (const k of Object.keys(patch) as Array<'cm' | 'kg'>) {
        const val = patch[k];
        if (val == null || val.trim() === '') delete cur[k];
        else cur[k] = val;
      }
      const next = { ...prev };
      if (cur.cm == null && cur.kg == null) delete next[i];
      else next[i] = cur;
      return next;
    });

  const handleSave = () => {
    if (!validCount) {
      Toast.show({ type: 'info', text1: 'Kartela adedini girin' });
      return;
    }
    // Yalnız geçerli aralıktaki VARSAYILANDAN FARKLI satırları sakla.
    const cleaned: Record<number, { cm?: string; kg?: string }> = {};
    for (let i = 0; i < n; i++) if (differsAt(i)) cleaned[i] = exceptions[i];
    onSave({ count, defCm, defKg, exceptions: cleaned, included: true });
  };

  const props = item?.roll.properties.map((p) => p.property) ?? [];
  const sameCount = validCount ? Math.max(0, n - exCount) : 0;
  const liveSummary = validCount
    ? `${n} kartela${parseNum(defCm) != null ? ` · ${sameCount}×${parseNum(defCm)}cm` : ''}${
        exCount > 0 ? ` · ${exCount} farklı` : ''
      }`
    : 'Kartela adedini girin';

  return (
    <AppModal visible={visible} onDismiss={onDismiss} position="center" contentStyle={styles.sheet}>
      {item && (
        // Input dışında bir yere dokununca klavye kapanır (TextInput tıklaması
        // çocuk tarafından yutulduğu için bu onPress tetiklenmez).
        <Pressable onPress={Keyboard.dismiss}>
          {/* Başlık: kumaş · renk + barkod/metraj + kapat */}
          <View style={styles.sheetHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text variant="titleMedium" style={styles.sheetTitle} numberOfLines={2}>
                {item.roll.item.name}
                {item.roll.color ? ` · ${item.roll.color.name}` : ''} · {item.dispatchedQty} mt
              </Text>
              <Text variant="bodySmall" style={styles.sheetSub} numberOfLines={1}>
                {item.roll.barcode ?? item.roll.id.slice(0, 8)} · gönderilen metraj
              </Text>
            </View>
            <IconButton icon="close" size={22} onPress={onDismiss} style={styles.sheetClose} />
          </View>
          {props.length > 0 && <PropChips items={props} limit={8} style={{ marginTop: spacing.xs }} />}

          <ScrollView
            style={{ maxHeight: height * 0.42, marginTop: spacing.md }}
            contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.sm }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {/* Adet */}
            <TextInput
              mode="outlined"
              label="Kartela adedi"
              value={count}
              onChangeText={onCountChange}
              keyboardType="number-pad"
              dense
            />

            {/* Varsayılan ölçü (hepsi için) — yalnız ölçüm flag'i açıkken */}
            {showMeasure && (
              <View style={{ gap: spacing.xs }}>
                <Text variant="labelLarge" style={styles.cardTitle}>
                  Ölçü — hepsi için
                </Text>
                <View style={styles.measureRow}>
                  <TextInput
                    mode="outlined"
                    label="Uzunluk (cm)"
                    value={defCm}
                    onChangeText={setDefCm}
                    keyboardType="decimal-pad"
                    dense
                    style={styles.measureInput}
                  />
                  <TextInput
                    mode="outlined"
                    label="Ağırlık (kg)"
                    value={defKg}
                    onChangeText={setDefKg}
                    keyboardType="decimal-pad"
                    dense
                    style={styles.measureInput}
                  />
                </View>
                <Text style={styles.optionalNote}>
                  Ölçüler opsiyoneldir (özellikle ağırlık) — boş bırakılabilir.
                </Text>
              </View>
            )}

            {/* İstisnalar — sadece farklı olan kartelalar (yalnız ölçüm açıkken) */}
            {showMeasure && validCount && (
              <View style={{ gap: spacing.xs }}>
                <TouchableRipple onPress={() => setExOpen((v) => !v)} borderless style={styles.exHeader}>
                  <View style={styles.exHeaderInner}>
                    <Icon source={exOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} />
                    <Text variant="labelLarge" style={styles.cardTitle}>
                      Farklı olanlar{exCount > 0 ? ` (${exCount})` : ''}
                    </Text>
                  </View>
                </TouchableRipple>

                {exOpen && (
                  <View style={{ gap: spacing.xs }}>
                    {Array.from({ length: n }, (_, idx) => {
                      const ex = exceptions[idx] ?? {};
                      const differs = differsAt(idx);
                      return (
                        <View key={idx} style={[styles.exRow, differs && styles.exRowDiff]}>
                          <Text variant="bodySmall" style={[styles.itemIdx, differs && styles.itemIdxDiff]}>
                            #{idx + 1}
                          </Text>
                          <TextInput
                            mode="outlined"
                            label="cm"
                            placeholder={defCm || '—'}
                            value={ex.cm ?? defCm}
                            onChangeText={(v) => setEx(idx, { cm: v })}
                            keyboardType="decimal-pad"
                            dense
                            style={styles.measureInput}
                          />
                          <TextInput
                            mode="outlined"
                            label="kg"
                            placeholder={defKg || '—'}
                            value={ex.kg ?? defKg}
                            onChangeText={(v) => setEx(idx, { kg: v })}
                            keyboardType="decimal-pad"
                            dense
                            style={styles.measureInput}
                          />
                        </View>
                      );
                    })}
                    <Text style={styles.optionalNote}>
                      Satırlar varsayılan ölçüyle dolu — yalnız farklı olanı değiştirin. Alanı silmek varsayılana döndürür.
                    </Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          {/* Canlı özet + aksiyonlar */}
          <Text style={styles.liveSummary}>{liveSummary}</Text>
          <View style={styles.sheetFooter}>
            {initial?.included && (
              <Button mode="outlined" textColor="#dc2626" onPress={onClear} style={{ flex: 1 }}>
                Çıkar
              </Button>
            )}
            <Button
              mode="contained"
              icon="check"
              buttonColor="#059669"
              onPress={handleSave}
              style={{ flex: 2 }}
              contentStyle={{ height: 48 }}
            >
              Kaydet
            </Button>
          </View>
        </Pressable>
      )}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg },
  listContent: { padding: spacing.md, paddingBottom: spacing.lg },
  // Alt bar — FasonKabul deseni (30/40/30, orta dolgulu hero).
  bottomBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: -2 },
    shadowRadius: 6,
  },
  bottomBarRow: { height: 64, flexDirection: 'row', width: '100%', maxWidth: 520, alignSelf: 'center' },
  bottomBarCellSide: { flex: 3 },
  bottomBarCellPrimary: { flex: 4 },
  bottomBarBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  bottomBarBtnPrimaryFill: { backgroundColor: '#059669' },
  bottomBarBtnInner: { alignItems: 'center', gap: 2 },
  bottomBarBtnText: { fontSize: 12, fontWeight: '700', color: colors.text },
  card: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm },
  cardTitle: { color: colors.textSecondary },
  empty: { color: colors.textMuted, fontStyle: 'italic', paddingVertical: spacing.sm },
  measureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  measureInput: { flex: 1, backgroundColor: colors.surface },
  rollMeta: { color: colors.textMuted, marginTop: 2 },
  itemIdx: { width: 28, color: colors.textMuted },
  itemIdxDiff: { color: '#b45309', fontWeight: '700' },
  optionalNote: { color: colors.textMuted, fontSize: 11, fontStyle: 'italic' },
  // İstisna satırı — varsayılandan farklıysa sol şerit + soluk amber zemin
  exRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    paddingLeft: spacing.xs,
    borderRadius: 4,
  },
  exRowDiff: { borderLeftColor: '#f59e0b', backgroundColor: '#fffbeb' },
  // Tek satır uyarı/yönerge banner'ı
  hintBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  hintText: { color: '#b45309', fontSize: 12, fontWeight: '600', flex: 1 },
  // Top kutucuğu — tıklanabilir kart (overflow hidden → ripple kartı doldurur, köşeler temiz)
  tileCard: { borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  tileTouch: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  tileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tileMain: { flex: 1, gap: 2 },
  tileFabric: { fontWeight: '700', color: colors.text },
  tileMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // Barkod tam görünsün: flexShrink 0 → kısalmaz; marquee kalan alanı alır
  tileBarcode: { color: colors.textMuted, flexShrink: 0 },
  tileChips: { flex: 1, marginTop: 0 },
  tileStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  tileStatus: { fontWeight: '700', fontSize: 12.5, flexShrink: 1 },
  // Geri (işi değiştir) satırı
  backRow: { borderRadius: radius.md },
  backRowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  backHint: { color: colors.textMuted },
  jobNo: { fontWeight: '700', color: colors.text, flex: 1 },
  // Arama
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  searchInput: { flex: 1, backgroundColor: 'transparent' },
  // İş kartı (kompakt)
  jobCard: { borderRadius: radius.lg, backgroundColor: colors.surface, marginBottom: spacing.sm },
  jobTouch: { borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  jobTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobDate: { color: colors.textMuted, fontSize: 12, marginLeft: spacing.sm },
  jobMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  jobMeta: { color: colors.textSecondary, flex: 1 },
  jobFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  jobQty: { color: colors.text, fontWeight: '600', fontSize: 13, flexShrink: 0 },
  jobFooterChips: { flex: 1, marginTop: 0 },
  // Özellik rozetleri
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  chipRowNowrap: { flexDirection: 'row', gap: 4, flexShrink: 1, overflow: 'hidden' },
  // Otomatik kayan rozet şeridi
  marqueeClip: { overflow: 'hidden' },
  marqueeRow: { flexDirection: 'row', alignSelf: 'flex-start', gap: 4 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: colors.surface,
  },
  chipText: { fontSize: 11, color: colors.textSecondary },
  // Ölçü modalı (ortada-üstte, sabit — klavyeyle oynamaz). marginBottom merkez
  // hizalamada modalı yukarı kaydırır (~yarısı kadar) → ekranın biraz üstünde durur.
  sheet: {
    maxHeight: '80%',
    marginBottom: 110,
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  sheetHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  sheetClose: { margin: 0, marginTop: -4, marginRight: -8 },
  sheetTitle: { fontWeight: '800', color: colors.text },
  sheetSub: { color: colors.textMuted, marginTop: 2 },
  exHeader: { borderRadius: radius.md },
  exHeaderInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveSummary: { color: colors.textSecondary, fontWeight: '600', marginTop: spacing.sm, textAlign: 'center' },
  sheetFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
});
