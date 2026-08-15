// =============================================================================
// TAHSİLAT / ÖDEME SÜZGECİ — SAF KATMAN (B4)
// =============================================================================
// Ekranın tek filtresi "yön" idi (ölçüldü: 1 kutu) ve liste 100 satırla kırpılı:
// muhasebeci belirli bir carinin ödemesini ararken sayfayı gözle taramak
// zorunda kalıyordu.
//
// ⚠️ SÜZME SUNUCUDA. Liste sayfalı; istemcide süzmek yalnız O ANKİ SAYFAYI
// süzer ve kullanıcı "kayıt yok" sanıp AYNI tahsilatı ikinci kez girer — para
// hareketinde bunun bedeli mükerrer kapama ve yanlış cari bakiyesidir.
//
// ⚠️ BOŞ DEĞER HİÇ GÖNDERİLMEZ (`undefined`): `status=""` bugün zararsız
// (backend falsy'yi eler) ama sözleşme sunucunun iç `if`ine dayanamaz ve boş
// parametre react-query anahtarını da kirletir (`cashTxnRules` emsali).
//
// ⚠️ GÜN SINIRI İSTEMCİNİNDİR: yerel 00:00 / 23:59:59.999 (`Cheques/dates` TEK
// kaynak). Boş/bozuk tarih `undefined` döner — sessizce bir güne çevirmek
// listeyi boşaltırdı.
//
// ⚠️ ÇOKLU SEÇİM YOK ve bilinçli: `direction` iki değerli NOT NULL enum
// ("ikisini de seç" = filtre yok), `status` da öyle. `method` teknik olarak
// çoklu olabilir (backend CSV kabul ediyor) ama şeritte tek kutu daha okunur;
// gerekirse ÇOKLU'ya açmanın yeri burasıdır, sorgu şekli hazır.
//
// Bekçi: `paymentFilters.test.ts`.
// =============================================================================
import { dayEndIso, dayStartIso } from "./Cheques/dates";

/** Backend `PaymentMethod` enum'unun aynası (Electron backend'i import edemez). */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Nakit",
  BANK_TRANSFER: "Havale/EFT",
  CREDIT_CARD: "Kredi Kartı",
  OTHER: "Diğer",
};

export interface PaymentFilterState {
  /** "" = tümü. Backend TEK değer alır. */
  direction: string;
  status: string;
  method: string;
  /** CARİ id — müşteri/fason id'si DEĞİL (uç `cariId` ister). */
  cariId: string | null;
  search: string;
  /** `<input type="date">` — "" meşrudur (kullanıcı temizleyebilir). */
  from: string;
  to: string;
}

export const EMPTY_PAYMENT_FILTERS: PaymentFilterState = {
  direction: "",
  status: "",
  method: "",
  cariId: null,
  search: "",
  from: "",
  to: "",
};

export function isPaymentFilterDirty(f: PaymentFilterState): boolean {
  return Boolean(f.direction || f.status || f.method || f.cariId || f.search || f.from || f.to);
}

/**
 * Süzgeç durumu → HTTP parametreleri.
 *
 * ⚠️ TARİH ANAHTARLARI `from`/`to`: uç ikisini de (`dateFrom`/`dateTo` takma
 * adıyla) tanıyor ama modülün üç kardeş listesi (faturalar, kasa hareketleri,
 * çekler) `from`/`to` kullanıyor — tek isim, tek alışkanlık.
 */
export function buildPaymentListQuery(f: PaymentFilterState): Record<string, string | undefined> {
  return {
    direction: f.direction || undefined,
    status: f.status || undefined,
    method: f.method || undefined,
    cariId: f.cariId ?? undefined,
    search: f.search.trim() || undefined,
    from: dayStartIso(f.from),
    to: dayEndIso(f.to),
  };
}

/**
 * React-query anahtarının süzgeç parçası.
 *
 * ⚠️ Anahtar SORGUDAN türetilir — ekrandaki ham metinden değil: `search: " "`
 * ile `search: ""` aynı isteği üretir ve iki ayrı önbellek girdisi açmaları
 * gereksiz bir yeniden çekim demektir.
 */
export function paymentFilterKey(f: PaymentFilterState): string {
  const q = buildPaymentListQuery(f);
  return JSON.stringify([q.direction, q.status, q.method, q.cariId, q.search, q.from, q.to]);
}
