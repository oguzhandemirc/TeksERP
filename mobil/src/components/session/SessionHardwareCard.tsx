// =============================================================================
// Ayarlar → "Bu Yerin Donanımı" — SALT-OKUNUR teşhis kartı
// =============================================================================
// Manuel cihaz seçimi YOK (eski BtPrinter/BtMeter/BtScale kartlarının yerini
// alır): donanım, aktif çalışma oturumunun YERİNE (makine/istasyon) bağlıdır ve
// backend'den çözülür (for-session). Bu kart yalnız teşhis içindir — operatör
// arıza anında "kabloyu mu kontrol edeyim, ustabaşını mı çağırayım" sorusuna
// cevap bulur: bağlı/bond durumu, simülasyon rozeti, tek dokunuş eşleştirme
// (bond — seçim değil) ve giriş cihazları için "Oku" testi.
//
// "Yenile" (2026-07-30): admin panelden bu yere YENİ cihaz atandığında kart eski
// listeyi gösteriyordu (staleTime 60s). Artık sayfaya her girişte tazelenir
// (refetchOnMount) ve başlıkta manuel yenile var — oturumu, cihaz listesini,
// diğer for-session tüketicilerinin cache'ini ve BT bond durumunu birlikte
// yeniler.
//
// Kendi kart çerçevesini taşır ama BAŞLIĞI YOK: tek tüketicisi
// `settings/PlaceHardwareScreen` ve sayfa başlığı zaten "Bu Yerin Donanımı".
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { peripheralService, type DevicePeripheral } from '../../services/peripheral.service';
import { isBtSupported, isBonded, listBonded, pairByMac, resetConnection } from '../../services/hal/btClassic.transport';
import { unstickPrinter } from '../../services/btPrinter.service';
import { buildIoFromPeripheral } from '../../hooks/usePeripheralIO';
import { useSessionStore } from '../../store/sessionStore';
import { useManualRefresh } from '../../hooks/useManualRefresh';
import RefreshButton from '../RefreshButton';
import HardwareScanModal from './HardwareScanModal';

const C = {
  bgSoft: '#1e293b',
  bgDarker: '#0a1120',
  accentLight: '#6366f1',
  text: '#f1f5f9',
  subtext: '#94a3b8',
  border: '#334155',
  success: '#22c55e',
  warn: '#f59e0b',
  scan: '#0ea5e9',
};

const KIND_LABEL: Record<string, string> = {
  LABEL_PRINTER: 'Etiket Yazıcı',
  SCALE: 'Kantar',
  METER: 'Metre',
  SIGNAL_SOURCE: 'Sinyal',
};
const KIND_ICON: Record<string, string> = {
  LABEL_PRINTER: 'printer',
  SCALE: 'scale',
  METER: 'ruler',
  SIGNAL_SOURCE: 'access-point',
};

export default function SessionHardwareCard() {
  const active = useSessionStore((s) => s.active);
  const initSession = useSessionStore((s) => s.init);
  const btOk = isBtSupported();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['peripherals', 'for-session', 'ALL', active?.id ?? null],
    // Tek çağrı (kind filtresiz): backend oturumun makine/istasyonundaki TÜM cihazları döner.
    queryFn: () => peripheralService.getForSessionAll(),
    staleTime: 60 * 1000,
    // Teşhis ekranı: açılışta HER ZAMAN sunucudan sor. staleTime yalnız arka plan
    // gürültüsünü kısar; operatör bu sayfayı "şu an ne atanmış?" diye açar.
    refetchOnMount: 'always',
    enabled: active != null,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const [bonded, setBonded] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scanTarget, setScanTarget] = useState<DevicePeripheral | null>(null);

  const refreshBonded = useCallback(async () => {
    if (!btOk || rows.length === 0) return;
    try {
      const list = await listBonded();
      const set = new Set(list.map((d) => d.address.trim().toUpperCase()));
      const map: Record<string, boolean> = {};
      for (const r of rows) if (r.address) map[r.id] = set.has(r.address.trim().toUpperCase());
      setBonded(map);
    } catch {
      // izin/adaptör yoksa sessiz — "Eşleştir"e basınca net hata gelir.
    }
  }, [btOk, rows]);

  useEffect(() => {
    void refreshBonded();
  }, [refreshBonded]);

  // Manuel yenile — dört işi birlikte yapar, hepsi GERÇEKTEN ağa/adaptöre gider:
  //  1. oturumu yeniden çöz (cihazın makine/istasyon ataması değişmiş olabilir —
  //     `active.id` değişirse aşağıdaki query zaten yeni anahtarla taze başlar),
  //  2. bu ekranın cihaz listesini refetch et (staleTime'ı atlar),
  //  3. diğer for-session tüketicilerini (istasyon ekranlarındaki
  //     useMachinePeripherals) invalidate et — operatör istasyona dönünce yeni
  //     metre/kantar orada da görünsün,
  //  4. BT bond durumunu adaptörden yeniden oku.
  // Offline guard / zaman aşımı / haptic / toast useManualRefresh'te.
  const refresh = useManualRefresh(
    [
      () => initSession(),
      () => q.refetch(),
      () => qc.invalidateQueries({ queryKey: ['peripherals', 'for-session'] }),
      () => refreshBonded(),
    ],
    'Donanım listesi güncellendi',
  );

  /**
   * BAĞLANTIYI SIFIRLA — bayat/yarı-açık RFCOMM soketini temizler (2026-08-17).
   *
   * Saha vakası (Tambur): "yazıcıyla bağlantı ara ara kopuyor, yazıcıyı kapatıp
   * açınca düzeliyor". HC-06 köprüsü tek bağlantı kabul eder; tablet tarafı
   * düştüğünde köprü hâlâ "bağlıyım" sanabiliyor. Bu düğme operatörün yazıcıya
   * kadar yürümeden deneyebileceği çıkış yolu.
   *
   * ⚠️ Mesaj DÜRÜST: başarıda bile "kesin düzeldi" DENMEZ — köprü, Android'in
   * haberi olmayan bir hayalet bağlantıda takılıysa tabletten çözülemez ve tek
   * çare yazıcının elektriğini kesmektir. Başarısızlıkta bunu açıkça söyler.
   */
  const resetLink = async (r: DevicePeripheral) => {
    if (!r.address) return;
    setBusyId(r.id);
    try {
      await resetConnection(r.address);
      // İKİ FARKLI ARIZA, TEK DOKUNUŞ: (1) bayat RFCOMM soketi — yukarıdaki
      // resetConnection çözer; (2) yazıcının KOMUT AYRIŞTIRICISI takılı — yalnız
      // aşağıdaki dizi çözebilir. Operatörden ikisini ayırt etmesini beklemek
      // gerçekçi değil, bu yüzden ikisi birden denenir.
      await unstickPrinter(r.address).catch(() => {
        // Yazıcı diziyi de yutmuş olabilir — bağlantı yenilendiği için bunu
        // BAŞARISIZLIK saymayız; alttaki mesaj zaten "çıkmazsa kapat-aç" diyor.
      });
      Toast.show({
        type: 'success',
        text1: 'Bağlantı yenilendi',
        text2: 'Etiketi tekrar basın. Yine çıkmazsa yazıcıyı kapatıp açın.',
        visibilityTime: 6000,
      });
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Bağlantı kurulamadı',
        text2:
          (e instanceof Error ? `${e.message} — ` : '') +
          'Yazıcıyı kapatıp açın, sonra tekrar deneyin.',
        visibilityTime: 8000,
      });
    } finally {
      setBusyId(null);
    }
  };

  const pair = async (r: DevicePeripheral) => {
    if (!r.address) return;
    setBusyId(r.id);
    try {
      const already = await isBonded(r.address);
      await pairByMac(r.address);
      Toast.show({
        type: 'success',
        text1: already ? 'Cihaz zaten eşleşik' : 'Cihaz eşleşti',
        text2: 'Artık otomatik bağlanır — PIN bir daha sorulmaz.',
      });
      await refreshBonded();
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Eşleştirilemedi',
        text2: e instanceof Error ? e.message : 'Cihaz açık ve menzilde mi? PIN girildi mi?',
        visibilityTime: 6000,
      });
    } finally {
      setBusyId(null);
    }
  };

  // Giriş cihazı (METER/SCALE) teşhis okuması — değer gelirse kablo/protokol sağlam.
  const testRead = async (r: DevicePeripheral) => {
    setBusyId(r.id);
    try {
      if (r.simulate) {
        Toast.show({ type: 'info', text1: 'Simülasyon modunda', text2: 'Gerçek okuma yapılmaz (Cihaz Kaydı → simulate).' });
        return;
      }
      const io = buildIoFromPeripheral(r);
      if (!io.supported || !io.transport || !io.codec) {
        throw new Error('Bu derleme/bağlantı türü okuma desteklemiyor (native build gerekli olabilir).');
      }
      const raw = await io.transport.read({
        readMode: r.readMode,
        pollCommand: r.pollCommand ?? undefined,
        terminator: r.terminator ?? undefined,
        timeoutMs: r.timeoutMs ?? undefined,
        framePattern: r.identifyPattern ?? undefined,
      });
      const value = io.codec.decode(raw);
      Toast.show({
        type: 'success',
        // `unit` kolonu düştü (süs alandı; çarpan `scale`): toast yalnız değeri basar.
        text1: `Okuma başarılı: ${value}`,
        text2: r.name,
      });
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Okuma başarısız',
        text2: e instanceof Error ? e.message : 'Cihaz açık ve menzilde mi?',
        visibilityTime: 6000,
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.card}>
      {/* Başlık sayfa Appbar'ında; burada yer bilgisi + "Yenile". */}
      <View style={styles.headRow}>
        <View style={styles.iconBox}>
          <Icon source="connection" size={28} color={C.accentLight} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>
            {active
              ? `${active.station.name}${active.machine ? ` — ${active.machine.name}` : ''}`
              : 'Yer belirsiz'}
          </Text>
          <Text style={styles.subtitle}>
            {active
              ? "Cihaz seçimi yok — donanım yerin özelliğidir; değişiklik Admin → Donanım'dan."
              : 'Aktif çalışma oturumu yok — donanım, istasyon ekranında yer onayı verilince görünür.'}
          </Text>
        </View>
        <RefreshButton
          onPress={refresh.onRefresh}
          refreshing={refresh.refreshing}
          isError={refresh.isError}
          errorMessage={refresh.errorMessage}
          successMessage={refresh.successMessage}
          headerStyle
          label="Yenile"
          containerStyle={styles.refreshChip}
        />
      </View>

      {!btOk && active != null && (
        <Text style={[styles.muted, { color: C.warn }]}>
          Bu derlemede Bluetooth yok — eşleştirme/okuma için native build gerekli
          (npx expo run:android).
        </Text>
      )}

      {active == null ? null : q.isLoading ? (
        <View style={styles.centerRow}>
          <ActivityIndicator size="small" color={C.accentLight} />
          <Text style={styles.muted}>Yükleniyor…</Text>
        </View>
      ) : rows.length === 0 ? (
        <Text style={styles.muted}>
          Bu yere tanımlı donanım yok. Admin → Donanım'dan makineye/istasyona cihaz bağlayın.
        </Text>
      ) : (
        rows.map((r) => {
          const isSpp = r.connectionType === 'BLUETOOTH_SPP' && !!r.address;
          const isBonded_ = bonded[r.id] === true;
          const isInput = r.kind === 'METER' || r.kind === 'SCALE';
          return (
            <View key={r.id} style={styles.row}>
              <Icon
                source={r.simulate ? 'flask' : (KIND_ICON[r.kind] ?? 'devices')}
                size={20}
                color={r.simulate ? C.warn : isBonded_ ? C.success : C.subtext}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>
                  {KIND_LABEL[r.kind] ?? r.kind}
                  {r.role ? ` · ${r.role}` : ''} — {r.name}
                </Text>
                <Text style={styles.rowAddr}>
                  {r.address ?? '—'}
                  {r.simulate ? '  (simülasyon)' : isSpp ? (isBonded_ ? '  · eşleşik' : '  · eşleşmemiş') : ''}
                </Text>
              </View>
              {btOk && r.connectionType === 'BLUETOOTH_SPP' && (
                <Button
                  mode="contained"
                  compact
                  icon="magnify"
                  disabled={busyId != null}
                  buttonColor={C.scan}
                  onPress={() => setScanTarget(r)}
                >
                  {r.address ? 'Yeniden Tara' : 'Tara & Bağla'}
                </Button>
              )}
              {isSpp && btOk && !r.simulate && !isBonded_ && (
                <Button
                  mode="contained"
                  compact
                  icon="bluetooth-settings"
                  loading={busyId === r.id}
                  disabled={busyId != null}
                  buttonColor={C.accentLight}
                  onPress={() => void pair(r)}
                >
                  Eşleştir
                </Button>
              )}
              {/* "Sıfırla" yalnız EŞLEŞİK ÇIKIŞ cihazında (yazıcı): bağlanmamış
                  cihazda sıfırlanacak bir soket yok, giriş cihazında (metre/kantar)
                  zaten "Oku" var ve satırda üçüncü aksiyona yer kalmaz. Bonded
                  yazıcıda "Eşleştir" gizli olduğu için burası boştadır. */}
              {isSpp && btOk && !r.simulate && isBonded_ && !isInput && (
                <Button
                  mode="text"
                  compact
                  icon="restart"
                  loading={busyId === r.id}
                  disabled={busyId != null}
                  textColor={C.accentLight}
                  onPress={() => void resetLink(r)}
                >
                  Sıfırla
                </Button>
              )}
              {/* "Oku" yalnız bond edilmiş girişte — bağlı olmayan cihaz zaten okunamaz.
                  Böylece satırda en fazla 2 aksiyon kalır (taşma/sıkışma önlenir). */}
              {isInput && isBonded_ && (
                <Button
                  mode="text"
                  compact
                  icon="play-circle-outline"
                  loading={busyId === r.id}
                  disabled={busyId != null}
                  textColor={C.accentLight}
                  onPress={() => void testRead(r)}
                >
                  Oku
                </Button>
              )}
            </View>
          );
        })
      )}

      <HardwareScanModal
        visible={scanTarget != null}
        target={scanTarget}
        onDismiss={() => setScanTarget(null)}
        onAssigned={() => {
          void qc.invalidateQueries({ queryKey: ['peripherals', 'for-session'] });
          void refreshBonded();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.bgSoft, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.border },
  headRow: { flexDirection: 'row', gap: 14, marginBottom: 14 },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 13,
    backgroundColor: C.bgDarker,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headText: { flex: 1, justifyContent: 'center' },
  title: { color: C.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: C.subtext, fontSize: 13, marginTop: 4, lineHeight: 18 },
  // Eldivenli parmakla basılabilsin — chip'in kendi iç dolgusu ~36dp'de kalıyor.
  refreshChip: { minHeight: 48, justifyContent: 'center', alignSelf: 'center' },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  muted: { color: C.subtext, fontSize: 13, paddingVertical: 4, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: C.bgDarker,
    borderWidth: 1,
    borderColor: C.border,
  },
  rowName: { color: C.text, fontSize: 14, fontWeight: '700' },
  rowAddr: { color: C.subtext, fontSize: 12, marginTop: 2, fontFamily: 'monospace' },
});
