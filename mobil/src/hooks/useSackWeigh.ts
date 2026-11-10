import { useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { useMutation } from '@tanstack/react-query';
import { packingService } from '../services/packing.service';
import { isWorkSessionLost } from '../services/api';
import { isLicenseNotified } from '../lib/license';
import { useMachinePeripherals, primaryScaleFor } from './useMachinePeripherals';
import { readScaleOnce } from '../services/hal/readScale';

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

/**
 * Tartının kaynağı — backend'e BEYAN edilir (`weighSack.source`). Backend
 * `shipping.simulatedWeightEnabled` kapalıyken (default) SIMULATED'ı 400 ile
 * reddeder; MANUAL muaftır (kantarsız/arızalı kaçış yolu). Çuval kg'si sevk
 * irsaliyesine ve çeki listesine basıldığı için uydurma değer kabul edilmez.
 */
export type WeighSource = 'SCALE' | 'MANUAL' | 'SIMULATED';

export function useSackWeigh(onSaved: () => void) {
  // Bu telefonun atandığı oturumun (makine/istasyon) SCALE cihaz(lar)ı.
  const scalePeripherals = useMachinePeripherals('SCALE');
  // Hangi çuvalın ikonunda spinner dönecek (null = boşta).
  const [weighingSackId, setWeighingSackId] = useState<string | null>(null);
  // Render'dan bağımsız meşgul bayrağı — hızlı çift dokunuşu state gecikmeden önce yakalar.
  const busyRef = useRef(false);

  /**
   * Kantardan brüt kg oku. Cihaz yoksa/okunamazsa NET Türkçe hata + null.
   * `source` de döner: simüle cihazın ürettiği değer backend'e SIMULATED olarak
   * beyan edilir ve (bayrak kapalıysa) 400 ile reddedilir — istemci sahte değeri
   * "gerçek ölçüm" gibi göndermez.
   */
  const readFromScale = async (): Promise<{ kg: number; source: WeighSource } | null> => {
    const read = await readScaleOnce(primaryScaleFor(scalePeripherals), {
      onPairing: (m) => Toast.show({ type: 'info', text1: m.title, text2: m.detail, visibilityTime: 8000 }),
    });
    if (!read.ok) {
      Toast.show({ type: 'error', text1: read.error.title, text2: read.error.detail, visibilityTime: 6000 });
      return null;
    }
    if (read.notice) Toast.show({ type: 'info', text1: read.notice.title, text2: read.notice.detail, visibilityTime: 6000 });
    return { kg: read.kg, source: read.source };
  };

  const saveMut = useMutation({
    // `source`: tartının KAYNAĞI — backend simüle kantar korumasının girdisi
    // (`shipping.simulatedWeightEnabled` kapalıyken SIMULATED 400 döner). MANUAL
    // muaftır. Mobilde backend ayrıca oturumun kantarını kendi çözüp çapraz kontrol
    // eder → SCALE beyanı tek başına yeterli/güvenilir sinyal değildir, olması da
    // gerekmiyor.
    mutationFn: ({ sackId, kg, source }: { sackId: string; kg: number; source: WeighSource }) =>
      packingService.weighSack(sackId, { weightKg: kg, source }),
    onError: (e: Error) => {
      // Lisans reddini interceptor zaten söyledi (bkz. `lib/screenToast`).
      if (isWorkSessionLost(e) || isLicenseNotified(e)) return;
      // 409 = çuval bu sırada bir sevkiyata atandı (touchWarehouseSackTx guard'ı).
      // 400 = simüle kantar reddi → backend'in Türkçe mesajı doğrudan gösterilir
      // ("…simülasyon bayrağını kapatın, ya da ⋮ → Elle kg gir").
      Toast.show({ type: 'error', text1: 'Tartı kaydedilemedi', text2: e.message, visibilityTime: 6000 });
    },
  });

  /** ⚖ tek dokunuş: oku → doğrudan kaydet → listeyi tazele. */
  const weigh = async (sack: SackWeighTarget): Promise<void> => {
    if (busyRef.current) return; // kantar meşgul — sessizce yok say
    busyRef.current = true;
    setWeighingSackId(sack.id);
    try {
      const read = await readFromScale();
      if (read == null) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return; // hata toast'ı readFromScale içinde verildi; DB'ye HİÇ gitmedik
      }
      await saveMut.mutateAsync({ sackId: sack.id, kg: read.kg, source: read.source });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: `${read.kg.toLocaleString('tr-TR')} kg`, text2: sack.label });
      onSaved();
    } catch {
      // saveMut.onError toast'ladı; burada yutuyoruz (mutateAsync reject eder).
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      busyRef.current = false;
      setWeighingSackId(null);
    }
  };

  /**
   * ⋮ → "Elle kg gir" yolu — kantarsız/arızalı durum için. `source: MANUAL` beyan
   * edilir ve simüle korumasından MUAFTIR (operatör değeri kendi yazmıştır).
   */
  const saveManual = async (sack: SackWeighTarget, kg: number): Promise<boolean> => {
    // D10: `busyRef` kontrolü — kantar okuması SÜRERKEN ⋮ → elle giriş aynı çuvala
    // İKİNCİ bir weighSack atıyordu; son yazan kazanıyor ve hangi değerin (kantar mı
    // elle mi) kaldığı belirsizleşiyordu. ⚖ tuşları `busy` ile pasifleşiyor ama ⋮
    // yolu ona bağlı değildi.
    if (busyRef.current) {
      Toast.show({
        type: 'info',
        text1: 'Kantar okuması sürüyor',
        text2: 'Bitmesini bekleyip tekrar deneyin.',
      });
      return false;
    }
    busyRef.current = true;
    try {
      await saveMut.mutateAsync({ sackId: sack.id, kg, source: 'MANUAL' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: `${kg.toLocaleString('tr-TR')} kg (elle)`, text2: sack.label });
      onSaved();
      return true;
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return false;
    } finally {
      busyRef.current = false;
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
