// "Belge okut" düğmesinin görünürlüğü (K17): sunucu ayarı + üretim modülü açıksa çizilir. Eski backend (404) /
// izin yok / modül kapalı → düğme yok (bugünkü ekran). Kapı yine sunucuda; bu yalnız görünürlük.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { stationDocLookupService } from '../../services/stationDocLookup.service';

export function useStationDocLookup() {
  const status = useQuery({
    queryKey: ['station-doc-lookup', 'status'],
    queryFn: () => stationDocLookupService.status(),
    staleTime: 60 * 1000,
    retry: false,
  });
  const [open, setOpen] = useState(false);
  return {
    enabled: status.data?.enabled === true,
    readerConfigured: status.data?.readerConfigured === true,
    open,
    setOpen,
  };
}
