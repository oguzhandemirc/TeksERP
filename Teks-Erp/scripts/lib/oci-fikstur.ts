// =============================================================================
// SENTETİK `backend-oci` TESLİM PAKETİ — yalnız bekçiler için (Docker'sız; GUNCELLEYICI-SAGLAMLIK L3)
// =============================================================================
// `docker save` biçiminde küçük bir imaj arşivi (taban katmanı + `imaj-imzala.mjs` gibi ince imza katmanı, config
// label'ları, RepoTags) ve `teslim-paketle.sh` biçiminde dış tar kurar; biçim sabitleri `oci-paket.ts`ten (tek kaynak).
// Bozulmuş varyantlar (`bozulma`) yayıncının DUR yollarını ölçmek içindir. İmzalar GERÇEK imza aracıyla atılır.
// =============================================================================
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { signManifestDocument, signPackageDirectory, type SigningKey } from "./butunluk-imza";
import type { RootKey } from "../../src/lib/license/protocol";
import { OCI_GUNCELLEYICI, OCI_GUNCELLEYICI_KUNYE, OCI_IMAJ_ADI, OCI_KUNYE, OCI_KUNYE_URUN, OCI_PLATFORM, ociImajArsivi, ociKapsam, ociPaketAdi, ociUyeler } from "./oci-paket";

/** Düz ustar arşivi (yalnız düz dosya + dizin; adlar ≤ 100 bayt). */
export function ustar(girdiler: readonly { readonly ad: string; readonly veri?: Buffer; readonly dizin?: boolean }[]): Buffer {
  const parca: Buffer[] = [];
  for (const g of girdiler) {
    const veri = g.dizin ? Buffer.alloc(0) : (g.veri ?? Buffer.alloc(0));
    const h = Buffer.alloc(512);
    if (Buffer.byteLength(g.ad) > 100) throw new Error(`ustar adı uzun: ${g.ad}`);
    h.write(g.ad, 0, "utf8");
    h.write(g.dizin ? "0000755\0" : "0000644\0", 100, "ascii");
    h.write("0000000\0", 108, "ascii");
    h.write("0000000\0", 116, "ascii");
    h.write(`${veri.length.toString(8).padStart(11, "0")}\0`, 124, "ascii");
    h.write("00000000000\0", 136, "ascii");
    h.write("        ", 148, "ascii");
    h.write(g.dizin ? "5" : "0", 156, "ascii");
    h.write("ustar\0", 257, "ascii");
    h.write("00", 263, "ascii");
    let toplam = 0;
    for (const b of h) toplam += b;
    h.write(`${toplam.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
    parca.push(h, veri, Buffer.alloc((512 - (veri.length % 512)) % 512));
  }
  parca.push(Buffer.alloc(1024));
  return Buffer.concat(parca);
}

const hex = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

export type OciBozulma = "imzasiz-taban" | "label-yok" | "kimlik-uyusmaz" | "etiket-uyusmaz" | null;

export interface OciFiksturGirdisi {
  readonly dizin: string;
  readonly surum: string;
  readonly commit: string;
  /** İç (imaj içi) ve dış (künye) imzayı atan zincirli anahtar + kök imzalı PAKET sertifikası. */
  readonly anahtar: SigningKey;
  readonly sertifika: string;
  readonly kokler: readonly RootKey[];
  readonly composeSablonu: string;
  readonly envOrnek: string;
  readonly bozulma?: OciBozulma;
  readonly ciKokeni?: Record<string, unknown> | null;
}

/** Dış tar'ın yolu döner (`<dizin>/tekserp-backend-oci-<sürüm>.tar`). */
export async function ociFiksturKur(g: OciFiksturGirdisi): Promise<{ readonly tar: string; readonly kimlik: string }> {
  const kok = path.join(g.dizin, `oci-${g.surum}-${g.bozulma ?? "temiz"}`);
  const app = path.join(kok, "app");
  fs.mkdirSync(path.join(app, "dist"), { recursive: true });
  fs.mkdirSync(path.join(app, "prisma/migrations/20260101000000_ilk"), { recursive: true });
  fs.writeFileSync(path.join(app, "dist/server.js"), `console.log(${JSON.stringify(g.surum)});\n`);
  fs.writeFileSync(path.join(app, "package.json"), `${JSON.stringify({ name: "teks-erp", version: g.surum })}\n`);
  fs.writeFileSync(path.join(app, "prisma/migrations/20260101000000_ilk/migration.sql"), "SELECT 1;\n");
  const tabanGirdi = ["dist/server.js", "package.json", "prisma/migrations/20260101000000_ilk/migration.sql"].map((f) => ({ ad: `app/${f}`, veri: fs.readFileSync(path.join(app, f)) }));
  const taban = ustar([{ ad: "app/", dizin: true }, ...tabanGirdi]);
  await signPackageDirectory({ root: app, key: g.anahtar, certificate: g.sertifika, roots: g.kokler, urun: OCI_KUNYE_URUN, surum: g.surum, derlemeTarihi: "2026-09-30T10:00:00.000Z", musteri: null, ...(g.ciKokeni ? { ciKokeni: g.ciKokeni } : {}) });
  const imzaDosyalari = fs.readdirSync(app).filter((f) => /^butunluk/.test(f)).sort();
  const ince = ustar([{ ad: "app/", dizin: true }, ...imzaDosyalari.map((f) => ({ ad: `app/${f}`, veri: fs.readFileSync(path.join(app, f)) }))]);
  const katmanlar = g.bozulma === "imzasiz-taban" ? [taban] : [taban, ince];
  const etiket = `${OCI_IMAJ_ADI}:${g.surum}`;
  const config = Buffer.from(JSON.stringify({
    architecture: "amd64",
    os: "linux",
    config: { Labels: { "tr.tekserp.imaj": "korumali", "org.opencontainers.image.revision": g.commit, ...(g.bozulma === "label-yok" ? {} : { "tr.tekserp.butunluk": g.anahtar.kid }) } },
    rootfs: { type: "layers", diff_ids: katmanlar.map((k) => `sha256:${hex(k)}`) },
  }));
  const blob = (b: Buffer) => ({ ad: `blobs/sha256/${hex(b)}`, veri: b });
  const manifest = Buffer.from(JSON.stringify([{ Config: `blobs/sha256/${hex(config)}`, RepoTags: [g.bozulma === "etiket-uyusmaz" ? `${OCI_IMAJ_ADI}:baska` : etiket], Layers: katmanlar.map((k) => `blobs/sha256/${hex(k)}`) }]));
  const imaj = zlib.gzipSync(ustar([{ ad: "blobs/", dizin: true }, { ad: "blobs/sha256/", dizin: true }, blob(config), ...katmanlar.map(blob), { ad: "manifest.json", veri: manifest }]));
  const kimlik = `sha256:${hex(config)}`;

  const sahne = path.join(kok, "sahne");
  fs.mkdirSync(sahne, { recursive: true });
  const arsiv = ociImajArsivi(g.surum);
  fs.writeFileSync(path.join(sahne, arsiv), imaj);
  fs.writeFileSync(path.join(sahne, "docker-compose.yml"), g.composeSablonu.replaceAll("@@SURUM@@", g.surum));
  fs.writeFileSync(path.join(sahne, ".env.ornek"), g.envOrnek);
  // linux-x64 ELF başlığı (e_ident ELF64 LE · e_machine 0x3E); içerik çalıştırılmaz.
  const elf = Buffer.alloc(64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(elf);
  elf.writeUInt16LE(2, 16);
  elf.writeUInt16LE(0x3e, 18);
  fs.writeFileSync(path.join(sahne, OCI_GUNCELLEYICI), elf, { mode: 0o755 });
  const gSurum = "0.9.0";
  fs.writeFileSync(path.join(sahne, OCI_GUNCELLEYICI_KUNYE), `${JSON.stringify({ ad: "tekserp-guncelleyici", surum: gSurum, hedef: "linux", testCapasi: false, capaKipi: "uretim" })}\n`);
  const kunye = {
    v: 1, paketId: randomUUID(), urun: OCI_KUNYE_URUN, surum: g.surum, derlemeTarihi: "2026-09-30T10:00:00.000Z", musteri: null,
    commit: g.commit, platform: OCI_PLATFORM, gocSayisi: 1,
    imaj: { etiket, kimlik: g.bozulma === "kimlik-uyusmaz" ? `sha256:${"0".repeat(64)}` : kimlik, platform: "linux/amd64", arsiv, butunlukKid: g.anahtar.kid },
    sunucu: { nodeSurum: "24.18.0", v8Taban: "13.6.233.17", jscSha256: "0".repeat(64), nativeZorunlu: true },
    guncelleyici: { surum: gSurum, sha256: hex(elf) },
    kapsam: { dizinler: [], dosyalar: ociKapsam(g.surum) },
  };
  fs.writeFileSync(path.join(sahne, OCI_KUNYE), `${JSON.stringify(kunye, null, 2)}\n`);
  await signManifestDocument(path.join(sahne, OCI_KUNYE), g.anahtar, { certificate: g.sertifika, roots: g.kokler });
  const ozetler = ociUyeler(g.surum).filter((u) => u !== "SHA256SUMS").map((u) => `${hex(fs.readFileSync(path.join(sahne, u)))}  ${u}`);
  fs.writeFileSync(path.join(sahne, "SHA256SUMS"), `${ozetler.join("\n")}\n`);
  const tar = path.join(g.dizin, `${g.bozulma ?? "temiz"}-${g.surum}`, ociPaketAdi(g.surum));
  fs.mkdirSync(path.dirname(tar), { recursive: true });
  fs.writeFileSync(tar, ustar(ociUyeler(g.surum).map((u) => ({ ad: u, veri: fs.readFileSync(path.join(sahne, u)) }))));
  return { tar, kimlik };
}
