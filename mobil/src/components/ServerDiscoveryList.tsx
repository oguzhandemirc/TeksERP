import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { ActivityIndicator, Button, Icon } from 'react-native-paper';
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
  disabled?: boolean;
}

export function ServerDiscoveryList({
  currentUrl,
  recentUrls,
  onPick,
  disabled,
}: ServerDiscoveryListProps) {
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<{ tried: number; total: number } | null>(null);
  const [found, setFound] = useState<DiscoveredServer[] | null>(null);

  const search = useCallback(async () => {
    setSearching(true);
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
      setFound(res.candidates);
    } catch {
      setFound([]);
    } finally {
      setSearching(false);
      setProgress(null);
    }
  }, [currentUrl, recentUrls]);

  return (
    <View style={styles.block}>
      <Button
        mode="outlined"
        onPress={() => void search()}
        disabled={disabled || searching}
        icon="radar"
        textColor={COLORS.accentLight}
        style={styles.searchBtn}
      >
        {searching
          ? progress
            ? `Aranıyor… ${progress.tried}/${progress.total}`
            : 'Aranıyor…'
          : 'Sunucuyu Ara'}
      </Button>

      {searching && (
        <View style={styles.row}>
          <ActivityIndicator size={16} color={COLORS.accentLight} />
          <Text style={styles.hint}>Ağdaki sunucular taranıyor…</Text>
        </View>
      )}

      {!searching && found?.length === 0 && (
        <Text style={styles.hint}>
          Ağda sunucu bulunamadı. Sunucu kapalı olabilir ya da tablet farklı bir ağda olabilir.
        </Text>
      )}

      {found?.map((c) => {
        const mismatch = c.matchesPinned === 'mismatch';
        return (
          <Pressable
            key={`${c.host}:${c.port}`}
            onPress={() => onPick(c)}
            style={[styles.item, mismatch && styles.itemMuted]}
          >
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
              {!c.identity && <Text style={styles.itemWarn}>kimlik bilgisi yok (eski sürüm olabilir)</Text>}
              {mismatch && <Text style={styles.itemDanger}>farklı kurulum — dikkat</Text>}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  searchBtn: { borderColor: COLORS.accentLight },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hint: { color: COLORS.subtext, fontSize: 12, flexShrink: 1 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  itemMuted: { opacity: 0.6 },
  itemText: { flex: 1, minWidth: 0 },
  itemTitle: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  itemSub: { color: COLORS.subtext, fontSize: 12 },
  itemWarn: { color: COLORS.subtext, fontSize: 11, marginTop: 2 },
  itemDanger: { color: COLORS.error, fontSize: 11, marginTop: 2, fontWeight: '600' },
});
