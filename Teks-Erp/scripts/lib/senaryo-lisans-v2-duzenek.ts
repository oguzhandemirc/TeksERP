// SENARYO L — lisans v2 düzenek yardımcıları (adım değil; L1–L30 ve L31+ ortak kullanır).
// Zayıf tanıma (tasarım §3.1-6, K8; lisans.md:128): Mac'te okunabilen etkenler f1 · f4 · f5, güçlü yalnız f4 ⇒ her etkinleştirme
// önce 409 ZAYIF_TANIMA_ONAY_BEKLIYOR alır (kod/nonce tüketilmez); portal onayı (kurulum + anahtar) sonrası AYNI kod
// çalışır. Onay anahtara bağlı olduğundan yeni makine (taşıma, DR, bayi kurulumu) kendi onayını ister.
// Rol DB'si: v2'de DB izi (`license.trace`, lisans.md:66) fabrika DB'sindedir; iki "makine" aynı DB'yi paylaşırsa birinin izi
// ötekinin geri alma/çelişki bulgusu olur. Kopya ve yalıtım isteyen her rol kendi `_test` DB'sini alır.
import { spawnSync } from "node:child_process";
import type { Pool } from "pg";
import type { FabrikaIstemcisi, LisansDetayi, PortalIstemcisi, Yanit } from "./senaryo-lisans-istemci";
import { TEKS_KOKU } from "./senaryo-lisans-surec";

type Kontrol = (ad: string, ok: boolean, ayrinti?: string) => boolean;
const ZAYIF = "ZAYIF_TANIMA_ONAY_BEKLIYOR";

const ozet = (y: Yanit): string => `${y.status}${y.kod ? ` ${y.kod}` : ""}${typeof y.details.vendorCode === "string" ? `/${y.details.vendorCode}` : ""}`;

interface DonanimTalebi {
  readonly id: string;
  readonly kurulumId: string;
  readonly tur: string;
  readonly durum: string;
  readonly anahtarKimligi: string;
}

/** Bekleyen ZAYIF_TANIMA talebini (kurulum + anahtar) bulur; yoksa null. */
export async function zayifTanimaTalebi(portal: PortalIstemcisi, kurulumDbId: string, anahtarKimligi: string): Promise<DonanimTalebi | null> {
  const liste = await portal.istek("GET", "/donanim-talepleri?durum=BEKLIYOR&tur=ZAYIF_TANIMA");
  const items = (liste.veri.items ?? []) as DonanimTalebi[];
  return items.find((t) => t.kurulumId === kurulumDbId && t.anahtarKimligi === anahtarKimligi) ?? null;
}

/**
 * Etkinleştirir; zayıf tanımada talebi portalda onaylayıp aynı kodla yeniden dener. İlk yanıt ZAYIF değilse
 * (güçlü küme ya da başka ret) onu döndürür. Kanıt satırları `kontrol`a yazılır.
 */
export async function etkinlestirZayifOnayli(g: {
  readonly fabrika: FabrikaIstemcisi;
  readonly portal: PortalIstemcisi;
  readonly kurulumDbId: string;
  readonly kod: string;
  readonly kontrol: Kontrol;
  readonly etiket: string;
}): Promise<Yanit> {
  const ilk = await g.fabrika.istek("POST", "/api/license/etkinlestir", { kod: g.kod });
  if (!(ilk.status === 409 && ilk.details.vendorCode === ZAYIF)) return ilk;
  const anahtar = (await g.fabrika.detay()).kurulum.anahtarKimligi ?? "";
  const talep = await zayifTanimaTalebi(g.portal, g.kurulumDbId, anahtar);
  g.kontrol(`${g.etiket}: zayıf tanıma (güçlü etken < 2) → 409 ${ZAYIF}, talep portal kuyruğunda BEKLIYOR`, talep !== null, `${ozet(ilk)} talep=${talep?.id ?? "yok"}`);
  if (!talep) return ilk;
  const onay = await g.portal.istek("POST", `/donanim-talepleri/${talep.id}/onayla`, { sebep: `Senaryo L ${g.etiket} zayıf tanıma onayı` });
  g.kontrol(`${g.etiket}: portal onayı → 200 ONAYLANDI`, onay.status === 200 && onay.veri.durum === "ONAYLANDI", ozet(onay));
  return g.fabrika.istek("POST", "/api/license/etkinlestir", { kod: g.kod });
}

/** Rol DB'sinin adresi: ana `<ad>_test` → `<ad>_<rol>_test` (hedef kapısının `_test` soneki korunur). */
export function rolDbUrl(anaUrl: string, rol: string): string {
  if (!/^[a-z0-9]+$/i.test(rol)) throw new Error(`rol adı geçersiz: ${rol}`);
  const u = new URL(anaUrl);
  const ad = u.pathname.replace(/^\//, "");
  if (!/^[a-z0-9_]+_test$/.test(ad)) throw new Error(`ana DB adı '${ad}' rol türetmeye uygun değil (yalnız [a-z0-9_]+_test)`);
  u.pathname = `/${ad.slice(0, -"_test".length)}_${rol.toLowerCase()}_test`;
  return u.toString();
}

/**
 * Rol DB'si: yoksa BOŞ açılır + migrate deploy + seed (fabrika yedeğinden DEĞİL); hedef kapısından geçer; lisans izi
 * sıfırlanır (her koşumda taze makine). `yeni` true ise ad DROP listesine bildirilmeli.
 */
export async function rolDbHazirla(g: {
  readonly havuz: (url: string) => Pool;
  readonly anaUrl: string;
  readonly rol: string;
  readonly kapi: (url: string) => Promise<void>;
}): Promise<{ url: string; ad: string; yeni: boolean }> {
  const url = rolDbUrl(g.anaUrl, g.rol);
  const ad = new URL(url).pathname.slice(1);
  const varMi = ((await g.havuz(g.anaUrl).query(`SELECT 1 FROM pg_database WHERE datname = $1`, [ad])).rowCount ?? 0) > 0;
  if (!varMi) {
    await g.havuz(g.anaUrl).query(`CREATE DATABASE "${ad}"`);
    for (const argv of [["prisma", "migrate", "deploy"], ["prisma", "db", "seed"]]) {
      const r = spawnSync("npx", argv, { cwd: TEKS_KOKU, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`rol DB'si ${ad}: ${argv.join(" ")} çıkış ${r.status}\n${(r.stderr || r.stdout).slice(-1500)}`);
    }
  }
  await g.kapi(url);
  await g.havuz(url).query(`DELETE FROM system_settings WHERE key = 'license.trace'`);
  return { url, ad, yeni: !varMi };
}

/** Kanıt satırı için bulgu listesi: `KOD(ayrıntı)`. */
export function nedenOzeti(d: LisansDetayi): string {
  return d.durum.nedenler.map((n) => (n.ayrinti ? `${n.kod}(${n.ayrinti})` : n.kod)).join(",");
}

/** Portal kurulum detayındaki kira satırı (kimliğiyle): karar ve kapanış nedeni. Zil yoklaması açık yoklamadan önce
 *  aynı kapanış kirasını almış olabilir — "son satır" değil fabrikanın ELİNDEKİ kira ölçülür. */
export function kiraSatiri(portalDetay: Record<string, unknown>, kiraId: string | undefined): { karar?: string; kapanisNedeni?: string | null } | null {
  const satirlar = (portalDetay.kiralar ?? []) as Array<{ id: string; karar?: string; kapanisNedeni?: string | null }>;
  return satirlar.find((k) => k.id === kiraId) ?? null;
}
