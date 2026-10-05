// Dağıtım bekçilerinin (Faz 3d) ortak ortamı: geçici DOSYA/DERLEME/YAYIN dizinleri + anahtar ortamı + süreç
// içi portal sunucuları + giriş yapmış YÖNETİCİ/OPERATÖR + müşteri → tesis → kurulum fikstürü. `test_` öneki yok.
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  anahtarOrtamiKur,
  kanalFiksturu,
  portalGiris,
  portalFetch,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  temizleDagitim,
  temizleKurulumlar,
  temizlePortal,
  type AnahtarOrtami,
  type PortalKimlik,
  type PortalSunuculari,
  type PortalYanit,
} from "./test-ortam";

export const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

export interface DagitimOrtami {
  readonly ortam: AnahtarOrtami;
  readonly sunucu: PortalSunuculari;
  readonly dizin: { readonly dosya: string; readonly derleme: string; readonly yayin: string };
  readonly yonetici: PortalKimlik & { cerez: string };
  readonly operator: PortalKimlik & { cerez: string };
  readonly musteriId: string;
  readonly kurulumDbId: string;
  readonly kanal: string;
  /** Satıcı portalı JSON çağrısı (yazmada clientToken verilmezse üretilir). */
  p(yontem: string, yol: string, govde?: Record<string, unknown>, cerez?: string): Promise<PortalYanit>;
  temizle(ek?: { yayinciKidler?: readonly string[]; bildirimKanallari?: readonly string[]; musteriler?: readonly string[] }): Promise<void>;
}

export async function dagitimOrtamiKur(ekOrtam: Record<string, string> = {}): Promise<DagitimOrtami> {
  const kok = mkdtempSync(path.join(os.tmpdir(), "satici-dagitim-"));
  const dizin = { dosya: path.join(kok, "dosyalar"), derleme: path.join(kok, "derlemeler"), yayin: path.join(kok, "yayin") };
  const ortam = await anahtarOrtamiKur(Date.now(), {
    PORTAL_GIRIS_HIZ_DK: "1000",
    DAGITIM_HIZ_IP_DK: "100000",
    DOSYA_DIZINI: dizin.dosya,
    DERLEME_DIZINI: dizin.derleme,
    YAYIN_DIZINI: dizin.yayin,
    ...ekOrtam,
  });
  const sunucu = await portalSunuculariKur(ortam.ctx);
  const yk = await portalKullaniciAc(ortam.ctx, "SATICI_YONETICI");
  const op = await portalKullaniciAc(ortam.ctx, "SATICI_OPERATOR");
  const yonetici = { ...yk, cerez: (await portalGiris(sunucu.portal, "/portal/api", yk)).cerez! };
  const operator = { ...op, cerez: (await portalGiris(sunucu.portal, "/portal/api", op)).cerez! };
  const svc = await import("../../src/services/entitlement.service");
  const kanal = await kanalFiksturu("bekci-dagitim");
  const musteri = await svc.createCustomer({ name: `Dağıtım Bekçi ${randomUUID().slice(0, 8)}`, actor: "bekci" });
  const tesis = await svc.createSite({ customerId: musteri.id, name: "Merkez", actor: "bekci" });
  const kurulum = await svc.createInstallation({ siteId: tesis.id, licenseClass: "URETIM", channelCode: kanal, actor: "bekci" });
  const p = (yontem: string, yol: string, govde?: Record<string, unknown>, cerez = yonetici.cerez): Promise<PortalYanit> =>
    portalIstek(sunucu.portal, `/portal/api${yol}`, {
      cerez,
      yontem,
      ...(govde === undefined ? {} : { govde: { clientToken: randomUUID(), ...govde } }),
    });
  const temizle = async (ek: { yayinciKidler?: readonly string[]; bildirimKanallari?: readonly string[]; musteriler?: readonly string[] } = {}): Promise<void> => {
    await sunucu.kapat();
    await temizleDagitim({ musteriler: [musteri.id, ...(ek.musteriler ?? [])], yayinciKidler: ek.yayinciKidler ?? [], bildirimKanallari: ek.bildirimKanallari ?? [] });
    await temizleKurulumlar([kurulum.id], ortam.kidler);
    await temizlePortal({ kullanicilar: [yk.id, op.id], musteriler: [musteri.id, ...(ek.musteriler ?? [])] });
    ortam.temizle();
    rmSync(kok, { recursive: true, force: true });
  };
  return { ortam, sunucu, dizin, yonetici, operator, musteriId: musteri.id, kurulumDbId: kurulum.id, kanal, p, temizle };
}

/** Ham istek (gövde Buffer ya da metin); ERİŞİM adresine düzeneğin Access JWT'si eklenir, genel dinleyiciye eklenmez. */
export async function genelIstek(
  taban: string,
  yol: string,
  g: { yontem?: string; govde?: Buffer | string; basliklar?: Record<string, string> } = {},
): Promise<{ status: number; body: Buffer; json: Record<string, unknown>; kod: string | undefined; basliklar: Headers }> {
  const r = await portalFetch(`${taban}${yol}`, { method: g.yontem ?? "GET", headers: g.basliklar ?? {}, ...(g.govde === undefined ? {} : { body: typeof g.govde === "string" ? g.govde : new Uint8Array(g.govde) }) });
  const body = Buffer.from(await r.arrayBuffer());
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: r.status, body, json, kod: (json.details as { code?: string } | undefined)?.code, basliklar: r.headers };
}
