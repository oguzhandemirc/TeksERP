// =============================================================================
// e-İrsaliye BAĞDAŞTIRICI ARAYÜZÜ (plan §3.3, birebir)
// =============================================================================
// v1: `disaAktar` (hiçbir yetenek yok — panel elle akışı gösterir) ve `simulasyon`
// (ağ YOK, belirlenimli). v2 entegratör bağdaştırıcıları aynı arayüzü uygular;
// dış çağrı her zaman tx DIŞINDA yapılır (motor sözleşmesi).
// =============================================================================

export type SendResult = { ok: true; saglayiciRef?: string } | { ok: false; hata: string; gecici: boolean };

export type StatusResult = {
  durum: "GONDERILDI" | "KABUL" | "KISMI_KABUL" | "REDDEDILDI" | "HATA";
  aciklama?: string;
  yanit?: unknown;
};

export interface EIrsaliyeAdapter {
  /** "disaAktar" | "simulasyon" | v2: entegratör kodu */
  readonly kod: string;
  /** Türkçe ad */
  readonly etiket: string;
  readonly yetenek: { gonder: boolean; durumSorgula: boolean; yanitAl: boolean };
  gonder(g: { xml: string; ettn: string; belgeNo: string; aliciVkn: string }): Promise<SendResult>;
  durumSorgula(r: { ettn: string; saglayiciRef?: string | null }): Promise<StatusResult>;
}
