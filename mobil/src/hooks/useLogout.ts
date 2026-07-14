import { useState } from 'react';
import Toast from 'react-native-toast-message';
import { performLogout, pendingStationOpsCount, isOnline } from '../offline/sessionSwitch';

/**
 * Çıkış akışı (paylaşımlı) — ScreenChrome (modül başlığı profil menüsü) ve
 * PlaceConfirmView (yer onayı gate'i) aynı davranışı kullanır. ÖNCE A token'ıyla
 * TAVANLI flush (≤5sn) → oturum kapat (≤4sn) → clearAuth → seçici cache temizliği
 * (performLogout). Offline + bekleyen istasyon yazımı varsa önce onay ister.
 * İki modalı <LogoutModals> render eder; bu hook yalnız durum + tetikleyicileri verir.
 */
export function useLogout() {
  // Offline + bekleyen kayıt varken çıkış onayı ({ pending } = kuyruk sayısı).
  const [confirm, setConfirm] = useState<{ pending: number } | null>(null);
  // Çıkış sürerken (tavanlı flush + oturum kapatma) kapatılamaz gösterge;
  // değer = çıkış anında kuyrukta bekleyen kayıt sayısı.
  const [busy, setBusy] = useState<number | null>(null);

  const runLogout = async () => {
    if (busy !== null) return; // çift dokunuş = tek çıkış akışı
    setBusy(pendingStationOpsCount());
    try {
      const outcome = await performLogout();
      if (outcome.pendingCount > 0) {
        Toast.show({
          type: 'info',
          text1: `${outcome.pendingCount} kayıt bekletildi`,
          text2: 'Kayıtlar cihazda güvende — girişten sonra otomatik gönderilecek.',
          visibilityTime: 6000,
        });
      }
    } catch {
      // Tek gerçekçi kaynak: SecureStore silme hatası (clearAuth). Kullanıcı
      // oturumda kalır — sessiz unhandled rejection yerine tekrar denesin.
      Toast.show({
        type: 'error',
        text1: 'Çıkış tamamlanamadı',
        text2: 'Lütfen tekrar deneyin.',
        visibilityTime: 6000,
      });
    } finally {
      // Başarıda bileşen unmount olur (login ekranı); hata hâlinde gösterge
      // kalıcı takılı kalmasın.
      setBusy(null);
    }
  };

  // Menüden "Çıkış" tetiği: offline + bekleyen kayıt varsa önce onay iste,
  // aksi halde doğrudan çıkış akışını başlat.
  const requestLogout = () => {
    const pending = pendingStationOpsCount();
    if (!isOnline() && pending > 0) {
      Toast.show({
        type: 'error',
        text1: 'İnternet yok — bekleyen kayıtlar var',
        text2: `${pending} istasyon kaydı gönderilmeyi bekliyor.`,
        visibilityTime: 6000,
      });
      setConfirm({ pending });
      return;
    }
    void runLogout();
  };

  return { confirm, setConfirm, busy, runLogout, requestLogout };
}
