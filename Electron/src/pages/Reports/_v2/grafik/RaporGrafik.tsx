import { useMemo, useRef } from "react";
import { useAppearanceVersion, useEChartInstance } from "@/components/insight/useEChartInstance";
import { GRAFIK_VERI_YOK, grafikBosMu, grafikSecenek, type Egilim } from "./secenek";
import { ekranTemasi } from "./tema";
import type { GrafikBlok } from "../sunum";

interface Props {
  blok: GrafikBlok;
  /** Piksel yükseklik; genişlik kabı doldurur. */
  yukseklik?: number;
  /** Ekran okuyucu için grafik adı. */
  baslik?: string;
  /** Saçılımda sunucunun eğilim çizgisi (R3-ANALIZ). */
  egilim?: Egilim | null;
}

/**
 * Rapor grafiğinin TEK ekran bileşeni (ECharts, canvas). Motor ilk çizimde tembel
 * yüklenir ([KU-17]); kap boyutu değişince yeniden ölçeklenir; tema değişince aynı örnek
 * yeniden boyanır (canvas CSS değişkenini kendisi izlemez).
 */
export function RaporGrafik({ blok, yukseklik = 280, baslik, egilim }: Props) {
  const kap = useRef<HTMLDivElement>(null);
  const version = useAppearanceVersion();
  const bos = grafikBosMu(blok);
  // Görünüm değişimi aynı örnekte yeniden boyar (dispose+init yok → yanıp sönmez).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` tema belirteçlerini yeniden okutur
  const secenek = useMemo(() => (bos ? null : grafikSecenek(blok, ekranTemasi(), { egilim })), [blok, bos, egilim, version]);
  useEChartInstance(kap, secenek);

  if (bos) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: yukseklik }}>
        {GRAFIK_VERI_YOK}
      </div>
    );
  }
  return <div ref={kap} role="img" aria-label={baslik ?? blok.eksen.y.ad} style={{ height: yukseklik, width: "100%" }} />;
}
