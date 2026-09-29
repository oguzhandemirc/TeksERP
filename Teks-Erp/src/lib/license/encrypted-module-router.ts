// Şifreli modülün KAPISI (Faz 2d): korumalı + şifreli derlemede modülün giriş importu bu kapıya
// çevrilir (build-korumali.mjs eklentisi); geliştirmede ve şifresiz pakette bu dosya hiç bağlanmaz.
// Sıra: kimlik (401) → modül kapısı (MODULE_DISABLED / tavan LICENSE_MODULE) → anahtar. Anahtar yoksa
// 403 LICENSE_MODULE (`details.modul`, `neden: ANAHTAR_YOK`) — tavan kapısıyla AYNI yüzey.
import fs from "node:fs";
import path from "node:path";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requireDepoMultiEnabled } from "../../middlewares/module.middleware";
import type { AppError } from "../../utils/app-error";
import { licenseModuleKeyError } from "./module-ceiling";
import { uyari } from "../logger";
import { ENCRYPTED_MODULES, MODULE_PACKAGE_EXT, compileModuleInMemory, openModulePackage, readModulePackageHeader, type EncryptedModuleEntry } from "./encrypted-module";
import { unlockModuleKey, type ModuleKeyOutcome } from "./module-unlock";

type HostMap = Readonly<Record<string, () => unknown>>;

/** Modül kapısı (izin/bayrak + lisans tavanı) — jenerik kapı yasak, modül başına adlı kapı. */
const MODULE_GATES: Readonly<Record<string, RequestHandler>> = {
  "depo.multiEnabled": requireDepoMultiEnabled,
};

export interface EncryptedModuleOptions {
  /** Paket dizini (varsayılan: çekirdek paketin yanındaki `moduller/`). */
  readonly packageDir?: string;
  /** Ev sahibi haritası (varsayılan: derlemenin sanal `tekserp:module-host` modülü). */
  readonly host?: HostMap;
  readonly unlock?: (modul: string, kid: string) => ModuleKeyOutcome;
}

export type LoadOutcome = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string };

const gates: ModuleLoader[] = [];

function defaultHost(): HostMap {
  // Yalnız şifreli derlemede var: eklenti modülün çekirdekten aldığı her parçayı buraya bağlar.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("tekserp:module-host") as HostMap;
}

function routerOf(exports: unknown): RequestHandler | null {
  const candidate = typeof exports === "object" && exports !== null && "default" in exports ? exports.default : exports;
  return typeof candidate === "function" ? (candidate as RequestHandler) : null;
}

/** Anahtar yoksa: tavan kapısıyla AYNI yüzey (403 `LICENSE_MODULE`, `details.modul`) — kod tek dosyada doğar. */
export function moduleKeyMissingError(entry: EncryptedModuleEntry, why: string): AppError {
  return licenseModuleKeyError(entry.modul, entry.ad, why);
}

export interface ModuleLoader {
  readonly entry: EncryptedModuleEntry;
  tryLoad(): LoadOutcome;
  /** Anahtar kapısı + yüklenen yönlendiriciye devir (kimlik ve modül kapısından SONRA bağlanır). */
  readonly handler: RequestHandler;
}

/** Paket → anahtar (kiradan) → bellekte çöz → derle. Başarı önbelleğe alınır; başarısızlık her istekte yeniden denenir. */
export function createModuleLoader(paket: string, opts: EncryptedModuleOptions = {}): ModuleLoader {
  const entry = ENCRYPTED_MODULES.find((e) => e.paket === paket);
  if (!entry) throw new Error(`Şifreli modül kataloğunda yok: ${paket}`);
  const file = path.join(opts.packageDir ?? path.join(__dirname, "moduller"), `${entry.paket}${MODULE_PACKAGE_EXT}`);
  let loaded: RequestHandler | null = null;
  const tryLoad = (): LoadOutcome => {
    if (loaded) return { ok: true };
    let pkg: Buffer;
    try {
      pkg = fs.readFileSync(file);
    } catch {
      return { ok: false, code: "PAKET_YOK", message: `${entry.ad} modül paketi bulunamadı` };
    }
    const read = readModulePackageHeader(pkg);
    if (!read || read.header.modul !== entry.modul || read.header.paket !== entry.paket) {
      return { ok: false, code: "PAKET_BICIM", message: `${entry.ad} modül paketi biçimsiz` };
    }
    const key = (opts.unlock ?? unlockModuleKey)(entry.modul, read.header.kid);
    if (!key.ok) return { ok: false, code: key.code, message: key.message };
    const opened = openModulePackage(pkg, key.key);
    key.key.fill(0);
    if (!opened) return { ok: false, code: "PAKET_ACILAMADI", message: `${entry.ad} modül paketi bu anahtarla açılamadı` };
    const exported = compileModuleInMemory({ code: opened.code, virtualFile: file.replace(/\.tkmod$/, ".js"), host: opts.host ?? defaultHost() });
    const handler = routerOf(exported);
    if (!handler) return { ok: false, code: "PAKET_GIRIS", message: `${entry.ad} modülü yönlendirici dışa aktarmıyor` };
    loaded = handler;
    return { ok: true };
  };
  const handler = (req: Request, res: Response, next: NextFunction): void => {
    let r: LoadOutcome;
    try {
      r = tryLoad();
    } catch (err) {
      next(err);
      return;
    }
    if (!r.ok || !loaded) {
      next(moduleKeyMissingError(entry, r.ok ? "PAKET_GIRIS" : r.code));
      return;
    }
    loaded(req, res, next);
  };
  return { entry, tryLoad, handler };
}

export function encryptedModuleRouter(paket: string, opts: EncryptedModuleOptions = {}): Router {
  const loader = createModuleLoader(paket, opts);
  const moduleGate = MODULE_GATES[loader.entry.modul];
  if (!moduleGate) throw new Error(`Şifreli modülün kapısı tanımsız: ${loader.entry.modul}`);
  gates.push(loader);
  const router = Router();
  router.use(verifyToken, moduleGate, loader.handler);
  return router;
}

/** Açılışta (lisans deposu yüklendikten sonra) anahtarı olan modülleri önceden yükler — belge kurucuları kaydolsun. */
export function preloadEncryptedModules(): void {
  for (const g of gates) {
    try {
      const r = g.tryLoad();
      if (!r.ok) uyari("lisans", `${g.entry.ad} şifreli modülü yüklenmedi (${r.code}) — ilk kullanımda yeniden denenir`);
    } catch (err) {
      uyari("lisans", `${g.entry.ad} şifreli modülü yüklenirken hata — ilk kullanımda yeniden denenir`, err);
    }
  }
}
