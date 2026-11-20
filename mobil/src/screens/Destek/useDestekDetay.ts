// Talep ayrıntısı hook'u: yazışma, açılışta `okundu`, yanıt yazma, kapatma.
// Yanıt/kapatma merkezde tek işlemdir ve idempotency anahtarı TAŞIMAZ
// (sözleşme yalnız talep açmada clientToken ister); bu yüzden ağ hatasında
// OTOMATİK yeniden deneme yok, kullanıcı metni kutuda kalır ve kendisi basar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';

import { destekService, type DestekTalep } from '../../services/destek.service';
import { destekErrorText, errorCode } from './destekMetin';
import { LIST_REFRESH_MS } from './destekGorunurluk';
import { isReplyValid } from './destekForm';
import { CEVRIMDISI_METNI } from './useDestekYeni';
import { destekKeys } from './useDestek';

export function useDestekDetay(id: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: destekKeys.talep(id),
    queryFn: () => destekService.detay(id),
    refetchInterval: LIST_REFRESH_MS,
    retry: false,
  });
  const [yanit, setYanit] = useState('');
  const [islemHatasi, setIslemHatasi] = useState<{ metin: string; yeniTalepOner: boolean } | null>(null);
  const [mesgul, setMesgul] = useState<'yanit' | 'kapat' | null>(null);
  const okunduGitti = useRef(false);
  // Uçuş kilidi ref'te: aynı karede iki dokunuş state güncellenmeden ikisi de geçerdi.
  const ucusta = useRef(false);

  // Açılışta (talep yüklenince) BİR KEZ okundu; hata sessiz — rozet bir sonraki yoklamada düzelir.
  useEffect(() => {
    if (!q.data || okunduGitti.current) return;
    okunduGitti.current = true;
    destekService
      .okundu(id)
      .then(() => qc.invalidateQueries({ queryKey: ['destek', 'okunmamis'] }))
      .catch(() => undefined);
  }, [q.data, id, qc]);

  const islem = useCallback(
    (tur: 'yanit' | 'kapat', calis: () => Promise<DestekTalep>, sonra?: () => void) => {
      if (ucusta.current) return;
      if (!onlineManager.isOnline()) {
        setIslemHatasi({ metin: CEVRIMDISI_METNI.replace('Talep', 'Yanıt'), yeniTalepOner: false });
        return;
      }
      ucusta.current = true;
      setMesgul(tur);
      setIslemHatasi(null);
      calis()
        .then((t) => {
          qc.setQueryData(destekKeys.talep(id), t);
          void qc.invalidateQueries({ queryKey: ['destek', 'liste'] });
          sonra?.();
        })
        .catch((e: unknown) =>
          setIslemHatasi({
            metin: destekErrorText(e),
            yeniTalepOner: errorCode(e) === 'REOPEN_WINDOW_EXPIRED',
          }),
        )
        .finally(() => {
          ucusta.current = false;
          setMesgul(null);
        });
    },
    [id, qc],
  );

  const yanitGonder = useCallback(() => {
    if (!isReplyValid(yanit)) return;
    const metin = yanit.trim();
    islem('yanit', () => destekService.yanitYaz(id, metin), () => setYanit(''));
  }, [yanit, id, islem]);

  const kapat = useCallback(() => islem('kapat', () => destekService.kapat(id)), [id, islem]);

  return {
    talep: q.data,
    yukleniyor: q.isPending,
    hata: q.error,
    yenile: () => void q.refetch(),
    yanit,
    setYanit,
    yanitGecerli: isReplyValid(yanit),
    yanitGonder,
    kapat,
    mesgul,
    islemHatasi,
  };
}
