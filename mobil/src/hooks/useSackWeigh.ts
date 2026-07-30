import { useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { useMutation } from '@tanstack/react-query';
import { packingService } from '../services/packing.service';
import { isWorkSessionLost } from '../services/api';
import { useMachinePeripherals, primaryScaleFor } from './useMachinePeripherals';
import { buildIoFromPeripheral } from './usePeripheralIO';
import { isBonded, pairByMac } from '../services/hal/btClassic.transport';

// =============================================================================
// Çuval tartısı — TEK DOKUNUŞ. "Tart" (⚖) tuşuna basılınca kantardan okunur ve
// SONUÇ DOĞRUDAN kaydedilir; modal/input AÇILMAZ. Yanlışsa operatör tekrar basar
// (weighSack üzerine yazar, idempotent).
//
// Eşzamanlılık: kantar tek BT soketi (btClassic `withMacLock` zaten MAC başına
// serileştirir). İkinci dokunuş KUYRUĞA GİRMEZ, sessizce yok sayılır — operatör
// iki çuvalı aynı anda kantarda tutamaz; kuyruk yalnızca "hangi ağırlık hangi
// çuvala gitti" karışıklığı üretirdi.
//
// Fail-closed: kantar tanımsız / eşleşemedi / okunamadı / değer <= 0 →
// NET Türkçe hata + weighSack HİÇ ÇAĞRILMAZ (sessiz sahte değer yok).
// =============================================================================

interface SackWeighTarget {
  id: string;
  /** Toast'ta gösterilecek insan-okur ad (çuval no / "Çuval 3"). */
  label: string;
}

export function useSackWeigh(onSaved: () => void) {
  // Bu telefonun atandığı oturumun (makine/istasyon) SCALE cihaz(lar)ı.
  const scalePeripherals = useMachinePeripherals('SCALE');
  // Hangi çuvalın ikonunda spinner dönecek (null = boşta).
  const [weighingSackId, setWeighingSackId] = useState<string | null>(null);
  // Render'dan bağımsız meşgul bayrağı — hızlı çift dokunuşu state gecikmeden önce yakalar.
  const busyRef = useRef(false);

  /** Kantardan brüt kg oku. Cihaz yoksa/okunamazsa NET Türkçe hata + null. */
  const readFromScale = async (): Promise<number | null> => {
    const p = primaryScaleFor(scalePeripherals);
    if (!p) {
      Toast.show({
        type: 'error',
        text1: 'Kantar tanımlı değil',
        text2: 'Admin → Cihaz Kaydı’ndan bu yere SCALE ekleyin (veya ⋮ → “Elle kg gir”).',
        visibilityTime: 6000,
      });
      return null;
    }
    if (p.simulate) {
      // Simülasyon cihazı: değer UYDURULUR ve artık DOĞRUDAN kaydedilir → operatör
      // gerçek tartı sandığı bir sayıyı irsaliyeye taşımasın diye açıkça uyar.
      const v = Math.round((10 + Math.random() * 90) * 10) / 10;
      Toast.show({
        type: 'info',
        text1: 'SİMÜLASYON tartısı',
        text2: `${v} kg gerçek ölçüm DEĞİL — cihaz kaydında “simulate” açık.`,
        visibilityTime: 6000,
      });
      return v;
    }
    const io = buildIoFromPeripheral(p);
    if (!io.supported || !io.transport || !io.codec) {
      Toast.show({
        type: 'error',
        text1: 'Kantar okunamıyor',
        text2: 'Bu derlemede/bağlantı türünde desteklenmiyor (native build / connectionType).',
        visibilityTime: 6000,
      });
      return null;
    }
    if (p.connectionType === 'BLUETOOTH_SPP' && p.address) {
      try {
        if (!(await isBonded(p.address))) {
          Toast.show({
            type: 'info',
            text1: 'Kantar ilk kez eşleştiriliyor',
            text2: 'PIN sorulursa girin (ör. 1234) — sonraki tartılarda otomatik bağlanır.',
            visibilityTime: 8000,
          });
          await pairByMac(p.address);
        }
      } catch (e) {
        Toast.show({
          type: 'error',
          text1: 'Kantar eşleştirilemedi',
          text2: e instanceof Error ? e.message : 'Kantar açık ve menzilde mi? PIN girildi mi?',
          visibilityTime: 6000,
        });
        return null;
      }
    }
    try {
      const raw = await io.transport.read({
        readMode: p.readMode,
        pollCommand: p.pollCommand ?? undefined,
        terminator: p.terminator ?? undefined,
        timeoutMs: p.timeoutMs ?? undefined,
        framePattern: p.identifyPattern ?? undefined,
      });
      const v = io.codec.decode(raw);
      if (v != null && v > 0) return v;
      throw new Error('Geçerli tartı gelmedi');
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Kantar okunamadı',
        text2: e instanceof Error ? e.message : 'Kantar kapalı/menzil dışı veya komut yanlış olabilir',
        visibilityTime: 6000,
      });
      return null;
    }
  };

  const saveMut = useMutation({
    mutationFn: ({ sackId, kg }: { sackId: string; kg: number }) =>
      packingService.weighSack(sackId, { weightKg: kg }),
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return;
      // 409 = çuval bu sırada bir sevkiyata atandı (touchWarehouseSackTx guard'ı).
      Toast.show({ type: 'error', text1: 'Tartı kaydedilemedi', text2: e.message });
    },
  });

  /** ⚖ tek dokunuş: oku → doğrudan kaydet → listeyi tazele. */
  const weigh = async (sack: SackWeighTarget): Promise<void> => {
    if (busyRef.current) return; // kantar meşgul — sessizce yok say
    busyRef.current = true;
    setWeighingSackId(sack.id);
    try {
      const kg = await readFromScale();
      if (kg == null) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return; // hata toast'ı readFromScale içinde verildi; DB'ye HİÇ gitmedik
      }
      await saveMut.mutateAsync({ sackId: sack.id, kg });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: `${kg.toLocaleString('tr-TR')} kg`, text2: sack.label });
      onSaved();
    } catch {
      // saveMut.onError toast'ladı; burada yutuyoruz (mutateAsync reject eder).
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      busyRef.current = false;
      setWeighingSackId(null);
    }
  };

  /** ⋮ → "Elle kg gir" yolu — kantarsız/arızalı durum için. */
  const saveManual = async (sack: SackWeighTarget, kg: number): Promise<boolean> => {
    try {
      await saveMut.mutateAsync({ sackId: sack.id, kg });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: `${kg.toLocaleString('tr-TR')} kg (elle)`, text2: sack.label });
      onSaved();
      return true;
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return false;
    }
  };

  return {
    /** Hangi çuval tartılıyor (ikon spinner'ı) — null = boşta. */
    weighingSackId,
    /** Kantar/kayıt işi sürüyor mu (tüm ⚖ tuşlarını pasifleştirmek için). */
    busy: weighingSackId !== null || saveMut.isPending,
    weigh,
    saveManual,
    /** Kantar tanımlı mı — UI ipucu için (yoksa ⋮ → elle gir tek yol). */
    hasScale: primaryScaleFor(scalePeripherals) != null,
  };
}
