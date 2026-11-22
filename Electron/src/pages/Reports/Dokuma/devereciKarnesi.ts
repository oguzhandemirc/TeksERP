// =============================================================================
// DEVERECİ KARNESİ (devere-levent S2) — HTTP istemcisi + TEK kolon kurucusu (ekran tablosu ve Excel/PDF aynı listeden)
// =============================================================================
// Uç `/api/reports/dokuma/devereci-karnesi` (v2 katalog satırı; devere kapısı, `report:production`). İstemci HESAP
// YAPMAZ: oranlar sunucudan gelir; null = ölçülemedi ("—"), sıfır değil.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { formatDisplay } from "@/lib/format";
import type { ReportColumn, ReportExportSpec } from "../_components/reportExport";
import type { Secenek } from "./leventReportTypes";

export interface KarneOlculeri {
  teslim: { siparis: number; terminli: number; zamaninda: number; gecikmeli: number; zamanindaPct: number | null; ortGecikmeGun: number | null };
  sure: { medyanGun: number | null; ornek: number };
  fire: { kapanis: number; ortPct: number | null; enYuksekPct: number | null; toleransAsimi: number };
  ret: { donenLevent: number; reddedilen: number; oranPct: number | null };
  denye: { levent: number; nominalKg: number; tartiNetKg: number; sapmaPct: number | null };
  cozguHatasi: { top: number; kumasM: number; hata: number; yuzMetreBasina: number | null; gerekce: string | null };
}
export interface KarneRow extends KarneOlculeri {
  subcontractor: { id: string; name: string };
  tahminGun: number | null;
}
export interface KarneReport {
  satirlar: KarneRow[];
  ozet: KarneOlculeri;
  meta: { ufuk: string; otomatikTuketim: boolean; secenekler: { subcontractorId: Secenek[] } };
}
export interface KarneQuery { from: string; to: string; subcontractorId?: string }

const qs = (p: KarneQuery): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) sp.set(k, v);
  return `?${sp.toString()}`;
};

export const devereciKarnesiApi = {
  // Hata sayfada kalıcı kutuda gösterilir — genel toast bastırılır.
  report: async (p: KarneQuery) =>
    (await apiClient.get<ApiResponse<KarneReport>>(`/api/reports/dokuma/devereci-karnesi${qs(p)}`, { suppressErrorToast: true })).data,
};

const pct = (v: number | null): string => (v === null ? "—" : `%${formatDisplay(v, 1)}`);
const signedPct = (v: number | null): string => (v === null ? "—" : `${v > 0 ? "+" : ""}%${formatDisplay(v, 1)}`);
const gun = (v: number | null): string => (v === null ? "—" : `${formatDisplay(v, 1)} gün`);

/** Zamanında hücresi: oran + (zamanında/terminli); terminsiz sipariş oran dışında. */
export function onTimeText(t: KarneOlculeri["teslim"]): string {
  return t.terminli === 0 ? "—" : `${pct(t.zamanindaPct)} (${t.zamaninda}/${t.terminli})`;
}
/** Ret hücresi: oran + (reddedilen/dönen). */
export function rejectText(r: KarneOlculeri["ret"]): string {
  return r.donenLevent === 0 ? "—" : `${pct(r.oranPct)} (${r.reddedilen}/${r.donenLevent})`;
}
/** Çözgü hatası hücresi: 100 m başına; ölçülemezse "Ölçülemedi". */
export function warpDefectText(c: KarneOlculeri["cozguHatasi"]): string {
  return c.yuzMetreBasina === null ? "Ölçülemedi" : `${formatDisplay(c.yuzMetreBasina, 2)} (${c.hata} hata / ${formatDisplay(c.kumasM, 0)} m)`;
}

export interface KarneColumn extends ReportColumn {
  value: (r: KarneRow) => string | number | null;
  display: (r: KarneRow) => string;
}
const INT = "0";
const DEC = "0.0";

/** TEK kolon kurucusu: ekran tablosu `display`, Excel/PDF `value` okur. */
export const KARNE_COLUMNS: KarneColumn[] = [
  { header: "Devereci", key: "devereci", width: 26, value: (r) => r.subcontractor.name, display: (r) => r.subcontractor.name },
  { header: "Teslim edilen sipariş", key: "siparis", width: 10, numFmt: INT, align: "right", value: (r) => r.teslim.siparis, display: (r) => formatDisplay(r.teslim.siparis, 0) },
  { header: "Zamanında", key: "zamaninda", width: 16, align: "right", value: (r) => onTimeText(r.teslim), display: (r) => onTimeText(r.teslim) },
  { header: "Ort. gecikme", key: "gecikme", width: 11, numFmt: DEC, align: "right", value: (r) => r.teslim.ortGecikmeGun, display: (r) => gun(r.teslim.ortGecikmeGun) },
  { header: "Teslim süresi (medyan)", key: "sure", width: 12, numFmt: DEC, align: "right", value: (r) => r.sure.medyanGun, display: (r) => gun(r.sure.medyanGun) },
  { header: "Planlama tahmini", key: "tahmin", width: 11, numFmt: DEC, align: "right", value: (r) => r.tahminGun, display: (r) => gun(r.tahminGun) },
  { header: "Ort. fire", key: "fire", width: 9, numFmt: DEC, align: "right", value: (r) => r.fire.ortPct, display: (r) => pct(r.fire.ortPct) },
  { header: "Tolerans aşımı", key: "tolerans", width: 10, numFmt: INT, align: "right", value: (r) => r.fire.toleransAsimi, display: (r) => `${r.fire.toleransAsimi} / ${r.fire.kapanis}` },
  { header: "Ret", key: "ret", width: 14, align: "right", value: (r) => rejectText(r.ret), display: (r) => rejectText(r.ret) },
  { header: "Denye sapması", key: "denye", width: 11, align: "right", value: (r) => signedPct(r.denye.sapmaPct), display: (r) => signedPct(r.denye.sapmaPct) },
  { header: "Çözgü hatası / 100 m", key: "hata", width: 24, align: "right", value: (r) => warpDefectText(r.cozguHatasi), display: (r) => warpDefectText(r.cozguHatasi) },
];

export function buildKarneExport(opts: { report: KarneReport; range: { from: string; to: string }; filterNotes: string[] }): ReportExportSpec {
  const { report, range, filterNotes } = opts;
  return {
    title: "Devereci Karnesi",
    subtitle: `Dönem ${range.from} – ${range.to} · fason devere`,
    orientation: "landscape",
    meta: [...filterNotes, `Tezgah verisi ${report.meta.ufuk} sonrası ölçülü`],
    tables: [{
      name: "Devereci karnesi",
      columns: KARNE_COLUMNS.map(({ header, key, width, numFmt, align }) => ({ header, key, width, numFmt, align })),
      rows: report.satirlar.map((r) => Object.fromEntries(KARNE_COLUMNS.map((c) => [c.key, c.value(r) ?? "—"]))),
      notes: [
        "Zamanında: siparişin ilk leventi termin gününe kadar kabul edildiyse. Terminsiz sipariş oranın dışında.",
        "Teslim süresi: ilk iplik sevkinden ilk levent kabulüne (fabrika günü, medyan).",
        "Çözgü hatası: topa bağlı levent tüketimi (otomatik tüketim) olan topların çözgü grubu hataları.",
      ],
    }],
  };
}
