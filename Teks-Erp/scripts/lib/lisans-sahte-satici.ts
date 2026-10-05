// Lisans bekçilerinin SAHTE SATICISI: yerel HTTPS (öz-imzalı sertifika çalışma anında
// `openssl` ile üretilir, diske yalnız geçici dizine) + yerel CONNECT proxy. Satıcı imzalı
// isteği protokolün KENDİ doğrulayıcısıyla denetler ve gövdeyi KATI şemadan geçirir; yanıt
// belgelerini fikstürün test köküyle basar. `test_` öneki yok → koşucu bunu bekçi saymaz.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ActivateRequestSchema,
  ENDPOINTS,
  HardwareReportRequestSchema,
  OfflineRequestSchema,
  PollRequestSchema,
  REQUEST_HEADER,
  TransferRequestSchema,
  installationKeyId,
  msToIso,
  openEnvelope,
  parseJws,
  readRequestIdentity,
  verifyAcceptance,
  verifyRequest,
  type Fingerprint,
  type EntitlementDoc,
  type LeaseDoc,
  type RequestPurpose,
} from "../../src/lib/license/protocol";
import { hakBas, kiraBas, type Fikstur } from "./lisans-fikstur";

export interface SahteSatici {
  readonly url: string;
  readonly ca: Buffer;
  /** Kabul edilen etkinleştirme kodu. */
  kod: string;
  /** Sonraki kiraların ek alanları (zorlama, yaptırım…). */
  kiraEk: Partial<LeaseDoc>;
  /** Sonraki HAK belgelerinin ek alanları (sınıf, modüller — patron bulutu senaryosu). */
  hakEk: Partial<EntitlementDoc>;
  /** Verilirse HAK yerine bu metin döner (ara imzalı HAK senaryosu); null = `hakBas(f, hakEk)`. */
  hakMetni: string | null;
  /** Her lisans yanıtına konan iptal belgesi (G4 `iptal` alanı); null = alan yok (eski satıcı). */
  iptal: string | null;
  /** >0 ise SIRADAKİ yoklamanın kirası hemen basılır ama yanıtı bu kadar ms bekletilir (yarış sondası). */
  sonrakiYanitGecikmesiMs: number;
  /** Satıcının saati = duvar + bu kayma (D4: ±10 dk dışı istek ISTEK_ZAMAN alır). */
  saatKaymasiMs: number;
  /** Kiranın İMZALI `sunucuSaati` gerçek saatten bu kadar sapar (imzalı saat sapması sondası; verilis gerçek kalır). */
  kiraSaatiKaymasiMs: number;
  /** ISTEK_ZAMAN gövdesine `sunucuSaati` konur mu (false = eski satıcı). */
  sunucuSaatiDondur: boolean;
  /** Dönen `sunucuSaati` gerçek saatinden bu kadar sapar (düzeltilmiş deneme de reddedilsin — "bir kez" sondası). */
  sunucuSaatiYalaniMs: number;
  /** >0 ise zil akışı açıldıktan bu kadar ms sonra satıcı tarafından kapatılır (kesen vekil sondası). */
  zilOmruMs: number;
  /** Taşıma talebinin yanıt durumu (D8: onayda lisans DÖNMEZ). */
  tasimaDurumu: "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI";
  /** Donanım bildiriminin yanıtı (K8): ONAYLANDI yeni kirayla gelir; YOK = eski satıcı (uç yok, 404 BULUNAMADI). */
  donanimDurumu: "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI" | "YOK";
  /** KATI şemadan geçmiş donanım bildirimi gövdeleri. */
  readonly donanimGovdeleri: unknown[];
  readonly sayac: { etkinlestir: number; yokla: number; zil: number; red: number; zaman: number; tasima: number; donanim: number; cevrimdisi: number };
  readonly yoklamaGovdeleri: unknown[];
  /** KATI şemadan geçmiş etkinleştirme gövdeleri (yetenek bildirimi ölçümü). */
  readonly etkinlestirmeGovdeleri: unknown[];
  /**
   * Her imzalı isteğin amacı + taşıdığı kurulum kimliği (null = kimliksiz) + gövdedeki kurulumId + imzadaki `yol`
   * (yok = eski istek) + isteği alan uç (zarfla gelende `/v1/cevrimdisi`).
   */
  readonly istekler: Array<{ amac: RequestPurpose; kimlik: string | null; govdeKimligi: string | null; imzaliYol: string | null; uc: string }>;
  /** Son reddin protokol kodu (`ISTEK_YOL` · `ISTEK_ZAMAN` …); gerçek satıcı gibi `ISTEK_*`/`JWS_*` kodu yanıta da geçer. */
  sonRedKodu: string | null;
  /** Etkinleştirme gövdelerinde gelen kabul belgeleri (gerçek satıcının kapısıyla doğrulanır; kabulsüz → 409 KABUL_GEREKLI). */
  readonly kabuller: string[];
  /** Açık zil akışlarına olay gönderir. */
  zil(konu: string): void;
  /** Etkinleştirmeyle kaydedilen kurulum açık anahtarı (x); henüz yoksa null. */
  kayitliAnahtarX(): string | null;
  kapat(): Promise<void>;
}

function sertifikaUret(): { key: Buffer; cert: Buffer } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisans-sahte-"));
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
      "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"), "-days", "1",
      "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ], { stdio: "ignore" });
    return { key: fs.readFileSync(path.join(dir, "k.pem")), cert: fs.readFileSync(path.join(dir, "c.pem")) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function govdeOku(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const parcalar: Buffer[] = [];
    req.on("data", (c: Buffer) => parcalar.push(c));
    req.on("end", () => resolve(Buffer.concat(parcalar)));
  });
}

function hata(res: http.ServerResponse, status: number, code: string, ek: Record<string, unknown> = {}): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ success: false, message: "sahte satıcı reddetti", details: { code, ...ek } }));
}

/** İmzalı istekteki `yol` — doğrulamadan okunur, yalnız ölçüm için (eski istek taşımaz → null). */
function imzaliYolu(token: unknown): string | null {
  const p = parseJws(token);
  const yol = p.ok ? (p.value.payload as { yol?: unknown }).yol : undefined;
  return typeof yol === "string" ? yol : null;
}

/** Zarftaki imzalı isteğin amacı — gerçek satıcı gibi YALNIZ ucu seçer; imza doğrulaması aynı amacı yeniden şart koşar. */
function zarfAmaci(token: string): string | null {
  const p = parseJws(token);
  const amac = p.ok ? (p.value.payload as { amac?: unknown }).amac : undefined;
  return typeof amac === "string" ? amac : null;
}

/**
 * Kurulum anahtarı: etkinleştirme ve taşımada gövdeden, sonra kayıttan (gerçek satıcının sırası).
 * Kimliksiz istekte bağ koddadır (gerçek satıcı kurulumu koddan bulur): taşınan kimlik bilinen
 * lisans kimliğiyle aynı olmalı. `yol`: isteği alan uç (gerçek satıcının `ENDPOINTS` sabiti; zarfla gelende
 * `/v1/cevrimdisi`) — imzalı `yol` ondan farklıysa `ISTEK_YOL`.
 */
function dogrula(
  token: unknown,
  govde: Buffer,
  amac: RequestPurpose,
  kayitli: string | null,
  g: { lisansKimligi: string; simdi: number; yol: string; amaclar: readonly RequestPurpose[] },
): { ok: boolean; x: string | null; kod: string | null; kimlik: string | null } {
  const kimlik = readRequestIdentity(token);
  if (!kimlik.ok) return { ok: false, x: null, kod: kimlik.code, kimlik: null };
  let x = kayitli;
  if (amac === "etkinlestir" || amac === "tasima") {
    try {
      x = (JSON.parse(govde.toString("utf8")) as { acikAnahtar?: string }).acikAnahtar ?? null;
    } catch {
      x = null;
    }
  }
  if (!x) return { ok: false, x: null, kod: "ISTEK_KID", kimlik: kimlik.value.installationId };
  const v = verifyRequest(token, {
    publicKeyX: x,
    body: govde,
    nowMs: g.simdi,
    purposes: g.amaclar,
    installationId: kimlik.value.installationId === null ? null : g.lisansKimligi,
    path: g.yol,
  });
  return { ok: v.ok, x, kod: v.ok ? null : v.code, kimlik: kimlik.value.installationId };
}

export async function sahteSaticiBaslat(f: Fikstur): Promise<SahteSatici> {
  const { key, cert } = sertifikaUret();
  let kayitliAnahtar: string | null = null;
  const akislar = new Set<http.ServerResponse>();
  const s: Omit<SahteSatici, "url" | "zil" | "kapat" | "kayitliAnahtarX"> & { url: string } = {
    url: "",
    ca: cert,
    kod: "TKS-0000-0000-0000",
    kiraEk: {},
    hakEk: {},
    hakMetni: null,
    iptal: null,
    sonrakiYanitGecikmesiMs: 0,
    saatKaymasiMs: 0,
    kiraSaatiKaymasiMs: 0,
    sunucuSaatiDondur: true,
    sunucuSaatiYalaniMs: 0,
    zilOmruMs: 0,
    tasimaDurumu: "BEKLIYOR",
    donanimDurumu: "BEKLIYOR",
    donanimGovdeleri: [],
    sayac: { etkinlestir: 0, yokla: 0, zil: 0, red: 0, zaman: 0, tasima: 0, donanim: 0, cevrimdisi: 0 },
    yoklamaGovdeleri: [],
    etkinlestirmeGovdeleri: [],
    istekler: [],
    sonRedKodu: null,
    kabuller: [],
  };
  const talepId = randomUUID();
  const lisansYaniti = (parmakIzi: Fingerprint, ek: Record<string, unknown> = {}): string => {
    const simdi = Date.now();
    const kira = kiraBas(f, {
      kiraId: randomUUID(),
      // Kira satıcıda KAYITLI anahtara bağlanır (taşıma koduyla etkinleşen yeni makinede yeni anahtar).
      kurulumAnahtarKimligi: installationKeyId(kayitliAnahtar ?? f.kurulum.x),
      parmakIzi,
      verilis: msToIso(simdi),
      sunucuSaati: msToIso(simdi + s.kiraSaatiKaymasiMs),
      bitis: msToIso(simdi + 29 * 86_400_000),
      zorlama: false,
      ...s.kiraEk,
    });
    const iptal = s.iptal === null ? {} : { iptal: s.iptal };
    return JSON.stringify({ v: 1, hak: s.hakMetni ?? hakBas(f, s.hakEk), kira, indirmeBelirtecleri: [], sunucuSaati: msToIso(simdi), ...iptal, ...ek });
  };
  /** Doğrulanamayan istek: zaman reddinde (D4) satıcı kendi saatini İMZASIZ döner. */
  const reddet = (res: http.ServerResponse, d: { kod: string | null }, simdi: number): void => {
    s.sayac.red++;
    s.sonRedKodu = d.kod;
    if (d.kod === "ISTEK_ZAMAN") {
      s.sayac.zaman++;
      return hata(res, 401, "ISTEK_ZAMAN", s.sunucuSaatiDondur ? { sunucuSaati: msToIso(simdi + s.sunucuSaatiYalaniMs) } : {});
    }
    // Gerçek satıcının `requestRejected`i: protokol imza kodları (`ISTEK_*` · `JWS_*`) olduğu gibi geçer.
    const gecir = d.kod !== null && (d.kod.startsWith("ISTEK_") || d.kod.startsWith("JWS_"));
    return hata(res, 401, gecir && d.kod ? d.kod : "ISTEK_GECERSIZ");
  };
  const sunucu = https.createServer({ key, cert }, (req, res) => {
    void (async () => {
      const hamGovde = await govdeOku(req);
      const yol = (req.url ?? "").split("?")[0];
      const simdi = Date.now() + s.saatKaymasiMs;
      const baglam = { lisansKimligi: f.kurulumId, simdi, yol };
      const baslik = req.headers[REQUEST_HEADER.toLowerCase()];
      if (req.method === "GET" && yol === ENDPOINTS.DOORBELL) {
        const z = dogrula(baslik, hamGovde, "zil", kayitliAnahtar, { ...baglam, amaclar: ["zil"] });
        s.istekler.push({ amac: "zil", kimlik: z.kimlik, govdeKimligi: null, imzaliYol: imzaliYolu(baslik), uc: yol });
        if (!z.ok) return reddet(res, z, simdi);
        s.sayac.zil++;
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" });
        res.write(": merhaba\n\n");
        akislar.add(res);
        req.on("close", () => akislar.delete(res));
        if (s.zilOmruMs > 0) setTimeout(() => res.end(), s.zilOmruMs);
        return;
      }
      // Zarf (çevrimdışı/aktarma): dış istek imzasız, güven içteki imzalı istekten; uç amaca göre seçilir (gerçek satıcı gibi).
      let token: unknown = baslik;
      let govde = hamGovde;
      let amac: RequestPurpose | null =
        yol === ENDPOINTS.ACTIVATE
          ? "etkinlestir"
          : yol === ENDPOINTS.POLL
            ? "yokla"
            : yol === ENDPOINTS.TRANSFER
              ? "tasima"
              : yol === ENDPOINTS.HARDWARE
                ? "donanim"
                : null;
      if (req.method === "POST" && yol === ENDPOINTS.OFFLINE) {
        const dis = OfflineRequestSchema.safeParse(JSON.parse(hamGovde.toString("utf8")) as unknown);
        const zarf = dis.success ? openEnvelope(dis.data.zarf) : null;
        if (!zarf?.ok) return hata(res, 400, "ZARF_BICIM");
        s.sayac.cevrimdisi++;
        token = zarf.value.request;
        govde = zarf.value.body;
        const ic = JSON.parse(govde.toString("utf8")) as Record<string, unknown>;
        amac = zarfAmaci(zarf.value.request) === "donanim" ? "donanim" : "kod" in ic ? "etkinlestir" : "yokla";
      }
      if (req.method !== "POST" || !amac) return hata(res, 404, "YOK");
      const amaclar: RequestPurpose[] = yol === ENDPOINTS.OFFLINE && amac === "yokla" ? ["yokla", "cevrimdisi"] : [amac];
      const d = dogrula(token, govde, amac, kayitliAnahtar, { ...baglam, amaclar });
      const json = JSON.parse(govde.toString("utf8")) as { kurulumId?: unknown };
      s.istekler.push({ amac, kimlik: d.kimlik, govdeKimligi: typeof json.kurulumId === "string" ? json.kurulumId : null, imzaliYol: imzaliYolu(token), uc: yol });
      if (!d.ok) return reddet(res, d, simdi);
      if (amac === "etkinlestir") {
        const b = ActivateRequestSchema.safeParse(json);
        if (!b.success) return hata(res, 400, "GOVDE_GECERSIZ");
        if (b.data.kod !== s.kod) return hata(res, 404, "ETKINLESTIRME_KODU_GECERSIZ");
        // Gerçek satıcının kapısı (Ek-7 §5): kodu tüketecek istek kurulum imzalı kabul belgesi taşımalı.
        const kabul = verifyAcceptance(b.data.kabul, { publicKeyX: b.data.acikAnahtar });
        if (!kabul.ok) return hata(res, 409, "KABUL_GEREKLI", { neden: kabul.neden });
        s.kabuller.push(b.data.kabul ?? "");
        s.etkinlestirmeGovdeleri.push(json);
        s.sayac.etkinlestir++;
        kayitliAnahtar = d.x;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(lisansYaniti(b.data.parmakIzi, { kurulumId: f.kurulumId, kodTuru: "ilk" }));
      }
      if (amac === "tasima") {
        const b = TransferRequestSchema.safeParse(json);
        if (!b.success) return hata(res, 400, "GOVDE_GECERSIZ");
        s.sayac.tasima++;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ v: 1, talepId, durum: s.tasimaDurumu, lisans: null }));
      }
      if (amac === "donanim") {
        if (s.donanimDurumu === "YOK") return hata(res, 404, "BULUNAMADI");
        const b = HardwareReportRequestSchema.safeParse(json);
        if (!b.success) return hata(res, 400, "GOVDE_GECERSIZ");
        s.sayac.donanim++;
        s.donanimGovdeleri.push(json);
        const lisans = s.donanimDurumu === "ONAYLANDI" ? (JSON.parse(lisansYaniti(b.data.parmakIzi)) as unknown) : null;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ v: 1, talepId: randomUUID(), durum: s.donanimDurumu, lisans }));
      }
      const p = PollRequestSchema.safeParse(json);
      s.yoklamaGovdeleri.push(json);
      if (!p.success) return hata(res, 400, "GOVDE_GECERSIZ");
      s.sayac.yokla++;
      const yanit = lisansYaniti(p.data.parmakIzi);
      const gecikme = s.sonrakiYanitGecikmesiMs;
      s.sonrakiYanitGecikmesiMs = 0;
      if (gecikme > 0) await new Promise((r) => setTimeout(r, gecikme));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(yanit);
    })();
  });
  await new Promise<void>((r) => sunucu.listen(0, "127.0.0.1", () => r()));
  const port = (sunucu.address() as net.AddressInfo).port;
  s.url = `https://127.0.0.1:${port}`;
  // Aynı nesne döner: bekçinin `kod`/`kiraEk` yazımları sunucunun okuduğu değerdir.
  return Object.assign(s, {
    kayitliAnahtarX: () => kayitliAnahtar,
    zil(konu: string): void {
      for (const a of akislar) a.write(`event: zil\ndata: ${JSON.stringify({ konu })}\n\n`);
    },
    async kapat(): Promise<void> {
      for (const a of akislar) a.destroy();
      sunucu.closeAllConnections();
      await new Promise<void>((r) => sunucu.close(() => r()));
    },
  }) as SahteSatici;
}

/** Yerel CONNECT proxy — kaç tünel açıldığını sayar (kimlik bilgisi varsa başlığı kaydeder). */
export async function sahteProxyBaslat(): Promise<{ adres: string; tuneller: number; yetkiBasliklari: string[]; kapat(): Promise<void> }> {
  const durum = { tuneller: 0, yetkiBasliklari: [] as string[] };
  // CONNECT sonrası soket HTTP sunucusunun izleminden çıkar: kapanışta elle yok edilir.
  const soketler = new Set<net.Socket>();
  const px = http.createServer((_q, r) => {
    r.writeHead(405);
    r.end();
  });
  px.on("connect", (req: http.IncomingMessage, sock: net.Socket, head: Buffer) => {
    durum.tuneller++;
    const yetki = req.headers["proxy-authorization"];
    if (typeof yetki === "string") durum.yetkiBasliklari.push(yetki);
    const [h, p] = (req.url ?? "").split(":");
    soketler.add(sock);
    sock.on("close", () => soketler.delete(sock));
    const up = net.connect(Number(p), h, () => {
      sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      up.write(head);
      up.pipe(sock);
      sock.pipe(up);
    });
    soketler.add(up);
    up.on("close", () => soketler.delete(up));
    up.on("error", () => sock.destroy());
    sock.on("error", () => up.destroy());
  });
  await new Promise<void>((r) => px.listen(0, "127.0.0.1", () => r()));
  const port = (px.address() as net.AddressInfo).port;
  return {
    adres: `http://127.0.0.1:${port}`,
    get tuneller() {
      return durum.tuneller;
    },
    yetkiBasliklari: durum.yetkiBasliklari,
    kapat: () =>
      new Promise<void>((r) => {
        for (const k of soketler) k.destroy();
        px.closeAllConnections();
        px.close(() => r());
      }),
  };
}
