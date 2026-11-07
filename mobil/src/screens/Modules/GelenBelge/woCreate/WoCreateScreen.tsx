// "Terbiye İş Emri oluştur" (Gülkesim K6) — menüde Belge Tara'nın yerine; panel seçicisinin aynası. 1. satır sabit türler
// (tablette yalnız Hızlı Terbiye İş Emri), 2. satır "Özel iş emirleri" kısayolları. Kısayol → doğrudan form (rota hazır)
// + üstte "Belge okut". Kısayol yoksa 2. satır görünmez ve bugünkü Belge Tara yolu 1. satırda kalır.
// S16b `gelenBelge.tabletIeGirisi`: IKISI = bu ekran BİREBİR; BELGE = her karo tek formu (UnifiedWoForm) açar, top/masa/
// Belge Tara gizli; TOP = yalnız top yolu (Hızlı İE), belge okutma yok.
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
// Klavye düzenlenen alanı örtmesin (prova 2026-11-06): odaktaki girdi klavyenin üstüne kayar; özel numpad (NumpadHost) etkilenmez.
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { ActivityIndicator, Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import ScreenChrome from '../../../../components/ScreenChrome';
import { useVisibleScreens } from '../../../../hooks/useVisibleScreens';
import { usePermissions } from '../../../../hooks/usePermission';
import { TERIM } from '../../../../lib/terim';
import { routeService, type ProductionRoute } from '../../../../services/route.service';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';
import { colors, radius, spacing, typography } from '../../../../theme';
import NewWorkOrderView from '../../HizliIsEmri/NewWorkOrderView';
import { DocScanBody } from '../DocScanScreen';
import DeskView from '../desk/DeskView';
import DocBatchView from './DocBatchView';
import UnifiedWoForm from './UnifiedWoForm';
import { useTabletWoEntry } from './useWoEntry';
import { hubTiles, type HubTiles } from './woForm';
import { useScanRouteMode } from '../../../../hooks/useFeatureFlags';
import { isScanRoute, shortcutRoutes, shortcutSub, shortcutTitle, withScanRoute } from './woFromDoc';

type Stage =
  | { kind: 'hub' }
  /** Hızlı İE formu; `route` = kısayoldan açıldıysa ön seçili rota. */
  | { kind: 'form'; route: ProductionRoute | null }
  | { kind: 'scan'; route: ProductionRoute; multi: boolean }
  | { kind: 'legacy' }
  /** K23 belge masası: kamera ↔ tek inceleme (hazır İE kısayolları gerekir). */
  | { kind: 'desk' }
  /** S16b tek form (BELGE kipi); `n` "Yeni iş emri"nde formu sıfırdan kurar. */
  | { kind: 'unified'; route: ProductionRoute | null; locked: boolean; n: number }
  /** K30-A1 "Belge tanıt": çek → oku → Tanıt (iş emri açılmaz). */
  | { kind: 'teach' };

export const WO_SHORTCUTS_KEY = ['routes', 'wo-shortcuts'] as const;
const title_ = (): string => `${TERIM.terbiyeIsEmri.tekil} oluştur`;
const quick_ = (): string => `Hızlı ${TERIM.terbiyeIsEmri.tekil}`;
const DESK = 'Belge masası';

/** "Bu cihaz belge masası" (cihaz ayarı): kısayollar yüklenince ekran BİR KEZ doğrudan masa kipinde açılır; geri → seçici. */
function useDeskAutoOpen(available: boolean, open: () => void): void {
  const deskDevice = useDeviceSettingsStore((s) => s.docDeskDevice);
  const opened = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!deskDevice || !available || opened.current) return;
    opened.current = true;
    openRef.current();
  }, [deskDevice, available]);
}

export default function WoCreateScreen() {
  const [stage, setStage] = useState<Stage>({ kind: 'hub' });
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [hasResult, setHasResult] = useState(false);
  const canManual = useVisibleScreens().visibleScreens.some((s) => s.key === 'HizliIsEmri');
  const { entry, ready } = useTabletWoEntry();
  const q = useQuery({ queryKey: WO_SHORTCUTS_KEY, queryFn: routeService.getShortcuts, retry: false, staleTime: 60_000 });
  // K29 S14b: "Okutmayla" kipinde rotasız seçenek kısayolların BAŞINDA (varsayılan); sıralıda bugünkü liste.
  const realShortcuts = shortcutRoutes(q.data?.data ?? []);
  const shortcuts = withScanRoute(realShortcuts, useScanRouteMode());
  // S15b: masa cihazında doğrudan açılış yalnız GERÇEK kısayol varken (bugünkü davranış) — rotasız sözde kısayol sayılmaz.
  // S16b: masa yalnız IKISI'de (BELGE/TOP'ta masa yolu yok); kip bilinmeden açılmaz.
  useDeskAutoOpen(ready && entry === 'IKISI' && realShortcuts.length > 0, () => setStage({ kind: 'desk' }));
  const tiles = hubTiles(entry, { canManual, shortcuts: shortcuts.length, loading: q.isLoading });
  const belge = entry === 'BELGE';
  const perms = usePermissions();
  // Tanıtma girişi menüde bulunabilir olmalı; belge okutmanın olmadığı TOP kipinde yok. hubTiles'a dokunulmaz (sözleşme testi).
  const canTeach = entry !== 'TOP' && perms.has('gelen-belge:template') && perms.has('gelen-belge:read') && perms.has('gelen-belge:write');

  const openUnified = (route: ProductionRoute | null) => setStage({ kind: 'unified', route, locked: route !== null, n: Date.now() });
  const openForm = (route: ProductionRoute | null) => {
    if (belge) return openUnified(route);
    setStep(0);
    setHasResult(false);
    setStage({ kind: 'form', route });
  };
  const back = (): void => {
    if (stage.kind === 'form' && !hasResult && step > 0) return setStep((s) => s - 1);
    if (stage.kind === 'scan') return openForm(stage.route);
    setHasResult(false);
    setStage({ kind: 'hub' });
  };

  const route = stage.kind === 'form' || stage.kind === 'scan' || stage.kind === 'unified' ? stage.route : null;
  const title = stage.kind === 'teach' ? 'Belge tanıt' : stage.kind === 'legacy' ? 'Belge Tara' : stage.kind === 'desk' ? DESK : route ? shortcutTitle(route) : stage.kind === 'form' ? quick_() : title_();

  return (
    <ScreenChrome title={title} onStepBack={stage.kind === 'hub' ? undefined : back} headerExtras={stage.kind === 'unified' ? <FieldsHeaderChip onPress={() => setFieldsOpen(true)} /> : undefined}>
      {stage.kind === 'hub' && !ready && <ActivityIndicator style={styles.loading} testID="ie-giris-kipi-yukleniyor" />}
      {stage.kind === 'hub' && ready && (
        <Hub
          tiles={tiles}
          shortcuts={shortcuts}
          loading={q.isLoading}
          onQuick={() => openForm(null)}
          onForm={() => openUnified(null)}
          onDesk={() => setStage({ kind: 'desk' })}
          onLegacy={() => setStage({ kind: 'legacy' })}
          onShortcut={openForm}
          onTeach={canTeach ? () => setStage({ kind: 'teach' }) : undefined}
        />
      )}
      {stage.kind === 'form' && (
        <View style={styles.fill}>
          {stage.route && entry !== 'TOP' && (
            <View style={styles.scanBar}>
              <Button mode="contained" icon="file-document-outline" onPress={() => setStage({ kind: 'scan', route: stage.route!, multi: false })} contentStyle={styles.bigBtn} labelStyle={styles.bigLabel} style={styles.grow} testID="ie-belge-okut">
                Belge okut
              </Button>
              <Button mode="outlined" icon="file-multiple-outline" onPress={() => setStage({ kind: 'scan', route: stage.route!, multi: true })} contentStyle={styles.bigBtn} testID="ie-birden-cok-belge">
                Birden çok belge
              </Button>
            </View>
          )}
          {stage.route && isScanRoute(stage.route) && entry !== 'TOP' ? (
            <Text style={[styles.hint, styles.body]} testID="ie-rotasiz-ipucu">Rotasız {TERIM.terbiyeIsEmri.tekilKucuk} yalnız belge okutularak açılır; adımlar istasyonda okutuldukça eklenir.</Text>
          ) : canManual ? (
            <NewWorkOrderView step={step} onStepChange={setStep} onResultChange={setHasResult} initialRouteTemplateId={stage.route && !isScanRoute(stage.route) ? stage.route.id : null} />
          ) : (
            <Text style={[styles.hint, styles.body]}>Elle giriş için {quick_()} yetkisi gerekir; belgeyi okutarak devam edin.</Text>
          )}
        </View>
      )}
      {stage.kind === 'scan' && <DocBatchView route={stage.route} multi={stage.multi} autoStart />}
      {stage.kind === 'legacy' && <DocScanBody />}
      {stage.kind === 'teach' && <DocScanBody teachOnly />}
      {stage.kind === 'desk' && <DeskView shortcuts={shortcuts} />}
      {stage.kind === 'unified' && (
        <UnifiedWoForm key={stage.n} initialRoute={stage.route} routeLocked={stage.locked} onNew={() => setStage({ ...stage, n: stage.n + 1 })} fieldsOpen={fieldsOpen} onFieldsOpenChange={setFieldsOpen} />
      )}
    </ScreenChrome>
  );
}

interface HubProps {
  tiles: HubTiles;
  shortcuts: ProductionRoute[];
  loading: boolean;
  onQuick: () => void;
  onForm: () => void;
  onDesk: () => void;
  onLegacy: () => void;
  onShortcut: (r: ProductionRoute) => void;
  /** Yoksa (izin / TOP kipi) "Belge tanıt" kutusu çizilmez. */
  onTeach?: () => void;
}

/** Seçici: 1. satır sabit türler (giriş kipine göre), 2. satır "Özel iş emirleri" kısayolları. */
function Hub(p: HubProps) {
  return (
    <KeyboardAwareScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bottomOffset={24}>
      <View style={styles.grid} testID="ie-sabit-turler">
        {p.tiles.quick && <Tile icon="rocket-launch-outline" title={quick_()} sub="Topu okutup başlat" onPress={p.onQuick} testID="ie-tur-hizli" />}
        {p.tiles.form && <Tile icon="file-document-edit-outline" title={title_()} sub="Belge okut → kontrol et → oluştur" onPress={p.onForm} testID="ie-tur-form" />}
        {p.tiles.desk && (
          <Tile icon="table-furniture" title={DESK} sub="Kamera açık bekler; okut → kontrol et → oluştur" onPress={p.onDesk} testID="ie-tur-belge-masasi" />
        )}
        {p.tiles.legacy && (
          <Tile icon="file-document-outline" title="Belge Tara" sub="Müşteri irsaliyesi → taslak" onPress={p.onLegacy} testID="ie-tur-belge-tara" />
        )}
        {p.onTeach && <Tile icon="creation" title="Belge tanıt" sub="Belgeyi okut → alanlarını bir kez göster" onPress={p.onTeach} testID="ie-tur-belge-tanit" />}
      </View>
      {p.loading ? (
        <ActivityIndicator style={styles.loading} />
      ) : p.shortcuts.length > 0 ? (
        <>
          <Text style={styles.section}>Özel {TERIM.terbiyeIsEmri.cogulKucuk}</Text>
          <View style={styles.grid} testID="ie-ozel-turler">
            {p.shortcuts.map((r) => (
              <Tile key={r.id} icon={isScanRoute(r) ? 'map-marker-path' : 'lightning-bolt'} title={shortcutTitle(r)} sub={shortcutSub(r)} testID={isScanRoute(r) ? 'ie-rotasiz' : `kisayol-${r.name}`} onPress={() => p.onShortcut(r)} />
            ))}
          </View>
        </>
      ) : null}
    </KeyboardAwareScrollView>
  );
}

function Tile({ icon, title, sub, onPress, testID }: { icon: string; title: string; sub?: string; onPress: () => void; testID?: string }) {
  return (
    <TouchableRipple onPress={onPress} style={styles.tile} accessibilityLabel={title} testID={testID}>
      <View style={styles.tileInner}>
        <Icon source={icon} size={32} color={colors.brand} />
        <Text style={styles.tileTitle}>{title}</Text>
        {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
      </View>
    </TouchableRipple>
  );
}

/** Tek formun ⚙ alan seçicisi başlıkta (gövdede yer kaplamasın); RefreshButton başlık çipi kalıbı. */
function FieldsHeaderChip({ onPress }: { onPress: () => void }) {
  return (
    <TouchableRipple onPress={onPress} style={hdrStyles.chip} borderless rippleColor="rgba(255,255,255,0.2)" accessibilityLabel="Alanlar" testID="ie-alanlar">
      <View style={hdrStyles.chipInner}>
        <Icon source="cog-outline" size={18} color={colors.textOnDark} />
        <Text style={hdrStyles.chipText}>Alanlar</Text>
      </View>
    </TouchableRipple>
  );
}

const hdrStyles = StyleSheet.create({
  chip: { borderRadius: 10, marginLeft: 4, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9 },
  chipText: { color: colors.textOnDark, fontWeight: '700', fontSize: 13 },
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { padding: spacing.lg, gap: spacing.md },
  loading: { marginTop: spacing.xl },
  section: { marginTop: spacing.md, fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  // Telefon (dikey) dar ekranda kutular alt alta, tablette yan yana.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { minWidth: 220, flexGrow: 1, flexBasis: 220, minHeight: 112, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  tileInner: { padding: spacing.lg, gap: spacing.xs },
  tileTitle: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text },
  tileSub: { fontSize: typography.size.sm, color: colors.textSecondary },
  scanBar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  grow: { flexGrow: 1, minWidth: 220 },
  bigBtn: { minHeight: 64 },
  bigLabel: { fontSize: typography.size.lg },
});
