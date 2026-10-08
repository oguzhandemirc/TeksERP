// =============================================================================
// OCI / `docker save` ARŞİVİ OKUYUCUSU — Docker'sız, bağımlılıksız (sözleşme 5, GUNCELLEYICI-SAGLAMLIK L3)
// =============================================================================
// Yayıncı (`backend-bildirim.ts`, `linux-x64-oci`) teslim paketindeki imaj arşivini Docker çalıştırmadan ölçer:
// imaj kimliği = config blob'unun sha256'sı (containerd deposunda `.Id` index özetidir, kimlik değil), etiket = RepoTags, son
// katman = imzalı ince katman (`imaj-imzala.mjs`: yalnız `app/butunluk-liste.txt` + imzalı yük). Akış tek geçiştir;
// yalnız küçük girdiler belleğe alınır, büyük katmanlar okunup atılır (950 MB imaj diske açılmaz).
// =============================================================================
import { createHash } from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";

export interface TarGirdisi {
  readonly ad: string;
  /** "dosya" · "dizin" · "bag" (sembolik/sert) · "diger" */
  readonly tip: "dosya" | "dizin" | "bag" | "diger";
  readonly boyut: number;
  readonly veri: Buffer | null;
}

function sekizli(b: Buffer): number {
  // GNU base-256: ilk baytın yüksek biti 1 ise ikili büyük-sonlu sayı.
  if (b[0]! & 0x80) {
    let n = 0;
    for (let i = 1; i < b.length; i += 1) n = n * 256 + b[i]!;
    return n;
  }
  const s = b.toString("ascii").replace(/\0.*$/s, "").trim();
  return s === "" ? 0 : parseInt(s, 8);
}

function cstr(b: Buffer): string {
  const z = b.indexOf(0);
  return b.subarray(0, z < 0 ? b.length : z).toString("utf8");
}

function paxYolu(veri: Buffer): string | null {
  let i = 0;
  let yol: string | null = null;
  while (i < veri.length) {
    const bosluk = veri.indexOf(0x20, i);
    if (bosluk < 0) break;
    const uzunluk = parseInt(veri.subarray(i, bosluk).toString("ascii"), 10);
    if (!Number.isFinite(uzunluk) || uzunluk <= 0) break;
    const kayit = veri.subarray(bosluk + 1, i + uzunluk - 1).toString("utf8");
    const esit = kayit.indexOf("=");
    if (esit > 0 && kayit.slice(0, esit) === "path") yol = kayit.slice(esit + 1);
    i += uzunluk;
  }
  return yol;
}

/**
 * Akışlı tar ayrıştırıcısı: `sakla(ad, boyut)` true ise girdi belleğe alınır, değilse yalnız `ozetle` true ise sha256'sı
 * hesaplanır. Bütün girdiler (veri olmadan) sırayla döner.
 */
export class TarAkisi {
  private parcalar: Buffer[] = [];
  private uzunluk = 0;
  private durum: "baslik" | "veri" | "dolgu" | "son" = "baslik";
  private kalan = 0;
  private dolgu = 0;
  private gecerli: { ad: string; tip: TarGirdisi["tip"]; ham: string; boyut: number; sakla: boolean; hash: ReturnType<typeof createHash> | null; veri: Buffer[] } | null = null;
  private sonrakiAd: string | null = null;
  readonly girdiler: (TarGirdisi & { readonly sha256: string | null })[] = [];

  constructor(
    private readonly sakla: (ad: string, boyut: number) => boolean,
    private readonly ozetle: (ad: string, boyut: number) => boolean = () => false,
  ) {}

  private al(n: number): Buffer {
    const b = Buffer.concat(this.parcalar, this.uzunluk);
    const out = b.subarray(0, n);
    const geri = b.subarray(n);
    this.parcalar = geri.length ? [geri] : [];
    this.uzunluk = geri.length;
    return out;
  }

  yaz(parca: Buffer): void {
    this.parcalar.push(parca);
    this.uzunluk += parca.length;
    for (;;) {
      if (this.durum === "son") {
        this.parcalar = [];
        this.uzunluk = 0;
        return;
      }
      if (this.durum === "baslik") {
        if (this.uzunluk < 512) return;
        this.baslik(this.al(512));
        continue;
      }
      if (this.durum === "veri") {
        if (this.uzunluk === 0) return;
        const n = Math.min(this.kalan, this.uzunluk);
        const b = this.al(n);
        const g = this.gecerli!;
        if (g.hash) g.hash.update(b);
        if (g.sakla) g.veri.push(Buffer.from(b));
        this.kalan -= n;
        if (this.kalan === 0) this.girdiBitti();
        continue;
      }
      if (this.durum === "dolgu") {
        if (this.uzunluk < this.dolgu) return;
        this.al(this.dolgu);
        this.durum = "baslik";
      }
    }
  }

  private baslik(h: Buffer): void {
    if (h.every((x) => x === 0)) {
      this.durum = "son";
      return;
    }
    let ad = cstr(h.subarray(0, 100));
    const onek = h.subarray(257, 262).toString("ascii") === "ustar" ? cstr(h.subarray(345, 500)) : "";
    if (onek) ad = `${onek}/${ad}`;
    const boyut = sekizli(h.subarray(124, 136));
    const t = String.fromCharCode(h[156]!);
    const ozel = t === "x" || t === "g" || t === "L";
    if (!ozel && this.sonrakiAd !== null) {
      ad = this.sonrakiAd;
      this.sonrakiAd = null;
    }
    ad = ad.replace(/^\.\//, "");
    const tip: TarGirdisi["tip"] = t === "0" || t === "\0" || t === "7" ? "dosya" : t === "5" ? "dizin" : t === "1" || t === "2" ? "bag" : "diger";
    const sakla = ozel || (tip === "dosya" && this.sakla(ad, boyut));
    const hash = !ozel && tip === "dosya" && this.ozetle(ad, boyut) ? createHash("sha256") : null;
    this.gecerli = { ad, tip, ham: t, boyut, sakla, hash, veri: [] };
    this.kalan = boyut;
    this.dolgu = (512 - (boyut % 512)) % 512;
    if (boyut === 0) this.girdiBitti();
    else this.durum = "veri";
  }

  private girdiBitti(): void {
    const g = this.gecerli!;
    const veri = g.sakla ? Buffer.concat(g.veri) : null;
    if (g.ham === "x") this.sonrakiAd = paxYolu(veri!) ?? this.sonrakiAd;
    else if (g.ham === "L") this.sonrakiAd = cstr(veri!);
    else if (g.ham !== "g") this.girdiler.push({ ad: g.ad, tip: g.tip, boyut: g.boyut, veri: g.tip === "dosya" ? veri : null, sha256: g.hash ? g.hash.digest("hex") : null });
    this.gecerli = null;
    this.durum = this.dolgu > 0 ? "dolgu" : "baslik";
  }

  bitti(): boolean {
    return this.durum === "son" || (this.durum === "baslik" && this.uzunluk === 0);
  }
}

/** Bellekteki tar (gzip'liyse açılır) → girdiler. */
export function tarOku(veri: Buffer): (TarGirdisi & { readonly sha256: string | null })[] {
  const ham = veri[0] === 0x1f && veri[1] === 0x8b ? zlib.gunzipSync(veri) : veri;
  const t = new TarAkisi(() => true);
  t.yaz(ham);
  if (!t.bitti()) throw new Error("tar yarım (girdi ortasında bitti)");
  return t.girdiler;
}

/** Dosyadaki (gzip'li ya da düz) tar'ı akışla okur. */
export async function tarDosyasiOku(dosya: string, sakla: (ad: string, boyut: number) => boolean, ozetle?: (ad: string, boyut: number) => boolean) {
  const t = new TarAkisi(sakla, ozetle);
  const bas = Buffer.alloc(2);
  const fd = fs.openSync(dosya, "r");
  try {
    fs.readSync(fd, bas, 0, 2, 0);
  } finally {
    fs.closeSync(fd);
  }
  const kaynak = fs.createReadStream(dosya, { highWaterMark: 1 << 20 });
  const akis = bas[0] === 0x1f && bas[1] === 0x8b ? kaynak.pipe(zlib.createGunzip()) : kaynak;
  for await (const parca of akis) t.yaz(parca as Buffer);
  if (!t.bitti()) throw new Error(`tar yarım: ${dosya}`);
  return t.girdiler;
}

/** `docker save` arşivinin ölçümü. */
export interface ImajOlcumu {
  /** `sha256:<64 hex>` — config blob'unun özeti (= `docker image inspect` `.Config` özeti; containerd `.Id`'si DEĞİL). */
  readonly kimlik: string;
  readonly etiketler: readonly string[];
  readonly etiketDegerleri: Readonly<Record<string, string>>;
  readonly platform: string;
  readonly katmanSayisi: number;
  /** Son katmanın girdileri (dizin girdileri dahil) ve dosya içerikleri. */
  readonly sonKatman: readonly TarGirdisi[];
}

/** Son katman bu boyu aşarsa ince imza katmanı değildir (liste ~ dosya başına bir satır). */
const KUCUK_GIRDI = 32 * 1024 * 1024;

/**
 * İmaj arşivini (gzip'li `docker save`) ölçer: tek imaj, config özeti, etiket, son katmanın diff_id'si.
 * Biçim hatası `Error` fırlatır (çağıran DURUR).
 */
export async function imajArsiviOlc(dosya: string): Promise<ImajOlcumu> {
  const girdiler = await tarDosyasiOku(dosya, (_ad, boyut) => boyut <= KUCUK_GIRDI, (ad) => /^blobs\/sha256\/[0-9a-f]{64}$|\/layer\.tar$|^[0-9a-f]{64}\.json$/.test(ad));
  const ad = new Map(girdiler.map((g) => [g.ad, g]));
  const mj = ad.get("manifest.json")?.veri;
  if (!mj) throw new Error("imaj arşivinde manifest.json yok (docker save çıktısı değil)");
  const manifest = JSON.parse(mj.toString("utf8")) as { Config?: string; RepoTags?: string[]; Layers?: string[] }[];
  if (!Array.isArray(manifest) || manifest.length !== 1) throw new Error(`imaj arşivi TEK imaj taşımalı (${Array.isArray(manifest) ? manifest.length : "biçimsiz"})`);
  const m = manifest[0]!;
  const config = m.Config ? ad.get(m.Config)?.veri : null;
  if (!config || !Array.isArray(m.Layers) || m.Layers.length === 0) throw new Error("imaj arşivinde config ya da katman listesi yok");
  const kimlik = `sha256:${createHash("sha256").update(config).digest("hex")}`;
  const c = JSON.parse(config.toString("utf8")) as { os?: string; architecture?: string; config?: { Labels?: Record<string, string> }; rootfs?: { diff_ids?: string[] } };
  const diff = c.rootfs?.diff_ids ?? [];
  if (diff.length !== m.Layers.length) throw new Error(`config diff_ids (${diff.length}) ≠ katman sayısı (${m.Layers.length})`);
  const sonAd = m.Layers[m.Layers.length - 1]!;
  const son = ad.get(sonAd);
  if (!son) throw new Error(`son katman arşivde yok: ${sonAd}`);
  if (!son.veri) throw new Error(`son katman ${son.boyut} bayt — ince imza katmanı değil (imzasız taban mı?)`);
  const ham = son.veri[0] === 0x1f && son.veri[1] === 0x8b ? zlib.gunzipSync(son.veri) : son.veri;
  const sonDiff = `sha256:${createHash("sha256").update(ham).digest("hex")}`;
  if (sonDiff !== diff[diff.length - 1]) throw new Error(`son katmanın özeti config diff_id'siyle tutmuyor (${sonDiff.slice(0, 19)}… ≠ ${String(diff[diff.length - 1]).slice(0, 19)}…)`);
  return {
    kimlik,
    etiketler: m.RepoTags ?? [],
    etiketDegerleri: c.config?.Labels ?? {},
    platform: `${c.os}/${c.architecture}`,
    katmanSayisi: m.Layers.length,
    sonKatman: tarOku(ham),
  };
}
