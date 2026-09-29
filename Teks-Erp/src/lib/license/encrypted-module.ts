// Şifreli modül PAKETİ (Faz 2d) — biçim + bellekte açma. Paket: `TKMOD1\n` + 4 bayt başlık boyu +
// başlık JSON + AES-256-GCM şifreli CJS + 16 bayt etiket; AAD = sihir + başlık (modül/kid değiştirilemez).
// Çözülen kod YALNIZ bellekte derlenir (`Module._compile`), diske düz yazılmaz. Paketin çekirdeğe açılan
// kapısı "ev sahibi" haritasıdır: modül kendi dosyaları dışındaki her şeyi (`tekserp-host:<anahtar>`)
// çekirdeğin AYNI örneğinden alır (prisma, zod, express, yardımcılar — ikinci kopya yok).
import crypto from "node:crypto";
import Module from "node:module";
import path from "node:path";
import { z } from "zod";
import { ModuleKeyIdSchema, ModuleKeySchema, b64uDecode, b64uEncode } from "./protocol";
import catalog from "./sifreli-moduller.json";

export const MODULE_PACKAGE_MAGIC = Buffer.from("TKMOD1\n", "utf8");
export const MODULE_PACKAGE_EXT = ".tkmod";
export const MODULE_HOST_PREFIX = "tekserp-host:";

export const ModulePackageHeaderSchema = z.strictObject({
  v: z.literal(1),
  modul: ModuleKeySchema,
  paket: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  surum: z.number().int().min(1),
  kid: ModuleKeyIdSchema,
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  bayt: z.number().int().min(1).max(64 * 1024 * 1024),
  sha256: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type ModulePackageHeader = z.infer<typeof ModulePackageHeaderSchema>;

export interface EncryptedModuleEntry {
  readonly paket: string;
  readonly modul: string;
  readonly ad: string;
  readonly giris: string;
  readonly dosyalar: readonly string[];
  readonly yol: string;
}
export const ENCRYPTED_MODULES: readonly EncryptedModuleEntry[] = catalog.paketler;

/** Derleme tarafı: düz CJS'i paketler (anahtar hazırlıkta 0600 dosyadan). */
export function sealModulePackage(g: { code: Buffer; key: Buffer; modul: string; paket: string; surum: number; kid: string }): Buffer {
  const iv = crypto.randomBytes(12);
  const header: ModulePackageHeader = ModulePackageHeaderSchema.parse({
    v: 1,
    modul: g.modul,
    paket: g.paket,
    surum: g.surum,
    kid: g.kid,
    iv: b64uEncode(iv),
    bayt: g.code.length,
    sha256: b64uEncode(crypto.createHash("sha256").update(g.code).digest()),
  });
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(headerBytes.length);
  const cipher = crypto.createCipheriv("aes-256-gcm", g.key, iv);
  cipher.setAAD(Buffer.concat([MODULE_PACKAGE_MAGIC, headerBytes]));
  return Buffer.concat([MODULE_PACKAGE_MAGIC, size, headerBytes, cipher.update(g.code), cipher.final(), cipher.getAuthTag()]);
}

/** Başlığı okur (anahtarsız); biçimsizse null. */
export function readModulePackageHeader(pkg: Buffer): { header: ModulePackageHeader; headerBytes: Buffer; body: Buffer } | null {
  if (pkg.length < MODULE_PACKAGE_MAGIC.length + 4 || !pkg.subarray(0, MODULE_PACKAGE_MAGIC.length).equals(MODULE_PACKAGE_MAGIC)) return null;
  const size = pkg.readUInt32BE(MODULE_PACKAGE_MAGIC.length);
  const start = MODULE_PACKAGE_MAGIC.length + 4;
  if (size > 4096 || start + size + 16 > pkg.length) return null;
  const headerBytes = pkg.subarray(start, start + size);
  let raw: unknown;
  try {
    raw = JSON.parse(headerBytes.toString("utf8"));
  } catch {
    return null;
  }
  const parsed = ModulePackageHeaderSchema.safeParse(raw);
  return parsed.success ? { header: parsed.data, headerBytes, body: pkg.subarray(start + size) } : null;
}

/** Bellekte çözer; anahtar yanlış/paket kurcalıysa null (GCM etiketi + düz metin özeti). */
export function openModulePackage(pkg: Buffer, key: Buffer): { header: ModulePackageHeader; code: Buffer } | null {
  const read = readModulePackageHeader(pkg);
  const iv = read ? b64uDecode(read.header.iv) : null;
  if (!read || !iv || key.length !== 32) return null;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(Buffer.concat([MODULE_PACKAGE_MAGIC, read.headerBytes]));
    d.setAuthTag(read.body.subarray(read.body.length - 16));
    const code = Buffer.concat([d.update(read.body.subarray(0, read.body.length - 16)), d.final()]);
    const digest = b64uEncode(crypto.createHash("sha256").update(code).digest());
    return code.length === read.header.bayt && digest === read.header.sha256 ? { header: read.header, code } : null;
  } catch {
    return null;
  }
}

type HostMap = Readonly<Record<string, () => unknown>>;

interface CompilableModule {
  filename: string;
  paths: string[];
  exports: unknown;
  require: (id: string) => unknown;
  _compile(code: string, filename: string): void;
}
interface ModuleInternals {
  new (id: string, parent?: unknown): CompilableModule;
  _nodeModulePaths(from: string): string[];
}

/**
 * Çözülmüş CJS'i BELLEKTE derler: dosya adı sanaldır (diskte yok), `tekserp-host:` istekleri ev sahibi
 * haritasından, geri kalanı paketin `node_modules`undan çözülür. Haritada olmayan ev sahibi isteği fırlatır.
 */
export function compileModuleInMemory(g: { code: Buffer; virtualFile: string; host: HostMap }): unknown {
  const Internals = Module as unknown as ModuleInternals;
  const m = new Internals(g.virtualFile, module);
  m.filename = g.virtualFile;
  // Dış bağımlılık (Prisma istemcisi vb.) önce paket dizininden, sonra çekirdeğin kendi yolundan çözülür.
  m.paths = [...new Set([...Internals._nodeModulePaths(path.dirname(g.virtualFile)), ...module.paths])];
  const base = m.require.bind(m);
  m.require = (id: string): unknown => {
    if (!id.startsWith(MODULE_HOST_PREFIX)) return base(id);
    const provide = g.host[id.slice(MODULE_HOST_PREFIX.length)];
    if (!provide) throw new Error(`Şifreli modül ev sahibinde olmayan bir parça istedi: ${id}`);
    return provide();
  };
  m._compile(g.code.toString("utf8"), g.virtualFile);
  g.code.fill(0);
  return m.exports;
}
