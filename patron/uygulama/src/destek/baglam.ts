// Destek talebinin otomatik bağlamı (kullanıcıya SORULMAZ). Giren: ekran adı + rota, uygulama sürümü + yapı numarası,
// platform ve sürümü, cihaz modeli. GİRMEZ: parola, oturum belirteci, cihaz/push belirteci, sunucu adresi, sorgu dizesi.
// Bağlam KATIdır (yalnız sözleşmedeki üst alanlar) ve ≤ 16 KB'tır; bütün metinler kırpılır.
import { MODULES } from "../lib/access";
import type { DestekBaglam } from "../api/destek-wire";

export interface BaglamGirdisi {
  readonly ekranAdi: string | null;
  /** expo-router yolu (`usePathname`); sorgu/parça atılır. */
  readonly yol: string | null;
  readonly surum: string;
  readonly yapi: string | number | null;
  readonly os: string;
  readonly osSurum: string | number | null;
  readonly model: string | null;
}

const metin = (v: unknown, azami: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, azami) : typeof v === "number" ? String(v).slice(0, azami) : undefined;

const OS_ADI: Readonly<Record<string, string>> = { ios: "iOS", android: "Android", web: "Web" };

/** URL'den yalnız yol: sorgu ve parça atılır (sorguda kişisel veri olabilir). */
export function yalnizYol(url: string | null | undefined): string | null {
  if (!url) return null;
  const y = url.split(/[?#]/)[0]!.slice(0, 500);
  return y || null;
}

/** Yol → Türkçe ekran adı (modül tablosundan; kayıt ayrıntısında "Siparişler · ayrıntı"). */
export function ekranAdiBul(yol: string | null | undefined): string | null {
  const y = yalnizYol(yol);
  if (!y) return null;
  if (y === "/diger") return "Menü";
  const [, ilk, ikinci] = y.split("/");
  const m = MODULES.find((x) => x.route === `/${ilk ?? ""}`);
  if (!m) return y;
  if (ikinci === "yeni") return `${m.title} · yeni`;
  return ikinci ? `${m.title} · ayrıntı` : m.title;
}

export function destekBaglami(g: BaglamGirdisi): DestekBaglam {
  const osAdi = OS_ADI[g.os] ?? g.os;
  const osSurum = metin(g.osSurum, 40);
  const yapi = metin(g.yapi, 20);
  const surum = metin(g.surum, 30) ?? "?";
  const client: NonNullable<DestekBaglam["client"]> = {
    os: (osSurum ? `${osAdi} ${osSurum}` : osAdi).slice(0, 100),
    appVersion: (yapi ? `${surum} (${yapi})` : surum).slice(0, 50),
    locale: "tr-TR",
  };
  const model = metin(g.model, 100);
  if (model) client.device = model;
  const technical: Record<string, unknown> = { uygulama: "TeksERP Yönetim", platform: g.os };
  if (yapi) technical.yapiNumarasi = yapi;
  const baglam: DestekBaglam = { client, technical };
  const ad = metin(g.ekranAdi, 200);
  if (ad) baglam.screen = ad;
  const yol = yalnizYol(g.yol);
  if (yol) baglam.path = yol;
  return baglam;
}
