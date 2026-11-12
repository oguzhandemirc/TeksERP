import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { Text, Button, TouchableRipple, Icon, IconButton, ActivityIndicator } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';

import AppModal from '../../../components/AppModal';
import TruncatedText from '../../../components/TruncatedText';
import WorkOrderDocumentsSheet from './WorkOrderDocumentsSheet';
import WorkOrderFixSheet, { type FixKind } from './WorkOrderFixSheet';
import TargetValueFixSheet, { type TargetValueFixInput } from './TargetValueFixSheet';
import { kursunGramajKey } from './GramajFixSheet';
import TamburOrderLinkSheet from '../Tambur/TamburOrderLinkSheet';
import { tabletCancelAllowed } from './workOrderFix';
import { usePermissions } from '../../../hooks/usePermission';
import WorkOrderRecentEvents from './WorkOrderRecentEvents';
import { workOrderService } from '../../../services/workOrder.service';
import { workOrderGramajService } from '../../../services/workOrderGramaj.service';
import {
  WORK_ORDER_STATUS_LABEL,
  WORK_ORDER_STATUS_COLOR,
  WORK_ORDER_TYPE_LABEL,
  STEP_STATUS_LABEL,
  ROLL_STATUS_LABEL,
  isRetiredRoll,
  trLabel,
} from '../../../utils/labels';
import { colors, spacing, radius, palette } from '../../../theme';
import { TERIM } from '../../../lib/terim';
import { formatFactory } from '../../../lib/factory-time';
import { isCustomerGoodsWo } from '../IsEmirleri/workOrderRow';
import { detailColumns, incomingView, singlePieceNote, visibleAttachedRolls, targetView, summaryItems, routeChips, routeNotes, actionPlacement, type DetailRow, type StepTone, type FixKind3 } from './workOrderDetailView';
import WorkOrderIncomingCard from './WorkOrderIncomingCard';
import { WorkOrderMeterCard } from './WorkOrderMeter';

const TONE: Record<StepTone, { bg: string; fg: string }> = {
  info: { bg: colors.infoContainer, fg: colors.infoText },
  neutral: { bg: colors.border, fg: colors.textSecondary },
  success: { bg: colors.successContainer, fg: colors.successText },
  warning: { bg: colors.warningContainer, fg: colors.warningDark },
  danger: { bg: colors.dangerContainer, fg: colors.dangerDark },
};

const fmtDate = (iso: string) => formatFactory(iso, 'dd.MM.yyyy HH:mm');
/** Rota adım kutusu sabit genişliği (dp) — tüm kutular aynı boy. */
const ROUTE_STEP_WIDTH = 168;

/** Başlık çubuğu ikon düğmesi (yazısız, 56dp dokunma alanı). */
function HeaderIcon({ icon, label, onPress, testID }: { icon: string; label: string; onPress: () => void; testID: string }) {
  return <IconButton icon={icon} size={24} onPress={onPress} accessibilityLabel={label} testID={testID} style={styles.headIcon} />;
}

/** Dolu (contained) eylem düğmesi, beyaz yazı + simge (kullanıcı kararı: çerçeveli düğme yok); 56dp. */
function HeadBtn({ icon, label, onPress, testID, color = colors.brand }: { icon: string; label: string; onPress: () => void; testID: string; color?: string }) {
  return (
    <Button mode="contained" compact icon={icon} onPress={onPress} testID={testID} buttonColor={color} textColor={colors.textOnDark} style={styles.headBtn} contentStyle={styles.headBtnContent} labelStyle={styles.headBtnLabel}>
      {label}
    </Button>
  );
}

// Top Çıkar / Parti Ekle aynı aile (mavi), belirgin ton farkı; ikisinde de beyaz yazı kontrastı ≥ 5:1.
const BTN_DETACH = palette.blue[900];
const BTN_ADD = palette.blue[600];

/** Düzenlenebilir değer: değer + kalem TEK dokunulabilir çerçeveli öğe (56dp); düzenlenemeyen değer düz metindir. */
function EditableValue({ text, label, onPress, testID, fill }: { text: string; label: string; onPress: () => void; testID: string; fill?: boolean }) {
  return (
    <TouchableRipple onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${text}`} testID={testID} style={[styles.editVal, fill ? styles.editValFill : null]} borderless={false}>
      <View style={styles.editValInner}>
        <TruncatedText style={styles.editValText}>{text}</TruncatedText>
        <Icon source="pencil" size={18} color={colors.brand} />
      </View>
    </TouchableRipple>
  );
}

const FIX_TESTID: Record<FixKind3, string> = { color: 'ie-duzelt-renk', width: 'ie-duzelt-en', gramaj: 'ie-duzelt-gramaj', fold: 'ie-duzelt-kat', target: 'ie-duzelt-hedef' };
const FIX_LABEL: Record<FixKind3, string> = { color: 'Rengi değiştir', width: 'Eni değiştir', gramaj: 'Gramajı değiştir', fold: 'Kat tipini değiştir', target: 'Hedef değeri değiştir' };

/** Etiket solda küçük gri, değer sağda — sıkı satırlı kart; başlık sağında isteğe bağlı eylem, satır sonunda kalem. */
function InfoCard({ title, rows, testID, flex, headerRight, fixByLabel, targetByLabel, onFix }: { title?: string; rows: readonly DetailRow[]; testID: string; flex?: number; headerRight?: React.ReactNode; fixByLabel?: Partial<Record<string, FixKind3>>; targetByLabel?: Partial<Record<string, string>>; onFix?: (k: FixKind3, propertyId?: string) => void }) {
  return (
    <View style={[styles.infoCard, flex ? { flex } : null]} testID={testID}>
      {title || headerRight ? (
        <View style={styles.cardHead}>
          {title ? <Text style={[styles.cardTitle, styles.cardTitleFlex]}>{title}</Text> : <View style={{ flex: 1 }} />}
          {headerRight}
        </View>
      ) : null}
      {rows.map(([k, v]) => {
        const fix = fixByLabel?.[k];
        return (
          <View key={k} style={styles.infoRow}>
            <Text style={styles.infoKey}>{k}</Text>
            {fix && onFix ? (
              <View style={styles.infoValBox}>
                <EditableValue text={v} label={FIX_LABEL[fix]} onPress={() => onFix(fix, targetByLabel?.[k])} testID={FIX_TESTID[fix]} />
              </View>
            ) : (
              <Text style={styles.infoVal} numberOfLines={2}>
                {v}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

interface Props {
  workOrderId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

type Mode = 'detail' | 'cancel';

export default function WorkOrderDetailSheet({ workOrderId, onClose, onChanged }: Props) {
  const qc = useQueryClient();
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('detail');
  const [fix, setFix] = useState<FixKind | null>(null);
  const [targetFix, setTargetFix] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const { has } = usePermissions();
  const { width: screenWidth } = useWindowDimensions();
  const cols = detailColumns(screenWidth);

  const visible = !!workOrderId;

  useEffect(() => {
    if (visible) setMode('detail');
  }, [visible, workOrderId]);

  const woQuery = useQuery({
    queryKey: ['work-order', workOrderId],
    queryFn: () => workOrderService.getById(workOrderId as string),
    enabled: visible,
  });
  const rollsQuery = useQuery({
    queryKey: ['work-order-rolls', workOrderId],
    queryFn: () => workOrderService.getAttachedRolls(workOrderId as string),
    enabled: visible,
  });
  const impactQuery = useQuery({
    queryKey: ['work-order-cancel-impact', workOrderId],
    queryFn: () => workOrderService.getCancelImpact(workOrderId as string),
    enabled: visible && mode === 'cancel',
  });
  // ⚠️ "Sahadaki kart güncel değil" BANDI KALDIRILDI (2026-08-06, kullanıcı kararı):
  // `contentDirty` ekrandaki belgenin değil sahadaki KÂĞIDIN eskidiğini söylüyordu,
  // ama operatör onu bastığı belgenin yanında görüp "ekrandaki eski" diye okuyordu
  // — içerik her baskıda canlı çözüldüğü için bu okuma her zaman yanlıştı. Bantla
  // birlikte onu besleyen `traveler-card-active` sorgusu da düştü (tek tüketicisiydi).
  // Gerekçenin tamamı: Electron `TravelerCardPrintDialog` başlığı.

  const wo = woQuery.data?.data;
  // Tüketilmiş/emekli toplar (Tambur kesimi, fason açık-kumaş, kartela, iptal)
  // gizlenir — özellikle tamamlanan WO'da parent kayıtları karışıklık yaratıyordu.
  // Tek parça gelen müşteri kumaşı fiziksel top değildir: kök listeden düşer, metre Gelen kartında.
  const rolls = visibleAttachedRolls((rollsQuery.data?.data ?? []).filter((r) => !isRetiredRoll(r.status)), woQuery.data?.data?.incoming);
  const pieceNote = singlePieceNote(woQuery.data?.data?.incoming);
  const editable = wo && wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED';
  // Düzeltme menüsü ayrı yetenek (S7); panel yetkisi de açar.
  const canFix = !!editable && (has('mobile:is-emri-duzelt') || has('workorder:write'));
  // İptal yalnız hiç işlem görmemiş iş emrinde (S3); panel yetkisi her durumda.
  const canCancel = !!wo && !!editable && tabletCancelAllowed(wo, has('workorder:write'));
  // Gramajı Değiştir yalnız kurşun hedefi olan / kurşunu uygulanmış iş emrinde; eski sunucu (404) → düğme yok.
  const gramajQ = useQuery({ queryKey: kursunGramajKey(workOrderId ?? ''), queryFn: () => workOrderGramajService.kursunGramaj(workOrderId!), enabled: canFix && !!workOrderId, retry: false });
  const canGramaj = canFix && !!gramajQ.data?.propertyId && (!!gramajQ.data.target || gramajQ.data.appliedRollCount > 0);
  // 'target' kendi kartını açar (özellik başına); ötekiler Düzelt kart ailesi.
  const openFix = (k: FixKind3, propertyId?: string) => {
    if (k === 'target') setTargetFix(propertyId ?? null);
    else setFix(k);
  };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['work-order', workOrderId] });
    void qc.invalidateQueries({ queryKey: ['work-order-rolls', workOrderId] });
    void qc.invalidateQueries({ queryKey: ['work-order-events', workOrderId] });
    onChanged();
  };

  // ── İptal: DELETE (CANCELLED) ──────────────────────────────────────────────
  const cancelMut = useMutation({
    networkMode: 'always',
    mutationFn: () => workOrderService.cancel(workOrderId as string),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Toast.show({ type: 'success', text1: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} iptal edildi` });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      onChanged();
      onClose();
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      Toast.show({ type: 'error', text1: 'İptal edilemedi', text2: e?.response?.data?.message ?? e?.message });
    },
  });

  const statusColor = wo ? WORK_ORDER_STATUS_COLOR[wo.status] ?? colors.textMuted : colors.textMuted;
  const impact = impactQuery.data?.data;

  /** Hedef üretim özellikleri — pivot (`{property:{name}}`) ya da düz şekil. */
  const targetPropertyNames = useMemo<string[]>(() => {
    const raw = (wo?.targetProperties ?? []) as Array<
      { name?: string | null; property?: { name?: string | null } | null } | null
    >;
    return raw
      .map((tp) => tp?.property?.name ?? tp?.name ?? null)
      .filter((n): n is string => !!n);
  }, [wo]);

  const gramajPropertyId = gramajQ.data?.propertyId ?? null;
  const rollMeters = rolls.reduce((a, r) => a + (Number(r.currentQty) || 0), 0);
  const view = useMemo(() => {
    if (!wo) return null;
    return {
      summary: summaryItems({
        wo,
        typeLabel: trLabel(WORK_ORDER_TYPE_LABEL, wo.type),
        rollCount: rolls.length,
        rollMeters,
        fmtDate,
        singlePiece: !!pieceNote,
      }),
      incoming: incomingView(wo.incoming, Number(wo.inputRolls?.totalMeters) || null),
      target: targetView({ wo, fallbackItemName: rolls[0]?.item?.name, propertyNames: targetPropertyNames, fmtDate, gramajPropertyId, fixAllowed: { color: canFix, width: canFix, gramaj: canGramaj, fold: canFix, target: canFix } }),
      chips: routeChips(wo.steps),
      notes: routeNotes(wo.steps),
    };
  }, [wo, rolls, rollMeters, pieceNote, targetPropertyNames, gramajPropertyId, canFix, canGramaj]);

  const targetInput = useMemo<TargetValueFixInput | null>(() => {
    const tv = targetFix ? (wo?.targetValues ?? []).find((t) => t.propertyId === targetFix) : undefined;
    if (!wo || !tv?.propertyId) return null;
    return {
      woId: wo.id, workOrderNumber: wo.workOrderNumber, propertyId: tv.propertyId, propertyName: tv.property?.name ?? 'Hedef',
      valueId: tv.valueId ?? null, valueName: tv.value?.name ?? null, options: tv.property?.values ?? [],
    };
  }, [wo, targetFix]);

  const place = wo
    ? actionPlacement({ canFix, canCancel, isFason: isCustomerGoodsWo(wo.type), hasOrderLinks: (wo.orderLinks ?? []).length > 0 })
    : null;

  return (
    <>
    <AppModal visible={visible} onDismiss={onClose} position="bottom" contentStyle={styles.sheet}>
      {/* Başlık */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerBatch} numberOfLines={1}>
            {wo?.workOrderNumber ?? TERIM.terbiyeIsEmri.tekil}
          </Text>
          {wo ? (
            <>
              <View style={[styles.statusChip, { backgroundColor: statusColor }]}>
                <Text style={styles.statusChipText}>{trLabel(WORK_ORDER_STATUS_LABEL, wo.status)}</Text>
              </View>
              {/* "Fason İş Emri" ölçütü tek: tür CUSTOMER_GOODS_SERVICE (liste etiketiyle aynı ton). */}
              {isCustomerGoodsWo(wo.type) ? (
                <View style={[styles.statusChip, styles.fasonChip]} testID="ie-detay-fason">
                  <Text style={styles.fasonChipText}>{`Fason ${TERIM.terbiyeIsEmri.tekil}`}</Text>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
        {wo ? <HeaderIcon icon="file-document-multiple-outline" label="Belgeler" onPress={() => setDocumentsOpen(true)} testID="ie-belgeler" /> : null}
        {place?.reprint ? <HeaderIcon icon="printer" label="Kartı yeniden bas" onPress={() => setFix('reprint')} testID="ie-kart-yeniden-bas" /> : null}
        <TouchableRipple onPress={onClose} borderless style={styles.closeBtn} accessibilityLabel="Kapat" testID="ie-detay-kapat">
          <Icon source="close" size={24} color={colors.textSecondary} />
        </TouchableRipple>
      </View>

      {woQuery.isLoading || !wo ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : mode === 'cancel' ? (
        // ── İPTAL ÖNİZLEME ───────────────────────────────────────────────────
        <ScrollView contentContainerStyle={styles.body}>
          {impactQuery.isLoading || !impact ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.danger} />
            </View>
          ) : (
            <>
              <View style={styles.warnBox}>
                <Icon source="alert" size={20} color={colors.dangerDark} />
                <Text style={styles.warnText}>
                  {impact.canCancel
                    ? `Bu ${TERIM.terbiyeIsEmri.tekilKucuk} iptal edilecek. ${impact.rolls.length} top stoğa geri dönecek${
                        impact.travelerCardCount > 0 ? `, ${impact.travelerCardCount} refakat kartı geçersiz olacak` : ''
                      }.`
                    : impact.blockReason}
                </Text>
              </View>
              {impact.rolls.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Etkilenecek Toplar ({impact.rolls.length})</Text>
                  {impact.rolls.slice(0, 50).map((r) => (
                    <View key={r.id} style={styles.rollLine}>
                      <Text style={styles.rollLineBarcode} numberOfLines={1}>
                        {r.barcode ?? '—'}
                      </Text>
                      <Text style={styles.rollLineMeta}>
                        {trLabel(ROLL_STATUS_LABEL, r.status)} · {Math.round(r.currentQty)}m
                        {r.processed ? ' · işlenmiş' : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={styles.actionsCol}>
                {impact.canCancel ? (
                  <Button
                    mode="contained"
                    icon="cancel"
                    buttonColor={colors.dangerDark}
                    textColor={colors.textOnDark}
                    onPress={() => cancelMut.mutate()}
                    loading={cancelMut.isPending}
                    disabled={cancelMut.isPending}
                    contentStyle={styles.btnContent}
                  >
                    {`${TERIM.terbiyeIsEmri.cekim.belirtme} İptal Et`}
                  </Button>
                ) : null}
                <Button mode="contained" buttonColor={palette.slate[600]} textColor={colors.textOnDark} onPress={() => setMode('detail')} disabled={cancelMut.isPending} contentStyle={styles.btnContent}>
                  Vazgeç
                </Button>
              </View>
            </>
          )}
        </ScrollView>
      ) : (
        // ── DETAY ────────────────────────────────────────────────────────────
        <ScrollView contentContainerStyle={styles.body}>
          {view && (view.summary.length > 0 || place?.orderLink) ? (
            <View style={styles.strip} testID="ie-detay-ozet">
              {view.summary.map(([k, v], i) => {
                const perRow = cols === 2 ? view.summary.length : Math.min(3, view.summary.length);
                const lastInRow = (i + 1) % perRow === 0;
                return (
                  <View key={k} style={[styles.stripItem, { width: `${100 / perRow}%` }, lastInRow ? null : styles.stripDivider]}>
                    <Text style={styles.stripKey}>{k}</Text>
                    <Text style={styles.stripVal}>{v}</Text>
                  </View>
                );
              })}
              {place?.orderLink ? (
                <View style={styles.stripActions}>
                  <HeadBtn icon="link-variant" label="Sipariş Bağla / Çöz" onPress={() => setLinkOpen(true)} testID="ie-siparis-bagla" color={colors.brandDark} />
                </View>
              ) : null}
            </View>
          ) : null}

          {view ? (
            <View style={cols === 2 ? styles.rowCols : styles.colStack} testID={cols === 2 ? 'ie-detay-yatay' : 'ie-detay-dikey'}>
              <WorkOrderIncomingCard view={view.incoming} flex={cols === 2 ? 1 : undefined} onOpenDocuments={() => setDocumentsOpen(true)} />
              <InfoCard title="Hedef" rows={view.target.rows} fixByLabel={view.target.fixByLabel} targetByLabel={view.target.targetByLabel} onFix={openFix} testID="ie-detay-hedef" flex={cols === 2 ? 1 : undefined} />
            </View>
          ) : null}

          {wo ? <WorkOrderMeterCard workOrderId={wo.id} /> : null}

          {/* Rota — yatay adım çipleri */}
          {view && view.chips.length > 0 ? (
            <View style={styles.section} testID="ie-detay-rota">
              <Text style={styles.sectionTitle}>Üretim Rotası</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.routeRow}>
                {view.chips.map((c, idx) => {
                  const tone = TONE[c.tone];
                  return (
                    <React.Fragment key={c.id}>
                      {idx > 0 ? (
                        <View style={styles.routeArrow}>
                          <Icon source="arrow-right" size={20} color={colors.textMuted} />
                        </View>
                      ) : null}
                      {/* Sabit genişlik + satırda en uzun kutuya eşit boy (routeRow stretch): içerik farkı boyu değiştirmez. */}
                      <View style={styles.routeStep} testID={`ie-detay-adim-${c.seq}`}>
                        <View style={styles.routeNameRow}>
                          <Text style={styles.stepSeq}>{c.seq}</Text>
                          <View style={styles.stepNameBox}>
                            <TruncatedText style={styles.stepName}>{c.name}</TruncatedText>
                          </View>
                        </View>
                        <View style={[styles.stepBadge, { backgroundColor: tone.bg }]}>
                          <Text style={[styles.stepBadgeText, { color: tone.fg }]} numberOfLines={1}>
                            {c.outside ? 'Fason dışarıda' : trLabel(STEP_STATUS_LABEL, c.status)}
                          </Text>
                        </View>
                        {c.where && !c.outside ? <Text style={styles.stepMeta} numberOfLines={1}>{c.where}</Text> : null}
                        {(view.target.byStep[c.id] ?? []).map((t, ti) => {
                          const text = t.label ? `${t.label} ${t.value}` : t.value;
                          return (
                            <View key={`${t.label}-${ti}`} style={styles.stepTarget} testID={`ie-detay-adim-hedef-${c.seq}`}>
                              {t.fix ? (
                                <EditableValue text={text} label={FIX_LABEL[t.fix]} onPress={() => openFix(t.fix as FixKind3, t.propertyId)} testID={FIX_TESTID[t.fix]} fill />
                              ) : (
                                <TruncatedText style={styles.stepTargetText}>{text}</TruncatedText>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    </React.Fragment>
                  );
                })}
              </ScrollView>
              {view.notes.map((n) => (
                <Text key={n.id} style={styles.note}>{`${n.name}: ${n.note}`}</Text>
              ))}
            </View>
          ) : null}

          <View style={cols === 2 ? styles.rowCols : styles.colStack}>
            <View style={cols === 2 ? { flex: 1 } : undefined}>
              <WorkOrderRecentEvents workOrderId={wo.id} />
            </View>
            <View style={[styles.section, cols === 2 ? { flex: 1 } : null]}>
            <View style={styles.cardHead}>
              <Text style={[styles.sectionTitle, styles.cardTitleFlex]}>{pieceNote && rolls.length === 0 ? 'Bağlı Toplar' : `Bağlı Toplar (${rolls.length})`}</Text>
              {place?.detach ? <HeadBtn icon="tray-remove" label="Top Çıkar" onPress={() => setFix('detach')} testID="ie-top-cikar" color={BTN_DETACH} /> : null}
              {place?.addBatch ? <HeadBtn icon="tray-plus" label="Parti Ekle" onPress={() => setFix('addBatch')} testID="ie-parti-ekle" color={BTN_ADD} /> : null}
            </View>
            {rollsQuery.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.md }} />
            ) : (
              <>
                {pieceNote ? <Text style={styles.pieceNote} testID="ie-detay-tek-parca">{pieceNote}</Text> : null}
                {rolls.length === 0 && !pieceNote ? <Text style={styles.muted}>Bağlı top yok.</Text> : null}
                {rolls.slice(0, 100).map((r) => (
                  <View key={r.id} style={styles.rollLine}>
                    <Text style={styles.rollLineBarcode} numberOfLines={1}>
                      {r.barcode ?? '—'}
                    </Text>
                    <Text style={styles.rollLineMeta} numberOfLines={1}>
                      {r.item?.name ?? '—'} · {Math.round(Number(r.currentQty))}m
                    </Text>
                  </View>
                ))}
              </>
            )}
            </View>
          </View>

          {editable && !canCancel ? (
            <Text style={styles.note}>Bu {TERIM.terbiyeIsEmri.cekimKucuk.bulunma} üretim başladı — iptal panelden yapılır (toplar için karar ve sebep sorulur).</Text>
          ) : null}
          {canCancel ? (
            <View style={styles.cancelRow}>
              <Button
                mode="contained"
                compact
                icon="cancel"
                buttonColor={colors.dangerDark}
                textColor={colors.textOnDark}
                onPress={() => setMode('cancel')}
                testID="ie-iptal"
                style={styles.cancelBtn}
                contentStyle={styles.headBtnContent}
              >
                {`${TERIM.terbiyeIsEmri.cekim.belirtme} İptal Et`}
              </Button>
            </View>
          ) : null}
          <View style={{ height: spacing.lg }} />
        </ScrollView>
      )}

    </AppModal>

    {/* Belgeler — detay modalının KARDEŞİ, İÇİNDE değil. AppModal Paper `Portal`
        kullanıyor: iki sheet de kök portal host'una taşınır, sonra mount olan
        üstte kalır ve detay arkada açık durur (kapatınca detaya dönülür).
        İç içe yerleştirme kod tabanında hiç emsali olmayan bir kurulumdu —
        `RemoteListSheet` bugüne dek hep AppModal DIŞINDA kullanıldı. */}
    {/* Düzeltme kartları detayın KARDEŞİ (Belgeler emsali): kapanınca detaya dönülür. */}
    <WorkOrderFixSheet
      kind={fix}
      wo={wo ?? null}
      onDismiss={() => setFix(null)}
      onDone={() => {
        setFix(null);
        refresh();
      }}
    />
    {targetInput ? (
      <TargetValueFixSheet
        target={targetInput}
        onDismiss={() => setTargetFix(null)}
        onDone={() => {
          setTargetFix(null);
          refresh();
        }}
      />
    ) : null}
    {wo ? (
      <TamburOrderLinkSheet visible={linkOpen} onDismiss={() => setLinkOpen(false)} workOrderId={wo.id} onLinked={refresh} />
    ) : null}
    <WorkOrderDocumentsSheet
      visible={documentsOpen}
      onDismiss={() => setDocumentsOpen(false)}
      workOrderId={workOrderId ?? null}
      workOrderNumber={wo?.workOrderNumber}
    />
    </>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.appBg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    height: '90%',
    width: '100%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBatch: { fontSize: 18, fontWeight: '800', color: colors.text },
  fasonChip: { backgroundColor: colors.warningContainer },
  fasonChipText: { fontSize: 12, fontWeight: '700', color: colors.warningDark },
  headerTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  statusChip: { borderRadius: 4, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  statusChipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  closeBtn: { padding: spacing.xs, borderRadius: radius.full },
  center: { padding: spacing.xxxl, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.lg, gap: spacing.md },
  note: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },

  infoCard: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  cardTitle: { fontSize: 13, fontWeight: '800', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  infoKey: { width: 120, color: colors.textMuted, fontWeight: '500', fontSize: 12 },
  infoVal: { flex: 1, color: colors.text, fontWeight: '700', fontSize: 14 },
  rowCols: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  colStack: { gap: spacing.md },
  strip: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.xs },
  stripItem: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  stripDivider: { borderRightWidth: 1, borderRightColor: colors.border },
  stripKey: { fontSize: 11, color: colors.textMuted },
  stripVal: { fontSize: 14, fontWeight: '700', color: colors.text },
  routeRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  routeArrow: { justifyContent: 'center' },
  routeStep: { width: ROUTE_STEP_WIDTH, minHeight: 96, alignItems: 'center', gap: 4, backgroundColor: colors.appBg, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  routeNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'stretch', justifyContent: 'center' },
  stepNameBox: { flexShrink: 1, minWidth: 0 },
  stepBadge: { borderRadius: 4, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  stepBadgeText: { fontSize: 12, fontWeight: '700' },

  section: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.sm },
  stepLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 },
  stepSeq: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brandSoft, color: colors.brand, fontWeight: '800', fontSize: 12, textAlign: 'center', lineHeight: 22 },
  stepName: { fontWeight: '700', color: colors.text, fontSize: 14 },
  stepMeta: { fontSize: 12, color: colors.textMuted },
  muted: { color: colors.textMuted, fontSize: 13 },
  pieceNote: { color: colors.textSecondary, fontSize: 14, fontWeight: '600', lineHeight: 20 },

  rollLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border },
  rollLineBarcode: { flex: 1, fontFamily: 'monospace', fontSize: 12, color: colors.text },
  rollLineMeta: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },

  warnBox: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.dangerContainer, borderRadius: radius.md, padding: spacing.md },
  warnText: { flex: 1, color: colors.dangerText, fontSize: 13, lineHeight: 18, fontWeight: '600' },

  cancelRow: { alignItems: 'flex-end' },
  cancelBtn: { borderRadius: radius.md, borderColor: colors.dangerDark },
  headBtn: { borderRadius: radius.md },
  headBtnContent: { minHeight: 56 }, // tablet dokunma hedefi tabanı (mobil/CLAUDE.md)
  headBtnLabel: { fontSize: 13 },
  headIcon: { margin: 0, width: 56, height: 56 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  cardTitleFlex: { flex: 1, marginBottom: 0 },
  stripActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, marginLeft: 'auto' },
  stepTarget: { alignSelf: 'stretch', alignItems: 'center' },
  stepTargetText: { fontSize: 13, fontWeight: '700', color: colors.text },
  infoValBox: { flex: 1, alignItems: 'flex-start' },
  editVal: { minHeight: 56, justifyContent: 'center', borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, backgroundColor: colors.brandSoft, paddingHorizontal: spacing.sm },
  editValFill: { alignSelf: 'stretch' },
  editValInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  editValText: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: colors.brandDark },
  actionsCol: { gap: spacing.sm, marginTop: spacing.md },
  btnContent: { height: 48 },
});
