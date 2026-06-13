// O16 fix: sabit pageSize'lı tek-atış picker sorguları kayıt sayısı tavanı
// aşınca listeyi SESSİZCE kırpıyordu — tavanı aşan kayıt picker'da ve client
// aramasında hiç görünmüyor, hata da çıkmıyordu. Bu hook kırpılmayı operatöre
// görünür yapar (mount başına bir kez). Kalıcı çözüm: ilgili picker'ı
// PickerModal'ın paginated/infinite moduna taşımak — kayıt sayısı gerçekten
// tavana dayandığında bu uyarı o işin tetikleyicisidir.
import { useEffect, useRef } from 'react';
import Toast from 'react-native-toast-message';

export function useTruncationWarning(
  pagination: { total: number; pageSize: number } | undefined,
  label: string,
): void {
  const warned = useRef(false);
  useEffect(() => {
    if (warned.current || !pagination) return;
    if (pagination.total > pagination.pageSize) {
      warned.current = true;
      Toast.show({
        type: 'info',
        text1: `${label} listesi eksik gösteriliyor`,
        text2: `${pagination.pageSize}/${pagination.total} kayıt yüklendi — bulamadığınız kayıt için yöneticinize bildirin`,
        visibilityTime: 6000,
      });
    }
  }, [pagination, label]);
}
