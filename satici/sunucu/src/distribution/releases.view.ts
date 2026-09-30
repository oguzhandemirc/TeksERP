// SÜRÜM / KANAL / TERFİ GÖRÜNÜMÜ — güncelleme sunucusunun yayın kökü (`YAYIN_DIZINI`: html/ + defter/)
// satıcıya SALT-OKUNUR bağlıdır; bu modül yalnız OKUR (yazma çağrısı yok). Kanal başına: kanal kaydındaki
// güncel sürümler (kiraya akan) · yayında olan (latest.yml · OTA manifesti · APK künyesi) · yayın defteri
// TSV'si (son satırlar) · imzalı bildirimler. Kök yoksa "ölçülemedi" — boş liste "yayın yok" demek DEĞİLDİR.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Db } from "../lib/prisma";
import { channelVersionsForLease } from "../services/channel.service";
import { listNotices } from "./publications.service";

const CODE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TSV_TAIL_BYTES = 256 * 1024;
const LEDGER_ROWS = 20;

export interface Published {
  readonly surum: string | null;
  readonly degisti: string | null;
}

async function readSmall(file: string, max = 1024 * 1024): Promise<{ text: string; mtime: string } | null> {
  try {
    const s = await stat(file);
    if (!s.isFile() || s.size > max) return null;
    return { text: await readFile(file, "utf8"), mtime: s.mtime.toISOString() };
  } catch {
    return null;
  }
}

/** Panel: electron-builder `latest.yml` içindeki `version:` satırı. */
export async function panelPublished(root: string, code: string): Promise<Published | null> {
  const f = await readSmall(path.join(root, "html", code, "electron", "latest.yml"));
  if (!f) return null;
  return { surum: /^version:\s*(\S+)\s*$/m.exec(f.text)?.[1] ?? null, degisti: f.mtime };
}

/**
 * Backend (Dağıtım v2): `backend/son.json` işaretçisindeki imzalı bildirimin sürümü — İMZASIZ okuma, yalnız
 * görünüm içindir (kurulumun güncelleyicisi imzayı doğrular).
 */
export async function backendPublished(root: string, code: string): Promise<Published | null> {
  const f = await readSmall(path.join(root, "html", code, "backend", "son.json"), 64 * 1024);
  if (!f) return null;
  try {
    const token = (JSON.parse(f.text) as { bildirim?: unknown }).bildirim;
    const payload = typeof token === "string" ? JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { surum?: unknown } : null;
    return { surum: typeof payload?.surum === "string" ? payload.surum : null, degisti: f.mtime };
  } catch {
    return { surum: null, degisti: f.mtime };
  }
}

/** OTA manifesti: çok parçalı gövdede `manifest` parçası (ya da düz JSON) → extra.expoClient.version. */
export function otaVersionOf(body: string): string | null {
  const parts = body.split(/\r?\n?--[A-Za-z0-9'()+_,./:=?-]+(?:--)?\r?\n/);
  const part = parts.find((p) => /name="manifest"/.test(p)) ?? parts[0];
  const start = part?.indexOf("{") ?? -1;
  if (!part || start < 0) return null;
  try {
    const v = (JSON.parse(part.slice(start).trim()) as { extra?: { expoClient?: { version?: unknown } } }).extra?.expoClient?.version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export async function tabletOtaPublished(root: string, code: string): Promise<(Published & { runtime: string })[]> {
  const dir = path.join(root, "html", code, "mobil", "ota");
  const runtimes = await readdir(dir).catch(() => [] as string[]);
  const out: (Published & { runtime: string })[] = [];
  for (const rv of runtimes.filter((r) => /^[0-9][0-9.]{0,19}$/.test(r)).sort()) {
    const f = await readSmall(path.join(dir, rv, "manifest"));
    if (f) out.push({ runtime: rv, surum: otaVersionOf(f.text), degisti: f.mtime });
  }
  return out;
}

export async function tabletApkPublished(root: string, code: string): Promise<(Published & { vc: number | null }) | null> {
  const f = await readSmall(path.join(root, "html", code, "mobil", "apk", "surum.json"));
  if (!f) return null;
  try {
    const j = JSON.parse(f.text) as { versionName?: unknown; versionCode?: unknown };
    return { surum: typeof j.versionName === "string" ? j.versionName : null, vc: typeof j.versionCode === "number" ? j.versionCode : null, degisti: f.mtime };
  } catch {
    return { surum: null, vc: null, degisti: f.mtime };
  }
}

export interface LedgerRow {
  readonly zaman: string;
  readonly surum: string;
  readonly yapan: string;
  readonly sha16: string;
  readonly boyut: string;
  readonly not: string | null;
}

/** Yayın defteri TSV'si (`defter/<kod>-YAYIN-DEFTERI.tsv`; backend `<kod>-BACKEND-YAYIN-DEFTERI.tsv`): son satırlar, en yeni önce. */
export async function ledgerTail(root: string, code: string, rows = LEDGER_ROWS, kind: "" | "BACKEND-" = ""): Promise<LedgerRow[] | null> {
  const file = path.join(root, "defter", `${code}-${kind}YAYIN-DEFTERI.tsv`);
  let text: string;
  try {
    const s = await stat(file);
    const buf = await readFile(file);
    text = buf.subarray(Math.max(0, s.size - TSV_TAIL_BYTES)).toString("utf8");
    if (s.size > TSV_TAIL_BYTES) text = text.slice(text.indexOf("\n") + 1);
  } catch {
    return null;
  }
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => l.split("\t"))
    .filter((c) => c.length >= 5)
    .map((c) => ({ zaman: c[0]!, surum: c[1]!, yapan: c[2]!, sha16: c[3]!, boyut: c[4]!, not: c.length > 5 ? c.slice(5).join(" ") : null }))
    .slice(-rows)
    .reverse();
}

/** Bütün kanallar: kanal tablosu ∪ yayın kökündeki kanal dizinleri. */
export async function releaseOverview(db: Db, root: string | undefined) {
  const channels = await db.kanal.findMany({ orderBy: { kod: "asc" } });
  let mounted = false;
  let dirs: string[] = [];
  if (root) {
    try {
      dirs = (await readdir(path.join(root, "html"))).filter((d) => CODE.test(d));
      mounted = true;
    } catch {
      mounted = false;
    }
  }
  const codes = [...new Set([...channels.map((c) => c.kod), ...dirs])].sort();
  const out = [];
  for (const kod of codes) {
    const k = channels.find((c) => c.kod === kod) ?? null;
    out.push({
      kod,
      kayitli: k ? { ad: k.ad, tur: k.tur, guncelSurumler: channelVersionsForLease(k) } : null,
      yayinda: mounted && root
        ? { panel: await panelPublished(root, kod), tabletOta: await tabletOtaPublished(root, kod), tabletApk: await tabletApkPublished(root, kod), backend: await backendPublished(root, kod) }
        : null,
      defter: mounted && root ? await ledgerTail(root, kod) : null,
      defterBackend: mounted && root ? await ledgerTail(root, kod, LEDGER_ROWS, "BACKEND-") : null,
      bildirimler: await listNotices(db, { channel: kod, limit: 10 }),
    });
  }
  return { yayinKoku: mounted ? "OLCULDU" : root ? "OKUNAMADI" : "BAGLI_DEGIL", kanallar: out };
}
