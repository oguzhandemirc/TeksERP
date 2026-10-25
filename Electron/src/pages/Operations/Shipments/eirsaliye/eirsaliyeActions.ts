// e-İrsaliye düğme görünürlüğü — izin × durum × bağdaştırıcı yeteneği TEK saf fonksiyon.
// Backend kapıları (E5 servis) aynasıdır; sunucu yine son sözü söyler (409/400). Tanınmayan
// bağdaştırıcı hiçbir yetenek almaz (fail-closed).
import type { EIrsaliyeStatus } from "@/types/enums";
import type { EIrsaliyeAdapterCode } from "./types";

export interface AdapterCapabilities {
  /** Gönderim/yanıt elle kaydedilir (portala elle yükleme). */
  manual: boolean;
  /** Bağdaştırıcı gönderir (`POST /send`). */
  send: boolean;
  /** Bağdaştırıcıdan durum sorgulanır (`POST /poll`). */
  poll: boolean;
}

const CAPS: Readonly<Record<string, AdapterCapabilities>> = {
  disaAktar: { manual: true, send: false, poll: false },
  simulasyon: { manual: false, send: true, poll: true },
};
const NONE: AdapterCapabilities = { manual: false, send: false, poll: false };

export function adapterCapabilities(code: EIrsaliyeAdapterCode | null | undefined): AdapterCapabilities {
  return (code && Object.prototype.hasOwnProperty.call(CAPS, code) ? CAPS[code] : undefined) ?? NONE;
}

/** GİB'e gitmemiş durumlar — alan düzeltme ve iptal yalnız bunlarda. */
export const LOCAL_STATUSES: readonly EIrsaliyeStatus[] = ["TASLAK", "OLUSTURULDU", "HATA"];
const UNDOABLE: readonly EIrsaliyeStatus[] = ["GONDERILDI", "KABUL", "KISMI_KABUL", "REDDEDILDI"];

export interface EIrsaliyeActionInput {
  /** Hazırlık kapısı HAZIR mı (belge doğuran eylemler yalnız o zaman). */
  ready: boolean;
  /** İhracat sevkiyatı — v1'de desteklenmez. */
  export: boolean;
  /** Sevkiyatın durumu (`DISPATCHED` dışında hazırlanmaz). */
  shipmentStatus: string;
  /** Odaktaki kayıt: canlı kayıt; yoksa en yeni reddedilmiş kayıt; yoksa null. */
  record: { status: EIrsaliyeStatus; adapter: EIrsaliyeAdapterCode; documentNo: string | null } | null;
  /** Odaktaki kayıt canlı mı (reddedilmiş geçmiş kayıt değil). */
  live: boolean;
  canWrite: boolean;
  canUndo: boolean;
}

export interface EIrsaliyeActions {
  prepare: boolean;
  editFields: boolean;
  generate: boolean;
  regenerate: boolean;
  download: boolean;
  send: boolean;
  poll: boolean;
  markSent: boolean;
  response: boolean;
  undo: boolean;
  cancel: boolean;
}

export function eirsaliyeActions(i: EIrsaliyeActionInput): EIrsaliyeActions {
  const r = i.record;
  const s = r?.status;
  const caps = adapterCapabilities(r?.adapter);
  const w = i.canWrite && !i.export;
  const liveLocal = Boolean(r && i.live && s && LOCAL_STATUSES.includes(s));
  return {
    prepare: w && i.ready && i.shipmentStatus === "DISPATCHED" && !i.live,
    editFields: w && liveLocal,
    generate: w && i.ready && i.live && s === "TASLAK",
    regenerate: w && i.ready && i.live && (s === "OLUSTURULDU" || s === "HATA"),
    download: i.canWrite && Boolean(r?.documentNo) && s !== "TASLAK" && s !== "IPTAL",
    send: w && i.ready && i.live && caps.send && s === "OLUSTURULDU",
    poll: w && i.ready && i.live && caps.poll && s === "GONDERILDI",
    markSent: w && i.live && caps.manual && s === "OLUSTURULDU",
    response: w && i.live && caps.manual && s === "GONDERILDI",
    undo: i.canUndo && caps.manual && Boolean(s && UNDOABLE.includes(s)),
    cancel: w && liveLocal,
  };
}
