// İş Emirleri — oluşturma: tek İE formu (UnifiedWoForm; "Belge Okut" = tarayıcı hemen açılır, "Elle Oluştur" = belgesiz)
// + okuma bitince önizleme kartı. Malın sahibi kartı ve rota alanı iki yolda da formdadır.
// Önizleme kaydırmasız tek ekran: büyük karolar; bulunan alan yeşil + onay ikonu, şablonda olup bulunamayan kırmızı +
// uyarı ikonu (renk tek taşıyıcı değil). "Devam et" kartı kapatır (form altta dolu), "Vazgeç" listeye döner.
import React, { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import ModuleSheet, { moduleSheetWidth } from '../../../components/ModuleSheet';
import type { ProductionRoute } from '../../../services/route.service';
import { colors, radius, spacing, typography } from '../../../theme';
import UnifiedWoForm from '../GelenBelge/woCreate/UnifiedWoForm';
import { useReadResult } from '../GelenBelge/useReadResult';
import type { DocRowOpenRequest } from '../GelenBelge/woCreate/DocRowCard';
import type { WoCreateKind } from '../../../store/woCreateKinds';
import { useQuery } from '@tanstack/react-query';
import { INBOUND_DOC_CONTEXT_KEY } from '../GelenBelge/DocHeader';
import { inboundDocService } from '../../../services/inboundDoc.service';
import { customerGoodsTiles, customerTileMissing, previewTiles, tileLayout, type PreviewTile } from './scanFlow';

const TILE_TONE = {
  found: { bg: colors.successContainer, border: colors.success, fg: colors.successText, icon: 'check-circle' },
  missing: { bg: colors.dangerContainer, border: colors.danger, fg: colors.dangerText, icon: 'alert-circle' },
  unknown: { bg: colors.surfaceMuted, border: colors.border, fg: colors.textSecondary, icon: 'minus-circle-outline' },
} as const;

interface StageProps {
  /** Formun ön seçili rotası (null = formda seçilir). */
  route: ProductionRoute | null;
  kinds: readonly WoCreateKind[];
  manual: boolean;
  onCancel: () => void;
  /** Kaydedildikten sonra "Yeni iş emri". */
  onNew: () => void;
  /** ⚙ Alanlar sayfası başlık ikonundan (kontrollü); verilmezse form kendi düğmesini çizer. */
  fieldsOpen?: boolean;
  onFieldsOpenChange?: (open: boolean) => void;
}

export default function ScanStage({ route, kinds, manual, onCancel, onNew, fieldsOpen, onFieldsOpenChange }: StageProps) {
  const [note, setNote] = useState<{ id: string; run: number } | null>(null);
  // Fason: müşteri bulunamadıysa "Müşteri seç" kartı kapatır ve formun müşteri seçicisini (PickerModal) açar.
  const [ownerReq, setOwnerReq] = useState<DocRowOpenRequest | null>(null);
  // Önizlemede müşteri büyük karo: cihaz yalnız Fason türündeyse (tür kartı yoksa tek bilinen tür).
  const customerGoods = kinds.length === 1 && kinds[0] === 'CUSTOMER_GOODS';
  const [dismissedRun, setDismissedRun] = useState<number | null>(null);
  const { watch } = useReadResult(note?.id ?? null, note?.run ?? 0);
  const summary = watch?.phase === 'done' ? watch.summary : null;
  const open = !!summary && note !== null && dismissedRun !== note.run;
  // Formla aynı cari listesi (DocBatchView aynı anahtarla çeker; önbellekten gelir).
  const ctx = useQuery({ queryKey: INBOUND_DOC_CONTEXT_KEY, queryFn: inboundDocService.tabletContext, staleTime: 60_000, enabled: customerGoods });
  const ownerName = (id: string) => ctx.data?.data.customers.find((c) => c.id === id)?.name ?? null;
  const tiles = summary ? (customerGoods ? customerGoodsTiles(summary, ownerName) : previewTiles(summary)) : [];

  return (
    <View style={styles.fill}>
      <UnifiedWoForm
        initialRoute={route}
        routeLocked={false}
        onNew={onNew}
        fieldsOpen={fieldsOpen}
        onFieldsOpenChange={onFieldsOpenChange}
        ownerKinds={kinds}
        autoScan={!manual}
        manual={manual}
        openRequest={ownerReq}
        onNote={manual ? undefined : (n, run) => setNote({ id: n.id, run })}
      />
      {summary && (
        <PreviewSheet
          visible={open}
          title={`Belge okundu · ${summary.noteNo}`}
          subtitle={summary.reason ?? `${summary.lineCount} satır okundu${summary.reviewCount ? ` · ${summary.reviewCount} satır kontrol istiyor` : ''}`}
          tiles={tiles}
          leadTile={customerGoods}
          onPickCustomer={customerGoods && customerTileMissing(tiles) ? () => { setDismissedRun(note?.run ?? null); setOwnerReq((r) => ({ kind: 'owner', seq: (r?.seq ?? 0) + 1 })); } : undefined}
          onContinue={() => setDismissedRun(note?.run ?? null)}
          onCancel={onCancel}
        />
      )}
    </View>
  );
}

interface PreviewProps {
  visible: boolean;
  title: string;
  subtitle: string;
  tiles: PreviewTile[];
  /** Fason: ilk karo (müşteri) tam genişlik ve büyük yazılır. */
  leadTile?: boolean;
  /** Fason + müşteri bulunamadı: kartı kapatıp formun müşteri seçicisini açar. */
  onPickCustomer?: () => void;
  onContinue: () => void;
  onCancel: () => void;
}

const LEAD_H = 120;

function PreviewSheet({ visible, title, subtitle, tiles: all, leadTile = false, onPickCustomer, onContinue, onCancel }: PreviewProps) {
  const win = useWindowDimensions();
  // Karo alanı: kart genişliği − yan boşluklar; yükseklik: AppModal tavanı (%88) − başlık − düğme şeridi − boşluk.
  const areaW = moduleSheetWidth(win.width) - spacing.xxl * 2;
  const lead = leadTile ? all[0] ?? null : null;
  const tiles = lead ? all.slice(1) : all;
  const areaH = Math.round(win.height * 0.88) - 96 - 88 - spacing.lg * 2 - 24 - (lead ? LEAD_H + spacing.md : 0);
  const L = useMemo(() => tileLayout(tiles.length, areaW, areaH), [tiles.length, areaW, areaH]);
  const missing = all.filter((t) => t.state === 'missing').length;
  const tileW = (areaW - spacing.md * (L.columns - 1)) / L.columns;
  return (
    <ModuleSheet
      visible={visible}
      onDismiss={onContinue}
      title={title}
      subtitle={missing ? `${subtitle} · ${missing} alan bulunamadı — formda tamamlayın` : subtitle}
      footer={
        <>
          <Button mode="outlined" onPress={onCancel} contentStyle={styles.btn} testID="ie-onizleme-vazgec">Vazgeç</Button>
          {onPickCustomer && <Button mode="contained-tonal" icon="account-search-outline" onPress={onPickCustomer} contentStyle={styles.btn} testID="ie-onizleme-musteri-sec">Müşteri seç</Button>}
          <Button mode="contained" onPress={onContinue} contentStyle={styles.btn} icon="arrow-right" testID="ie-onizleme-devam">Devam et</Button>
        </>
      }
    >
      {lead && <LeadTile tile={lead} />}
      <View style={styles.grid} testID="ie-onizleme-karolar">
        {tiles.slice(0, L.shown).map((t) => {
          const tone = TILE_TONE[t.state];
          return (
            <View key={t.key} style={[styles.tile, { width: tileW, height: L.tileHeight, backgroundColor: tone.bg, borderColor: tone.border }]} testID={`ie-karo-${t.key}-${t.state}`}>
              <View style={styles.tileHead}>
                <Icon source={tone.icon} size={L.labelSize + 4} color={tone.fg} />
                <Text style={[styles.tileLabel, { fontSize: L.labelSize, color: tone.fg }]} numberOfLines={1}>{t.label}</Text>
              </View>
              <Text style={[styles.tileValue, { fontSize: L.valueSize, color: t.state === 'found' ? colors.text : tone.fg }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
                {t.value}
              </Text>
            </View>
          );
        })}
        {L.hidden > 0 && (
          <View style={[styles.tile, styles.moreTile, { width: tileW, height: L.tileHeight }]}>
            <Text style={[styles.tileValue, { fontSize: L.valueSize }]}>+{L.hidden} alan</Text>
            <Text style={[styles.tileLabel, { fontSize: L.labelSize }]}>formda görünür</Text>
          </View>
        )}
      </View>
    </ModuleSheet>
  );
}

function LeadTile({ tile }: { tile: PreviewTile }) {
  const tone = TILE_TONE[tile.state];
  return (
    <View style={[styles.tile, styles.lead, { backgroundColor: tone.bg, borderColor: tone.border }]} testID={`ie-karo-lead-${tile.key}-${tile.state}`}>
      <View style={styles.tileHead}>
        <Icon source={tone.icon} size={24} color={tone.fg} />
        <Text style={[styles.tileLabel, { fontSize: typography.size.base, color: tone.fg }]}>{tile.label}</Text>
      </View>
      <Text style={[styles.tileValue, styles.leadValue, { color: tile.state === 'found' ? colors.text : tone.fg }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>
        {tile.value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { width: '100%', height: LEAD_H, marginBottom: spacing.md },
  leadValue: { fontSize: typography.size.display },
  fill: { flex: 1 },
  btn: { minHeight: 56, paddingHorizontal: spacing.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { borderWidth: 2, borderRadius: radius.lg, padding: spacing.md, justifyContent: 'space-between' },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tileLabel: { flexShrink: 1, fontWeight: typography.weight.semibold },
  tileValue: { fontWeight: typography.weight.bold },
  moreTile: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
});
