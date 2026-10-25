// =============================================================================
// İŞLEM BAŞLIĞI — tek "Kaydet" (aynı requestId) = tek iş eylemi cümlesi (izlenebilirlik B2)
// -----------------------------------------------------------------------------
// Önce uç→eylem kataloğu (başarı `fiil`, ≥400 `deneme` + "— reddedildi: <neden> (<kod>)");
// yoksa kök kaydın anlatısı (sipariş > sevkiyat > iş emri > çuval > top > diğer) +
// "ve N kayıt daha etkilendi". YALNIZ GÖRÜNTÜ: başlıktan sayı/karar türetilmez.
// =============================================================================

import { redNedeni, ucEylemi } from "../../constants/route-eylem-katalogu";
import { type Anlati, type NarrativeRow, type Parca, d, m } from "./sablonlar";
import { kisaAd, metneCevir } from "./index";

/** İstek başlığının anlatıcının okuduğu alanları (`request_traces`ten). */
export interface TraceSummary {
  method: string;
  routeKey: string;
  status: number;
  errorCode: string | null;
}

const KOK_ONCELIGI = ["ORDER", "SHIPMENT", "WORK_ORDER", "WEAVING_ORDER", "SACK", "ROLL"];

/** Kök satır: öncelik listesindeki ilk tablo; yoksa ilk satır. */
export function rootRow<T extends NarrativeRow>(satirlar: readonly T[]): T | null {
  for (const t of KOK_ONCELIGI) {
    const r = satirlar.find((s) => s.tableName === t);
    if (r) return r;
  }
  return satirlar[0] ?? null;
}

function dahaEki(n: number): Parca[] {
  return n > 1 ? [m(` ve ${n - 1} kayıt daha etkilendi`)] : [];
}

export function islemBasligi(
  kisi: NarrativeRow["user"],
  iz: TraceSummary | null,
  satirlar: ReadonlyArray<NarrativeRow & { anlati: Anlati }>,
): Anlati {
  const k: Parca = { t: "kisi", text: kisaAd(kisi) };
  const kok = rootRow(satirlar);
  if (iz && iz.status >= 400) {
    const eylem = ucEylemi(iz.method, iz.routeKey);
    const deneme = eylem?.deneme ?? `bir işlem yapmaya çalıştı (${iz.method} ${iz.routeKey})`;
    return metneCevir([k, m(` ${deneme} — reddedildi: `), d(redNedeni(iz.status, iz.errorCode)), m(` (${iz.errorCode ?? iz.status})`)]);
  }
  const eylem = iz ? ucEylemi(iz.method, iz.routeKey) : null;
  if (eylem) {
    const recordPart = kok?.anlati.parcalar.find((p) => p.t === "kayit");
    const ek: Parca[] = recordPart ? [m(" — "), recordPart] : [];
    return metneCevir([k, m(` ${eylem.fiil}`), ...ek, ...dahaEki(satirlar.length)]);
  }
  if (kok) return metneCevir([...kok.anlati.parcalar, ...dahaEki(satirlar.length)]);
  return metneCevir(iz ? [k, m(` bir işlem yaptı (${iz.method} ${iz.routeKey})`)] : [k, m(" bir işlem yaptı")]);
}
