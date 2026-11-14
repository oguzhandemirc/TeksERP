// Telefon bildirim sesi (S0) — küme, varsayılanlar ve Android kanal kimliği. İkizi bulut/fabrika teli
// (`patron/sunucu/src/wire/esitleme.ts` `PUSH_SOUNDS` · `pushChannelId`); aynı vektörler iki uçta da ölçülür.
// Android'de kanalın sesi kurulduktan sonra değişmez → ses × sınıf başına ayrı kanal; seçim değişince yeni kanal kurulur.
import type { KeyValue } from "../state/browser-store";

export const SESLER = ["tekserp_zil", "tekserp_alarm", "tekserp_mekik", "tekserp_dokuma", "tekserp_kisa", "varsayilan", "sessiz"] as const;
export type Ses = (typeof SESLER)[number];
export type SesSinifi = "BILDIRIM" | "ALARM";

export interface SesSecimi {
  readonly bildirim: Ses;
  readonly alarm: Ses;
}

export const VARSAYILAN_SES: SesSecimi = { bildirim: "tekserp_zil", alarm: "tekserp_alarm" };

export const SES_ADI: Readonly<Record<Ses, string>> = {
  tekserp_zil: "TeksERP zili",
  tekserp_alarm: "TeksERP alarmı",
  tekserp_mekik: "Mekik",
  tekserp_dokuma: "Dokuma",
  tekserp_kisa: "Kısa",
  varsayilan: "Telefonun varsayılan sesi",
  sessiz: "Sessiz (yalnız titreşim)",
};

/** `tekserp-<sınıf>-<ses>` (ör. `tekserp-bildirim-zil`, `tekserp-alarm-sessiz`) — bulut Expo iletisinde aynısını yollar. */
export const kanalKimligi = (sinif: SesSinifi, ses: Ses): string => `tekserp-${sinif.toLowerCase()}-${ses.replace(/^tekserp_/, "")}`;

/** Kanalın ses dosyası: gömülü ses `<ad>.wav`; telefonun varsayılanı `default`; sessiz `null`. */
export const sesDosyasi = (ses: Ses): string | null => (ses === "sessiz" ? null : ses === "varsayilan" ? "default" : `${ses}.wav`);

/** Bu sürümden önce kurulan tek kanal; yeni kanallar kurulunca silinir. */
export const ESKI_KANAL = "varsayilan";

/** Seçim cihazda saklanır (hesaptan bağımsız: telefonun kendi ayarı). */
export const SES_KEY = "patron.bildirimSesi";

const sesMi = (v: unknown): v is Ses => typeof v === "string" && (SESLER as readonly string[]).includes(v);

export function sesSecimiOku(raw: string | null): SesSecimi {
  if (!raw) return VARSAYILAN_SES;
  try {
    const v = JSON.parse(raw) as { bildirim?: unknown; alarm?: unknown };
    return { bildirim: sesMi(v.bildirim) ? v.bildirim : VARSAYILAN_SES.bildirim, alarm: sesMi(v.alarm) ? v.alarm : VARSAYILAN_SES.alarm };
  } catch {
    return VARSAYILAN_SES;
  }
}

export async function sesSecimiYukle(store: KeyValue): Promise<SesSecimi> {
  return sesSecimiOku(await store.get(SES_KEY).catch(() => null));
}

export async function sesSecimiKaydet(store: KeyValue, s: SesSecimi): Promise<void> {
  await store.set(SES_KEY, JSON.stringify(s));
}
