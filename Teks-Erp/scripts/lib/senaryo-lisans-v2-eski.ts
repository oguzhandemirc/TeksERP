// SENARYO L — L41 eski fabrika (v1 yolu) ↔ yeni satıcı · L42 `ISTEK_YOL` gerçek satıcıya karşı. Tasarım §4.2 ("Yeni satıcı ↔
// eski fabrika": HAK kök imzalı kalır, kira yeni alanları taşır ve eski fabrika onları atar, eski parmak izi kuralı) · protokol
// `yol` (lisans.md:76, arşiv L2-7). Eski fabrika = v1 protokol kodu (L2-1 ebeveyni, `v1ProtokolYukle`) ile kurulan gövde +
// imza; yanıtlar AYNI v1 kodunun doğrulayıcısıyla ölçülür. L42 L41'in kurulumuyla (W) sürer.
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ENDPOINTS, REQUEST_HEADER, msToIso, signRequest, wrapEnvelope } from "../../src/lib/license/protocol";
import type { G4Baglami } from "./senaryo-lisans-v2-g4";
import { HamKurulum, hamGonder, jwsYuku, v1ProtokolYukle, type HamYanit, type V1Belge, type V1Protokol } from "./senaryo-lisans-v2-ham";
import { portalZinciri, type AdimYuzu, type RolFabrika } from "./senaryo-lisans-v2-merdiven";

const W_HAM = { f1: "5e0a00010000400080000000000057f1", f2: "5E0A0002-0000-4000-8000-0000000057F2", f3: "SENARYO-W-DISK-01", f4: "SENARYOW-SYS-01", f5: "7430000000000000057" };
const SURUM = "1.3.1";
const ozet = (y: HamYanit): string => `${y.status}${y.kod ? ` ${y.kod}` : ""}`;

interface EskiFabrika {
  readonly v1: V1Protokol;
  readonly h: HamKurulum;
  readonly hakId: string;
  readonly hakSurum: number;
  sonKiraId: string | null;
  readonly parmakIzi: Record<string, string | null>;
}
/** L41'in kurduğu eski fabrika — L42 aynı kurulumla sürer. */
const durum: { w: EskiFabrika | null; dizin: string | null } = { w: null, dizin: null };

const ORTAM = { platform: "linux", mimari: "x64", isletimSistemi: "Senaryo eski fabrika (v1)", nodeSurum: process.version, uygulamaSurum: SURUM, derlemeTarihi: null, konteyner: false };
const SAGLIK = {
  surum: SURUM,
  calismaSn: 600,
  dbBoyutBayt: null,
  yedek: { hukum: "yapilandirilmamis", yasSaat: null },
  offsite: { yapilandirildi: false, ok: null, eksikSayisi: null },
  diskDolulukYuzde: null,
  auditYazmaHatasi: 0,
  havuzZamanAsimi: 0,
  istemciler: [],
  isHatalari: [],
};

/** v1 yoklama gövdesi (v1 `PollRequestSchema` alanları — yetenek/yol/yeni alan YOK). */
function yoklamaGovdesi(w: EskiFabrika, simdi: number): Record<string, unknown> {
  return {
    v: 1,
    sonKiraId: w.sonKiraId,
    hak: { hakId: w.hakId, surum: w.hakSurum },
    parmakIzi: w.parmakIzi,
    durum: { gecerlilik: "GECERLI", nedenler: [], kip: "gozlem", hesaplananKademe: "NORMAL", uygulananKademe: "NORMAL" },
    saat: { duvar: msToIso(simdi), guvenilir: msToIso(simdi), bulgu: null },
    ortam: ORTAM,
    saglik: SAGLIK,
    gozlem: { reddedilecekIstek: 0, reddedilecekModul: 0 },
  };
}

/** Yanıtı v1 koduyla doğrular: şema · HAK (kök) · kira (ALT zinciri) · bağ; v1'in ATTIĞI yeni alanlar ayrıca listelenir. */
function v1Dogrula(v1: V1Protokol, y: HamYanit, roots: readonly unknown[], oncekiHak: V1Belge | null): { ok: boolean; hak: V1Belge | null; kira: V1Belge | null; kanit: string } {
  const sema = v1.LicenseResponseSchema.safeParse(y.json);
  const hak = y.json.hak ? v1.verifyEntitlement(y.json.hak, roots) : null;
  const kira = v1.verifyLease(y.json.kira, roots);
  const hakBelge = hak?.ok ? (hak.value ?? null) : hak === null ? oncekiHak : null;
  const bag = kira.ok && kira.value && hakBelge ? v1.checkLeaseBinding(kira.value, hakBelge) : { ok: false, code: "HAK_YOK" };
  const atilan = (ham: unknown, cozulen: V1Belge | null | undefined): string[] => (cozulen ? Object.keys(jwsYuku(ham)).filter((k) => !(k in cozulen.document)) : []);
  const ok = sema.success && (hak === null || hak.ok) && kira.ok && bag.ok;
  const kanit =
    `şema=${sema.success ? "ok" : "RED"} hak=${hak === null ? "gelmedi" : hak.ok ? `${hak.value?.signer?.kind}:${hak.value?.signer?.kid}` : `RED ${hak.code}`} ` +
    `kira=${kira.ok ? "ok" : `RED ${kira.code} ${kira.message}`} bağ=${bag.ok ? "ok" : `RED ${bag.code}`} · v1'in attığı alanlar kira=[${atilan(y.json.kira, kira.value).join(",")}] hak=[${atilan(y.json.hak, hak?.value).join(",")}]`;
  return { ok, hak: hakBelge, kira: kira.ok ? (kira.value ?? null) : null, kanit };
}

const kokler = <F extends RolFabrika>(b: G4Baglami<F>): unknown[] => JSON.parse(fs.readFileSync(String(b.saticiEnv.GUVEN_CAPASI_DOSYASI), "utf8")) as unknown[];

// ============================================================ L41
export async function l41EskiFabrika<F extends RolFabrika>(b: G4Baglami<F>, a: AdimYuzu): Promise<void> {
  durum.dizin = fs.mkdtempSync(path.join(os.tmpdir(), "senaryo-v1-"));
  const { v1, neden } = await v1ProtokolYukle(durum.dizin);
  if (!v1) {
    a.kismi(`v1 protokol kodu çıkarılamadı/içe aktarılamadı: ${neden}`);
    return;
  }
  a.not(`eski fabrika = v1 protokol kodu (${neden}; L2-1'in ilk commit'inin ebeveyni) — gövde kurucusu, imza, doğrulayıcı`);
  const z = await portalZinciri(b, a, "W");
  if (!z) return;
  const roots = kokler(b);
  const h = HamKurulum.yeni();
  const parmakIzi = v1.digestFingerprint(W_HAM, h.tuz);
  const metin = v1.ACCEPTANCE_TEXTS[0]!;
  const simdi = b.saticiSimdi();
  const kabulYuku = { v: 1, kabulId: randomUUID(), metin: { kimlik: metin.kimlik, ozet: metin.ozet }, kutular: [...metin.kutular], kabulEden: { kullaniciId: randomUUID(), ad: "Senaryo Eski Fabrika", unvan: "Fabrika Müdürü" }, zaman: msToIso(simdi), istemci: { tur: "panel", surum: null }, sunucuSurum: SURUM };
  const govde = { v: 1, kod: z.kod, acikAnahtar: v1.publicKeyX(h.privateKey), parmakIzi, ortam: ORTAM, kabul: v1.signAcceptance({ payload: kabulYuku, privateKey: h.privateKey }) };
  const sema = v1.ActivateRequestSchema.safeParse(govde);
  const govdeMetni = JSON.stringify(govde);
  const imza = v1.signRequest({ installationId: null, purpose: "etkinlestir", body: govdeMetni, key: { privateKey: h.privateKey, nowMs: simdi } });
  const e = await hamGonder(b.saticiGenel, "/v1/etkinlestir", govdeMetni, { [v1.REQUEST_HEADER]: imza });
  const d1 = v1Dogrula(v1, e, roots, null);
  const kira1 = d1.kira?.document ?? {};
  const kural = jwsYuku(e.json.kira).parmakIziKurali;
  const kiyas = v1.compareFingerprints((kira1.parmakIzi ?? {}) as Record<string, string | null>, parmakIzi);
  a.kontrol(
    "eski fabrika etkinleştirmesi (v1 gövdesi: yetenek/yol/yeni alan YOK; v1 şemasından geçer) → 200; yanıt v1 doğrulayıcısından geçer: HAK KÖK imzalı, kira ALT zinciri + bağ ok; kirada `parmakIziKurali` YOK, v1 parmak izi kararı ESLESTI — §4.2 'HAK kök imzalı kalır · eski parmak izi kuralı'",
    sema.success && e.status === 200 && d1.ok && d1.hak?.signer?.kind === "KOK" && kural === undefined && kiyas.result === "ESLESTI",
    `istek şeması=${sema.success ? "v1 ok" : sema.error?.message} → ${ozet(e)} · ${d1.kanit} · kural=${String(kural)} v1 kararı=${kiyas.result} ${kiyas.matched}/${kiyas.measurable}`,
  );
  if (e.status !== 200 || !d1.hak || !d1.kira) return;
  h.kurulumId = String(d1.kira.document.kurulumId);
  b.kurulumKimligiEkle(h.kurulumId);
  const w: EskiFabrika = { v1, h, hakId: String(d1.hak.document.hakId), hakSurum: Number(d1.hak.document.surum), sonKiraId: String(d1.kira.document.kiraId), parmakIzi };
  durum.w = w;

  const s2 = b.saticiSimdi();
  const yg = yoklamaGovdesi(w, s2);
  const ys = v1.PollRequestSchema.safeParse(yg);
  const ym = JSON.stringify(yg);
  const y = await hamGonder(b.saticiGenel, "/v1/yokla", ym, { [v1.REQUEST_HEADER]: v1.signRequest({ installationId: h.kurulumId, purpose: "yokla", body: ym, key: { privateKey: h.privateKey, nowMs: s2 } }) });
  const d2 = v1Dogrula(v1, y, roots, d1.hak);
  if (d2.kira) w.sonKiraId = String(d2.kira.document.kiraId);
  const pd = await b.detayKurulum(z.dbId);
  const karar = ((pd.kiralar ?? []) as Array<{ id: string; karar: string }>).find((k) => k.id === w.sonKiraId)?.karar;
  const yet = ((pd.kurulum as { yetenekler?: unknown } | undefined)?.yetenekler ?? null) as string[] | null;
  a.kontrol(
    "eski fabrika yoklaması (v1 gövdesi, `yol`suz imza) → 200; yeni kira v1 doğrulayıcısından ve HAK bağından geçer, zincir NORMAL; satıcı kurulumu yeteneksiz görür (kök/eski biçim yolu) — §4.2 SIFIR FARK",
    ys.success && y.status === 200 && d2.ok && karar === "NORMAL" && (yet === null || yet.length === 0),
    `istek şeması=${ys.success ? "v1 ok" : ys.error?.message} → ${ozet(y)} · ${d2.kanit} · portal karar=${String(karar)} yetenekler=[${(yet ?? []).join(",")}]`,
  );
}

// ============================================================ L42
interface Iz {
  readonly y: number;
  readonly u: string | null;
  readonly n: number;
}
const izOzeti = (i: Iz | null): string => (i ? `yoklama=${i.y} uç=${(i.u ?? "-").slice(0, 8)} nonce=${i.n}` : "kurulum yok");
const ayniIz = (a: Iz | null, b: Iz | null): boolean => a !== null && b !== null && a.y === b.y && a.u === b.u && a.n === b.n;

/** Satıcı DB'sinde kurulumun izi: yoklama satırı sayısı · zincir ucu · bu nonce'un defter satırı. */
async function izler<F extends RolFabrika>(b: G4Baglami<F>, kurulumId: string, nonce: string): Promise<Iz | null> {
  const q = await b.db(b.saticiDbUrl).query<{ y: string; u: string | null; n: string }>(
    `SELECT (SELECT count(*) FROM yoklama y WHERE y."kurulumId" = k.id)::text AS y, k."sonKiraId" AS u,
            (SELECT count(*) FROM nonce_defteri d WHERE d.nonce = $2)::text AS n
       FROM kurulum k WHERE k."kurulumId" = $1`,
    [kurulumId, nonce],
  );
  const r = q.rows[0];
  return r ? { y: Number(r.y), u: r.u, n: Number(r.n) } : null;
}

export async function l42IstekYol<F extends RolFabrika>(b: G4Baglami<F>, a: AdimYuzu): Promise<void> {
  const w = durum.w;
  try {
    if (!w || !w.h.kurulumId) {
      a.kismi("L41'in eski fabrika kurulumu yok — imzalı istek kurulamadı");
      return;
    }
    const kurulumId = w.h.kurulumId;
    const imzala = (govde: string, nonce: string, yol: string | null): string =>
      signRequest({ installationId: kurulumId, purpose: "yokla", body: govde, key: { privateKey: w.h.privateKey, nowMs: b.saticiSimdi(), nonce }, ...(yol ? { path: yol } : {}) });
    const ilerle = (y: HamYanit): void => {
      const k = jwsYuku(y.json.kira).kiraId;
      if (y.status === 200 && typeof k === "string") w.sonKiraId = k;
    };
    const govde = JSON.stringify(yoklamaGovdesi(w, b.saticiSimdi()));
    const nonce = randomBytes(16).toString("base64url");

    // (a) zarf (/v1/cevrimdisi) için imzalanmış istek çevrimiçi uca yeniden oynatılır.
    const i0 = await izler(b, kurulumId, nonce);
    const r1 = await hamGonder(b.saticiGenel, ENDPOINTS.POLL, govde, { [REQUEST_HEADER]: imzala(govde, nonce, ENDPOINTS.OFFLINE) });
    const i1 = await izler(b, kurulumId, nonce);
    a.kontrol(
      "X = /v1/cevrimdisi için imzalanmış (yol imzada) istek Y = /v1/yokla ucunda → 401 ISTEK_YOL; iş YAPILMADI (yoklama satırı · zincir ucu · nonce defteri aynı) — lisans.md:76 · arşiv L2-7",
      r1.status === 401 && r1.kod === "ISTEK_YOL" && ayniIz(i0, i1),
      `${ozet(r1)} · önce ${izOzeti(i0)} · sonra ${izOzeti(i1)}`,
    );
    // (b) çevrimiçi uç için imzalanmış istek zarfa konup çevrimdışı uca taşınır.
    const n2 = randomBytes(16).toString("base64url");
    const zarf = JSON.stringify({ v: 1, zarf: wrapEnvelope(imzala(govde, n2, ENDPOINTS.POLL), govde) });
    const j0 = await izler(b, kurulumId, n2);
    const r2 = await hamGonder(b.saticiGenel, ENDPOINTS.OFFLINE, zarf, {});
    const j1 = await izler(b, kurulumId, n2);
    a.kontrol(
      "X = /v1/yokla için imzalanmış istek zarfla Y = /v1/cevrimdisi ucunda → 401 ISTEK_YOL; iş yapılmadı — lisans.md:76",
      r2.status === 401 && r2.kod === "ISTEK_YOL" && ayniIz(j0, j1),
      `${ozet(r2)} · önce ${izOzeti(j0)} · sonra ${izOzeti(j1)}`,
    );
    // (c) kendi ucu: (a)'nın AYNI nonce'u, yol = /v1/yokla → 200 (reddedilen deneme nonce tüketmemişti).
    const r3 = await hamGonder(b.saticiGenel, ENDPOINTS.POLL, govde, { [REQUEST_HEADER]: imzala(govde, nonce, ENDPOINTS.POLL) });
    ilerle(r3);
    const i3 = await izler(b, kurulumId, nonce);
    a.kontrol(
      "kendi ucu: aynı gövde + (a)'nın nonce'u, yol = /v1/yokla → 200, kira verildi; yoklama +1, nonce defterde 1 (reddedilen deneme nonce tüketmemişti)",
      r3.status === 200 && typeof r3.json.kira === "string" && i3 !== null && i1 !== null && i3.y === i1.y + 1 && i3.n === 1 && i3.u !== i1.u,
      `${ozet(r3)} · ${izOzeti(i3)}`,
    );
    // (d) yol taşımayan eski istek (v1 imzası) iki uçta da işler.
    const g4 = JSON.stringify(yoklamaGovdesi(w, b.saticiSimdi()));
    const eski = (): string => w.v1.signRequest({ installationId: kurulumId, purpose: "yokla", body: g4, key: { privateKey: w.h.privateKey, nowMs: b.saticiSimdi() } });
    const r4 = await hamGonder(b.saticiGenel, ENDPOINTS.POLL, g4, { [REQUEST_HEADER]: eski() });
    ilerle(r4);
    const g5 = JSON.stringify(yoklamaGovdesi(w, b.saticiSimdi()));
    const r5 = await hamGonder(b.saticiGenel, ENDPOINTS.OFFLINE, JSON.stringify({ v: 1, zarf: w.v1.wrapEnvelope(w.v1.signRequest({ installationId: kurulumId, purpose: "yokla", body: g5, key: { privateKey: w.h.privateKey, nowMs: b.saticiSimdi() } }), g5) }), {});
    a.kontrol(
      "yol taşımayan eski (v1) istek: /v1/yokla → 200 ve zarfla /v1/cevrimdisi → 200 — lisans.md:76 '`yol` tanımayan/taşımayan istek denetlenmez'",
      r4.status === 200 && r5.status === 200,
      `yokla ${ozet(r4)} · zarf ${ozet(r5)}`,
    );
  } finally {
    if (durum.dizin) fs.rmSync(durum.dizin, { recursive: true, force: true });
  }
}
