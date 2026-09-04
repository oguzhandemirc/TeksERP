import { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ActivityIndicator, Icon, ProgressBar, TouchableRipple } from 'react-native-paper';
import { useBusyAction } from '../hooks/useBusyAction';
import { SettingsActionButton } from '../screens/Common/settings/settingsUi';
import { discoverServers } from '../services/discovery.service';
import { getPinnedInstallationId } from '../store/baseUrlStore';
import type { DiscoveredServer } from '../lib/discovery';

// Palet YEREL — bu projede ortak bir tema modülü yok, her ekran kendi COLORS
// sabitini taşıyor (`ServerAddressSheet` ile birebir aynı değerler).
const COLORS = {
  accent: '#4f46e5',
  accentLight: '#6366f1',
  text: '#f1f5f9',
  subtext: '#94a3b8',
  border: '#334155',
  error: '#ef4444',
  bgDarker: '#0a1120',
};

/**
 * "Sunucuyu Ara" düğmesi + bulunan sunucu listesi.
 *
 * ⚠️ ORTAK BİLEŞEN, BİLİNÇLİ: adres girme ekranı bu projede İKİ KEZ var —
 * kilit ekranındaki `ServerAddressSheet` ve Ayarlar'daki `ServerSettingsScreen`
 * neredeyse birebir kopya. Keşif yalnız birine eklenseydi, asıl mağdur olan
 * (kilit ekranında kalmış, sunucuya ulaşamayan operatör) ona erişemezdi.
 * Yeni bir yetenek eklerken de tek yerde eklensin diye ayrı bileşen.
 *
 * ⚠️ Satırın en büyük yazısı FİRMA ADI, IP değil: ağda ikinci bir TeksERP
 * çıkmasının en olası sebebi saldırgan değil, unutulmuş bir demo kurulumudur ve
 * operatörden "hangisi bizimki"yi IP'ye bakarak bilmesi beklenemez.
 */
export interface ServerDiscoveryListProps {
  /** Şu an forma yazılı adres — öncelikli denenir. */
  currentUrl?: string;
  /** Daha önce kullanılmış adresler — öncelikli denenir. */
  recentUrls?: string[];
  /** Aday seçildiğinde form alanları doldurulsun. */
  onPick: (server: DiscoveredServer) => void;
  /**
   * Tarama bitince kaç aday bulundu — bildirimi ÇAĞIRAN basar (opsiyonel).
   *
   * ⚠️ Toast burada BASILMAZ: bu bileşen kilit ekranında da kullanılıyor ve
   * orada kilit katmanı Toast'ın ÜSTÜNDE çizilir (App.tsx yerleşimi), yani
   * bildirim operatöre hiç görünmez. Bildirimi görebilecek olan ekran bilir.
   */
  onResult?: (bulunan: DiscoveredServer[]) => void;
  disabled?: boolean;
}

export function ServerDiscoveryList({
  currentUrl,
  recentUrls,
  onPick,
  onResult,
  disabled,
}: ServerDiscoveryListProps) {
  const [progress, setProgress] = useState<{ tried: number; total: number } | null>(null);
  const [found, setFound] = useState<DiscoveredServer[] | null>(null);

  const search = useCallback(async (): Promise<DiscoveredServer[]> => {
    setFound(null);
    setProgress(null);
    try {
      const pinned = await getPinnedInstallationId();
      const res = await discoverServers({
        pinnedInstallationId: pinned,
        preferredUrls: [currentUrl, ...(recentUrls ?? [])].filter(
          (u): u is string => typeof u === 'string' && u.length > 0,
        ),
        // Kullanıcı AÇIKÇA "ara" dedi → tam süpürme meşru.
        fullSweep: true,
        onProgress: setProgress,
      });
      return res.candidates;
    } catch {
      return [];
    }
  }, [currentUrl, recentUrls]);

  // Tarama zaten saniyeler sürer; asgari süre burada "bir kare parlayıp sönme"
  // ihtimalini kapatır (ağda tek aday varsa cevap çok hızlı gelebiliyor).
  const { busy: searching, tetikle: startSearch } = useBusyAction(search, {
    bitince: (adaylar) => {
      setFound(adaylar);
      setProgress(null);
      onResult?.(adaylar);
    },
  });

  return (
    <View style={styles.block}>
      {/* ⚠️ İLERLEME DÜĞMENİN ÜSTÜNDE (2026-09-04, kullanıcı isteği): eskiden
          altındaydı ve tarama sırasında liste büyüdükçe satır aşağı kayıp
          ekran dışında kalıyordu — operatör "bir şey olmuyor" diyordu. */}
      {searching && (
        <View style={styles.progressBox}>
          <View style={styles.row}>
            <ActivityIndicator size={16} color={COLORS.accentLight} />
            <Text style={styles.progressText}>
              {progress
                ? `Ağ taranıyor… ${progress.tried}/${progress.total} adres`
                : 'Ağ taranıyor…'}
            </Text>
          </View>
          <ProgressBar
            indeterminate={!progress}
            progress={progress && progress.total > 0 ? progress.tried / progress.total : 0}
            color={COLORS.accentLight}
            style={styles.progressBar}
          />
        </View>
      )}

      <SettingsActionButton
        testID="sunucu-ara"
        tone="action"
        icon="radar"
        label="Ağda Ara"
        busyLabel="Aranıyor…"
        busy={searching}
        disabled={disabled}
        onPress={startSearch}
      />

      {!searching && found?.length === 0 && (
        <View style={styles.emptyBox}>
          <Icon source="lan-disconnect" size={18} color={COLORS.subtext} />
          <Text style={styles.hint}>
            Ağda sunucu bulunamadı. Tablet fabrika Wi-Fi&apos;sinde mi, sunucu açık mı?
            Adresi biliyorsanız elle yazıp &quot;Bağlantıyı Test Et&quot; deyin.
          </Text>
        </View>
      )}

      {!searching && found && found.length > 0 && (
        <Text style={styles.foundLabel}>
          {found.length} sunucu bulundu — dokunarak seçin
        </Text>
      )}

      {found?.map((c) => {
        const mismatch = c.matchesPinned === 'mismatch';
        return (
          <TouchableRipple
            key={`${c.host}:${c.port}`}
            onPress={() => onPick(c)}
            rippleColor="rgba(99,102,241,0.2)"
            style={[styles.item, mismatch && styles.itemMuted]}
          >
            <View style={styles.itemInner}>
              <Icon source="server" size={20} color={COLORS.accentLight} />
              <View style={styles.itemText}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {c.identity?.companyName || c.identity?.serverName || c.host}
                </Text>
                <Text style={styles.itemSub} numberOfLines={1}>
                  {c.identity?.serverName ? `${c.identity.serverName} · ` : ''}
                  {c.host}:{c.port}
                  {c.identity?.version ? ` · v${c.identity.version}` : ''}
                  {` · ${c.rttMs} ms`}
                </Text>
                {/* Kimliğin YOKLUĞU uyuşmazlık değildir — eski sürüm olabilir. */}
                {!c.identity && (
                  <Text style={styles.itemWarn}>kimlik bilgisi yok (eski sürüm olabilir)</Text>
                )}
                {mismatch && <Text style={styles.itemDanger}>farklı kurulum — dikkat</Text>}
              </View>
              <Icon source="chevron-right" size={22} color={COLORS.subtext} />
            </View>
          </TouchableRipple>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hint: { color: COLORS.subtext, fontSize: 12, flexShrink: 1, lineHeight: 17 },
  progressBox: {
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgDarker,
  },
  progressText: { color: COLORS.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  progressBar: { height: 4, borderRadius: 2, backgroundColor: COLORS.border },
  emptyBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  foundLabel: { color: COLORS.subtext, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  item: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  itemInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 56,
  },
  itemMuted: { opacity: 0.6 },
  itemText: { flex: 1, minWidth: 0 },
  itemTitle: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  itemSub: { color: COLORS.subtext, fontSize: 12 },
  itemWarn: { color: COLORS.subtext, fontSize: 11, marginTop: 2 },
  itemDanger: { color: COLORS.error, fontSize: 11, marginTop: 2, fontWeight: '600' },
});
