// "Terbiye İş Emri oluştur" (Gülkesim K6) — menüde Belge Tara'nın yerine; panel seçicisinin aynası. 1. satır sabit türler
// (tablette yalnız Hızlı Terbiye İş Emri), 2. satır "Özel iş emirleri" kısayolları. Kısayol → doğrudan form (rota hazır)
// + üstte "Belge okut". Kısayol yoksa 2. satır görünmez ve bugünkü Belge Tara yolu 1. satırda kalır.
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import ScreenChrome from '../../../../components/ScreenChrome';
import { useVisibleScreens } from '../../../../hooks/useVisibleScreens';
import { TERIM } from '../../../../lib/terim';
import { routeService, type ProductionRoute } from '../../../../services/route.service';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';
import { colors, radius, spacing, typography } from '../../../../theme';
import NewWorkOrderView from '../../HizliIsEmri/NewWorkOrderView';
import { DocScanBody } from '../DocScanScreen';
import DeskView from '../desk/DeskView';
import DocBatchView from './DocBatchView';
import { useScanRouteMode } from '../../../../hooks/useFeatureFlags';
import { isScanRoute, shortcutRoutes, shortcutSub, shortcutTitle, withScanRoute } from './woFromDoc';

type Stage =
  | { kind: 'hub' }
  /** Hızlı İE formu; `route` = kısayoldan açıldıysa ön seçili rota. */
  | { kind: 'form'; route: ProductionRoute | null }
  | { kind: 'scan'; route: ProductionRoute; multi: boolean }
  | { kind: 'legacy' }
  /** K23 belge masası: kamera ↔ tek inceleme (hazır İE kısayolları gerekir). */
  | { kind: 'desk' };

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
  const [step, setStep] = useState(0);
  const [hasResult, setHasResult] = useState(false);
  const canManual = useVisibleScreens().visibleScreens.some((s) => s.key === 'HizliIsEmri');
  const q = useQuery({ queryKey: WO_SHORTCUTS_KEY, queryFn: routeService.getShortcuts, retry: false, staleTime: 60_000 });
  // K29 S14b: "Okutmayla" kipinde rotasız seçenek kısayolların BAŞINDA (varsayılan); sıralıda bugünkü liste.
  const shortcuts = withScanRoute(shortcutRoutes(q.data?.data ?? []), useScanRouteMode());
  useDeskAutoOpen(shortcuts.length > 0, () => setStage({ kind: 'desk' }));

  const openForm = (route: ProductionRoute | null) => {
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

  const route = stage.kind === 'form' || stage.kind === 'scan' ? stage.route : null;
  const title = stage.kind === 'legacy' ? 'Belge Tara' : stage.kind === 'desk' ? DESK : route ? shortcutTitle(route) : stage.kind === 'form' ? quick_() : title_();

  return (
    <ScreenChrome title={title} onStepBack={stage.kind === 'hub' ? undefined : back}>
      {stage.kind === 'hub' && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.grid} testID="ie-sabit-turler">
            {canManual && <Tile icon="rocket-launch-outline" title={quick_()} sub="Topu okutup başlat" onPress={() => openForm(null)} testID="ie-tur-hizli" />}
            {shortcuts.length > 0 && (
              <Tile icon="table-furniture" title={DESK} sub="Kamera açık bekler; okut → kontrol et → oluştur" onPress={() => setStage({ kind: 'desk' })} testID="ie-tur-belge-masasi" />
            )}
            {!q.isLoading && shortcuts.length === 0 && (
              <Tile icon="file-document-outline" title="Belge Tara" sub="Müşteri irsaliyesi → taslak" onPress={() => setStage({ kind: 'legacy' })} testID="ie-tur-belge-tara" />
            )}
          </View>
          {q.isLoading ? (
            <ActivityIndicator style={styles.loading} />
          ) : shortcuts.length > 0 ? (
            <>
              <Text style={styles.section}>Özel {TERIM.terbiyeIsEmri.cogulKucuk}</Text>
              <View style={styles.grid} testID="ie-ozel-turler">
                {shortcuts.map((r) => (
                  <Tile key={r.id} icon={isScanRoute(r) ? 'map-marker-path' : 'lightning-bolt'} title={shortcutTitle(r)} sub={shortcutSub(r)} testID={isScanRoute(r) ? 'ie-rotasiz' : `kisayol-${r.name}`} onPress={() => openForm(r)} />
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      )}
      {stage.kind === 'form' && (
        <View style={styles.fill}>
          {stage.route && (
            <View style={styles.scanBar}>
              <Button mode="contained" icon="file-document-outline" onPress={() => setStage({ kind: 'scan', route: stage.route!, multi: false })} contentStyle={styles.bigBtn} labelStyle={styles.bigLabel} style={styles.grow} testID="ie-belge-okut">
                Belge okut
              </Button>
              <Button mode="outlined" icon="file-multiple-outline" onPress={() => setStage({ kind: 'scan', route: stage.route!, multi: true })} contentStyle={styles.bigBtn} testID="ie-birden-cok-belge">
                Birden çok belge
              </Button>
            </View>
          )}
          {stage.route && isScanRoute(stage.route) ? (
            <Text style={[styles.hint, styles.body]} testID="ie-rotasiz-ipucu">Rotasız {TERIM.terbiyeIsEmri.tekilKucuk} yalnız belge okutularak açılır; adımlar istasyonda okutuldukça eklenir.</Text>
          ) : canManual ? (
            <NewWorkOrderView step={step} onStepChange={setStep} onResultChange={setHasResult} initialRouteTemplateId={stage.route?.id ?? null} />
          ) : (
            <Text style={[styles.hint, styles.body]}>Elle giriş için {quick_()} yetkisi gerekir; belgeyi okutarak devam edin.</Text>
          )}
        </View>
      )}
      {stage.kind === 'scan' && <DocBatchView route={stage.route} multi={stage.multi} autoStart />}
      {stage.kind === 'legacy' && <DocScanBody />}
      {stage.kind === 'desk' && <DeskView shortcuts={shortcuts} />}
    </ScreenChrome>
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
