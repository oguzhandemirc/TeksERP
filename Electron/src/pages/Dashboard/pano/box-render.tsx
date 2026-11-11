// Kutu anahtarı → çizici. Çizicisi olmayan (yeni sürüm sunucusundan gelen) kutu çizilmez; `hasContent` false
// dönen kutu (alt kapıları hep null) ızgarada yer tutmaz.
import type { ReactNode } from "react";
import { StationLoad } from "../StationLoad";
import type { PanoBoxData } from "./box-types";
import { PanoAgenda } from "./PanoAgenda";
import { PanoCashFlow, PanoStockFlow } from "./PanoFlowBoxes";
import { PanoDagilim, PanoEgilim } from "./PanoGrafikKutulari";
import { PanoKpiCard, PanoMoneyKpi } from "./PanoKpiSeridi";
import { PanoHizliEylemler, PanoMovementList } from "./PanoMovementList";
import { PanoAlacak, PanoBekleyen, PanoConsigned, PanoEnCok, PanoOutside, PanoStok, PanoTezgah } from "./PanoOzetKutulari";
import { PanoOpenWorkOrders, PanoQuality, PanoStationOutput, PanoTopCustomers } from "./PanoProductionBoxes";
import type { AgendaParams } from "./usePanoBoxData";
import type { PanoErisim } from "./usePanoErisim";
import type { PanoDonem } from "./types";

export interface RenderCtx {
  donem: PanoDonem;
  erisim: PanoErisim;
  onAgenda: (p: AgendaParams) => void;
  agendaLoading: boolean;
}

type Renderers = { [K in keyof PanoBoxData]: (d: PanoBoxData[K], c: RenderCtx) => ReactNode };

const RENDERERS: Renderers = {
  uretim: (d, c) => <PanoKpiCard boxKey="uretim" data={d} donem={c.donem} erisim={c.erisim} />,
  sevk: (d, c) => <PanoKpiCard boxKey="sevk" data={d} donem={c.donem} erisim={c.erisim} />,
  siparis: (d, c) => <PanoKpiCard boxKey="siparis" data={d} donem={c.donem} erisim={c.erisim} />,
  fason: (d, c) => <PanoKpiCard boxKey="fason" data={d} donem={c.donem} erisim={c.erisim} />,
  stok: (d, c) => <PanoKpiCard boxKey="stok" data={d} donem={c.donem} erisim={c.erisim} />,
  ciro: (d, c) => <PanoMoneyKpi boxKey="ciro" data={d} donem={c.donem} erisim={c.erisim} />,
  tahsilat: (d, c) => <PanoMoneyKpi boxKey="tahsilat" data={d} donem={c.donem} erisim={c.erisim} />,
  egilim: (d) => <PanoEgilim egilim={d} />,
  dagilim: (d) => <PanoDagilim dagilim={d} />,
  enCok: (d, c) => <PanoEnCok enCok={d} erisim={c.erisim} />,
  enCokMusteri: (d, c) => <PanoTopCustomers d={d} erisim={c.erisim} />,
  uretimIstasyon: (d, c) => <PanoStationOutput d={d} erisim={c.erisim} />,
  isEmriDurum: (d, c) => <PanoOpenWorkOrders d={d} erisim={c.erisim} />,
  kalite: (d, c) => <PanoQuality d={d} erisim={c.erisim} />,
  tezgah: (d, c) => <PanoTezgah t={d} erisim={c.erisim} />,
  stokOzeti: (d, c) => <PanoStok s={d} erisim={c.erisim} />,
  stokHareket: (d, c) => <PanoStockFlow d={d} erisim={c.erisim} />,
  fasonOzeti: (d, c) => <PanoOutside f={d} erisim={c.erisim} />,
  emanet: (d, c) => <PanoConsigned e={d} erisim={c.erisim} />,
  bekleyen: (d, c) => <PanoBekleyen b={d} erisim={c.erisim} />,
  ajanda: (d, c) => <PanoAgenda d={d} erisim={c.erisim} onPick={c.onAgenda} loading={c.agendaLoading} />,
  finans: (d, c) => <PanoAlacak f={d} erisim={c.erisim} />,
  nakitAkisi: (d, c) => <PanoCashFlow d={d} erisim={c.erisim} />,
  sonHareketler: (d, c) => <PanoMovementList hareketler={d.hareketler} yukleniyor={false} hata={false} onYenile={() => undefined} erisim={c.erisim} />,
};

export const hasRenderer = (key: string): boolean => key in RENDERERS || key === "hizliIslemler" || key === "istasyonDoluluk";

/** Gelen veri çizilecek bir şey taşıyor mu (alt kapıların hepsi null ise hayır). */
export function hasContent(key: string, data: unknown): boolean {
  if (data === null || data === undefined) return false;
  const d = data as Record<string, unknown>;
  switch (key) {
    case "egilim":
      return (d as PanoBoxData["egilim"]).noktalar.some((n) => n.uretimMetre !== null || n.sevkMetre !== null);
    case "enCok":
      return Boolean(d.uretilen || d.sevkEdilen);
    case "enCokMusteri":
      return Boolean(d.siparis || d.sevk);
    case "bekleyen":
      return Boolean(d.onayBekleyenBelge || d.sevkeHazir || d.uretimeGonderilmemisSiparis !== null);
    default:
      return true;
  }
}

export function renderBox(key: string, data: unknown, ctx: RenderCtx): ReactNode {
  if (key === "hizliIslemler") return <PanoHizliEylemler erisim={ctx.erisim} />;
  if (key === "istasyonDoluluk") return <StationLoad />;
  const r = (RENDERERS as Record<string, ((d: unknown, c: RenderCtx) => ReactNode) | undefined>)[key];
  return r ? r(data, ctx) : null;
}
