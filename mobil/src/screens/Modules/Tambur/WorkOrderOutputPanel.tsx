// =============================================================================
// BU İŞ EMRİNDEN ÇIKAN TOPLAR — Tambur sağ sütun paneli (2026-08-09)
// =============================================================================
// Saha isteği birebir: *"iş emri içindeki topların göründüğü bölümün birkaç
// satır altına bu iş emrinde son çıkan topları gösterdiğimiz bir alan yapalım.
// Orada KALAN değil BASTIĞIM toplam metraj, top sayısı, topların barkodu,
// saat:dk'sını göreyim, yazdırabileyim, geri alabileyim."*
//
// Kapsam kararı: **aktif iş emrinin TÜM çıkan topları** (vardiya/oturum fark
// etmez). "Ben ne yaptım" değil "bu iş ne çıkardı" sorusuna bakar — gece
// vardiyasının çıkardığı toplar da görünür.
//
// ⚠️ BACKEND ZATEN HAZIRDI: `GET /tambur/recent-output-rolls?workOrderId=`
// süzgeci vardı ama hiçbir istemci kullanmıyordu. Yeni uç YAZILMADI.
//
// ⚠️ ÜST SAYAÇ "BASILAN" METRAJDIR, kalan değil: `initialQty` toplanır,
// `currentQty` DEĞİL. Çıkan bir top sonradan kesilirse `currentQty` düşer ve
// "bu işten ne çıktı" sorusunun cevabı geriye dönük küçülürdü.
//
// ⚠️ GERİ ALMA ANA EKRANI DA DEĞİŞTİRİR (kalan metraj artar, kapanmış iş emri
// dirilebilir) → `onUndone` ile parent tazelenir. Tazelenmezse operatör elle
// "yenile"ye basmak zorunda kalır (2026-08-04'te `RecentOutputModal`'da
// birebir bu yaşandı).
// =============================================================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { Text, Icon, IconButton, TouchableRipple, ActivityIndicator, Button, Menu } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Toast from 'react-native-toast-message';

import { tamburService } from '../../../services/tambur.service';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import type { Roll } from '../../../types/models';
import { formatFactory } from '../../../lib/factory-time';
import { unprintedRolls } from './finalLabel';
import { labelTextFixLockReason } from './labelTextFix';
import { colors, palette } from '../../../theme/tokens';
import { MEASURE_LABEL, measureToneOf } from './measureSource';
import { kgCellText, outputSummaryText, outputTotals } from './outputSummary';
import type { LastTamburMeasure } from './TamburMeasureStrip';
import { isLicenseNotified } from '../../../lib/license';
import { REFRESH_MIN_SPIN_MS, manualRefreshToast, remainingSpinMs } from './outputRefresh';
import { s } from './WorkOrderOutputPanel.styles';

const LAST_TONE = { GREEN: colors.successText, AMBER: colors.warningText, RED: colors.dangerText, NONE: colors.textSecondary } as const;

/** "SS:dd" — panelde tarih GEREKMEZ: kapsam zaten tek iş emri. */
function hhmm(v: string | Date | null | undefined): string {
  return formatFactory(v, 'HH:mm');
}

/** Arka plan yoklaması (başka tablet/vardiya kesimleri). Bu tabletin kesim/geri al/basımı ayrıca invalidate eder. */
export const WO_OUTPUT_POLL_MS = 15_000;

/** ↻ elle basılınca döner (en az bir tur, yenileme sürdükçe); 15 sn'lik sessiz yoklamada ikon kıpırdamaz. */
function RefreshButton({ spinning, onPress }: { spinning: boolean; onPress: () => void }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    if (spinning) {
      rot.value = 0;
      rot.value = withRepeat(withTiming(360, { duration: REFRESH_MIN_SPIN_MS, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(rot);
      rot.value = 0;
    }
  }, [spinning, rot]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <IconButton
        icon="refresh"
        size={26}
        iconColor={palette.blue[800]}
        onPress={spinning ? undefined : onPress}
        style={s.headerBtn}
        accessibilityLabel={spinning ? 'Yenileniyor' : 'Yenile'}
        testID="wo-output-yenile"
      />
    </Animated.View>
  );
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

/** Tek satır: saat · barkod · metre · kg · [bas] [geri al]. Etiket düzeltme satır menüsünde (dokun / uzun bas). */
function OutputRow({ r, menuOpen, onMenu, onPrint, onUndo, onFixLabel }: {
  r: Roll;
  menuOpen: boolean;
  onMenu?: (open: boolean) => void;
  onPrint: (roll: Roll) => void;
  onUndo: (roll: Roll) => void;
  onFixLabel?: (roll: Roll) => void;
}) {
  const lock = labelTextFixLockReason(r.status);
  const row = (
    <TouchableRipple
      onPress={onMenu ? () => onMenu(true) : undefined}
      onLongPress={onMenu ? () => onMenu(true) : undefined}
      disabled={!onMenu}
      style={s.row}
      accessibilityHint={onMenu ? 'Etiket bilgisini düzeltmek için dokunun' : undefined}
      testID={`wo-output-satir-${r.id}`}
    >
      <View style={s.rowInner}>
        <Text style={s.rowTime}>{hhmm(r.createdAt)}</Text>
        <Text style={s.rowBarcode} numberOfLines={1}>
          {r.barcode ?? '—'}
        </Text>
        {onFixLabel && lock ? (
          <View accessibilityLabel={lock} testID={`wo-output-etiket-kilit-${r.id}`}>
            <Icon source="lock-outline" size={16} color={colors.textMuted} />
          </View>
        ) : null}
        <Text style={[s.rowQty, s.rowM]} numberOfLines={1}>{Number(r.initialQty ?? 0).toFixed(1)} m</Text>
        <Text style={[s.rowQty, s.rowKg]} numberOfLines={1} testID={`wo-output-kg-${r.id}`}>{kgCellText(r.weightKg)}</Text>
        <IconButton icon="printer" size={26} iconColor="#1e40af" containerColor="#eef2ff" mode="contained-tonal" onPress={() => onPrint(r)} style={s.rowBtn} accessibilityLabel="Etiketi bas" />
        <IconButton icon="undo-variant" size={26} iconColor="#b45309" containerColor="#fef3c7" mode="contained-tonal" onPress={() => onUndo(r)} style={s.rowBtn} accessibilityLabel="Geri al" />
      </View>
    </TouchableRipple>
  );
  if (!onMenu || !onFixLabel) return row;
  return (
    <Menu visible={menuOpen} onDismiss={() => onMenu(false)} anchor={row} anchorPosition="bottom">
      <Menu.Item
        leadingIcon={lock ? 'lock-outline' : 'tag-edit-outline'}
        title={lock ? `Etiket düzeltilemez — ${lock}` : 'Etiket bilgisini düzelt'}
        disabled={!!lock}
        onPress={() => {
          onMenu(false);
          onFixLabel(r);
        }}
        testID={`wo-output-etiket-duzelt-${r.id}`}
      />
    </Menu>
  );
}

export default function WorkOrderOutputPanel({
  workOrderId,
  onPrint,
  onUndo,
  onPrintUnprinted,
  onFixLabel,
  lastMeasure = null,
  title = 'Bu işten çıkanlar',
  fill = false,
}: {
  workOrderId: string | null;
  /** Etiketi yeniden bas — parent'ın yazıcı akışına verir. */
  onPrint: (roll: Roll) => void;
  /** Geri alma önizlemesini aç (yıkıcı-işlem kuralı: onaysız iptal yok). */
  onUndo: (roll: Roll) => void;
  /** S5 basım zamanı "iş bitince": verilirse etiketi basılmamış topları toplu basar. */
  onPrintUnprinted?: (rolls: Roll[]) => void;
  /** Etiket ad/renk/parti düzeltmesi (sevk edilene kadar); verilmezse düğme çizilmez. */
  onFixLabel?: (roll: Roll) => void;
  /** Geniş tablette son kesim (metre + kaynak) başlıkta; ayrı ölçüm şeridi çizilmez (K5). */
  lastMeasure?: LastTamburMeasure | null;
  /** Başlık metni (geniş tablet hedef görselinde "Çıkan etiketler"). */
  title?: string;
  /** Geniş tablet sağ sütun: kalan yüksekliği doldurur (260 tavanı yok). */
  fill?: boolean;
}) {
  const q = useQuery({
    queryKey: ['tambur', 'wo-output', workOrderId],
    queryFn: () =>
      tamburService.recentOutputRolls({ workOrderId: workOrderId!, limit: 100, withTotal: true }),
    enabled: !!workOrderId,
    staleTime: 10_000,
    // KENDİLİĞİNDEN TAZELENİR (2026-08-12 saha şikâyeti: "sürekli refresh'e
    // basmam gerekiyor"). İki katman: bu tabletin kesimleri mutation başarısında
    // invalidate edilir (ANINDA görünür, TamburScreen), başka tablet/vardiya
    // kesimleri bu yoklamayla en geç 15 sn'de düşer. Kart kapalıyken
    // (enabled=false) yoklama hiç koşmaz. SESSİZ (2026-11-11): arka plan yoklaması
    // spinner göstermez; liste yapısal paylaşımla yalnız veri değişince yeniden çizilir.
    refetchInterval: WO_OUTPUT_POLL_MS,
  });
  const [manualRefresh, setManualRefresh] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  // Yalnız elle basış: dönüş en az bir tur, bitince sonuç tostu. Yoklama bu yoldan geçmez (sessiz).
  const runManualRefresh = async () => {
    setManualRefresh(true);
    const started = Date.now();
    const res = await q.refetch();
    await sleep(remainingSpinMs(started, Date.now()));
    if (!mountedRef.current) return;
    setManualRefresh(false);
    const err = res.status === 'error' ? res.error : null;
    // Lisans kapısı reddini interceptor zaten söyledi (showScreenError emsali).
    if (err && isLicenseNotified(err)) return;
    Toast.show(manualRefreshToast(err));
  };

  const rolls: Roll[] = useMemo(() => q.data?.data ?? [], [q.data]);

  // YENİ ÇIKAN GÖRÜNÜR OLSUN (2026-08-12 saha: "son çıkanı görmek için
  // kaydırmam gerekiyor bazen"). Liste yeni-en-üstte sıralı ama ScrollView
  // piksel ofsetini KORUR: operatör daha önce aşağı kaydırdıysa yeni kesilen
  // top listenin görünmeyen tepesine eklenir ve panel "güncellenmemiş" görünür.
  // En üstteki topun KİMLİĞİ değişince (yeni kesim / geri alma) başa dön —
  // sabit aralıklı refetch'te kimlik değişmez, operatörün kaydırdığı yer durur.
  const listRef = useRef<ScrollView>(null);
  const newestId = rolls[0]?.id ?? null;
  useEffect(() => {
    listRef.current?.scrollTo({ y: 0, animated: false });
  }, [newestId]);

  const unprinted = useMemo(() => unprintedRolls(rolls), [rolls]);

  const totals = useMemo(() => outputTotals(rolls), [rolls]);
  // Etiket düzeltme satırdan kalktı (2026-11-10): satıra dokun / uzun bas → menü. Satır yine BASKI YAPMAZ.
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // KATLANABİLİR (2026-08-12 saha isteği): manuel metre girişi açıkken sağ
  // sütunda yer kalmıyor — başlığa dokununca liste kapanır, yalnız başlık +
  // sayaçlar kalır (tek satır). Tercih CİHAZDA kalıcı: numpad'i hep açık
  // istasyonda operatör her kartta yeniden kapatmak zorunda kalmasın.
  const collapsed = useDeviceSettingsStore((st) => st.tamburOutputCollapsed);
  const setCollapsed = useDeviceSettingsStore((st) => st.setTamburOutputCollapsed);

  if (!workOrderId) return null;

  return (
    <View style={[s.wrap, fill && s.wrapFill]}>
      {/* Başlık satırının TAMAMI aç/kapa tetiğidir (eldivenli parmak için
          geniş hedef); sağdaki yenile tuşu kendi dokunuşunu yutar. */}
      <TouchableRipple
        onPress={() => void setCollapsed(!collapsed)}
        rippleColor="rgba(30,64,175,0.10)"
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={collapsed ? `${title} — aç` : `${title} — kapat`}
      >
        <View style={s.header}>
          <Text style={s.headerTitle}>{title}</Text>
          {/* KAPALIYKEN sayaçlar başlık satırına taşınır — saha isteği:
              "kapalı konumdayken top ve basılan m yine gözüksün". */}
          {collapsed || fill ? (
            <Text style={s.headerTotals} testID="wo-output-ozet">
              {outputSummaryText(totals)}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          {lastMeasure ? (
            <Text style={[s.lastMeasure, { color: LAST_TONE[measureToneOf(lastMeasure.source)] }]} testID="tambur-olcum-serit">
              {`son: ${lastMeasure.barcode ? `${lastMeasure.barcode.slice(-4)} · ` : ''}${lastMeasure.meters.toFixed(1)} m · ${MEASURE_LABEL[lastMeasure.source]}`}
            </Text>
          ) : null}
          {!collapsed && <RefreshButton spinning={manualRefresh} onPress={() => void runManualRefresh()} />}
          <View style={s.chevron}>
            <Icon source={collapsed ? 'chevron-down' : 'chevron-up'} size={26} color="#64748b" />
          </View>
        </View>
      </TouchableRipple>

      {collapsed ? null : (
        <>
      {/* ÜST SAYAÇ — operatörün en çok baktığı iki sayı. "Kalan"la
          karıştırılmasın diye etiket açıkça "Basılan". */}
      {fill ? null : (
      <View style={s.totals}>
        <View style={s.totalBox}>
          <Text style={s.totalValue}>{totals.count}</Text>
          <Text style={s.totalLabel}>top</Text>
        </View>
        <View style={s.totalDivider} />
        <View style={s.totalBox}>
          <Text style={s.totalValue}>{totals.meters.toFixed(1)}</Text>
          <Text style={s.totalLabel}>m basılan</Text>
        </View>
      </View>
      )}

      {onPrintUnprinted && unprinted.length > 0 ? (
        <Button
          mode="contained"
          icon="printer-outline"
          onPress={() => onPrintUnprinted(unprinted)}
          style={s.bulkBtn}
          testID="wo-output-basilmayanlari-bas"
        >
          {`Basılmayanları bas (${unprinted.length})`}
        </Button>
      ) : null}

      {q.isLoading ? (
        <View style={s.empty}>
          <ActivityIndicator color="#94a3b8" />
        </View>
      ) : rolls.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>Bu işten henüz top çıkmadı</Text>
        </View>
      ) : (
        <ScrollView ref={listRef} style={s.list} nestedScrollEnabled testID="tambur-cikanlar-listesi">
          {rolls.map((r) => (
            // ⚠️ SATIRA DOKUNMAK BASKI DEĞİL (2026-08-12 saha şikâyeti: listeye
            // her dokunuş kâğıt bastırıyordu). Baskı YALNIZ yazıcı tuşundan —
            // satırın kendisi pasif; tuşlar eldiven boyuna büyütüldü.
            <OutputRow
              key={r.id}
              r={r}
              menuOpen={menuFor === r.id}
              onMenu={onFixLabel ? (open) => setMenuFor(open ? r.id : null) : undefined}
              onPrint={onPrint}
              onUndo={onUndo}
              onFixLabel={onFixLabel}
            />
          ))}
        </ScrollView>
      )}
        </>
      )}
    </View>
  );
}
