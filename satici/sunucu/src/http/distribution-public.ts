// GENEL DİNLEYİCİ — dağıtım uçları (Faz 3d). Yetki BELİRTEÇTİR: bilinmeyen/biçimsiz belirteç 404 (hangi
// belirtecin var olduğu sızmaz), süresi/hakkı biten ya da iptal edilen 410. Hepsi IP başına hız sınırlı.
//   GET  /d/:b        açılış sayfası (hak TÜKETMEZ)      POST /d/:b   indir (hak tüketir, sonra akış)
//   GET  /y/:b        yükleme sayfası                    GET  /y/:b/durum
//   POST /y/:b/oturum başlat/sürdür (işlem kimliği)      GET  /y/:b/oturum/:id   alınan parçalar
//   PUT  /y/:b/oturum/:id/parca/:sira  (ham gövde ≤ PARCA_AZAMI_MB, başlık X-Parca-Sha256)
//   POST /y/:b/oturum/:id/tamamla      POST /yayin/bildirim (yayıncı imzalı)
import type { FileHandle } from "node:fs/promises";
import { open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import { claimDownload, resolveDownload, type DownloadTarget } from "../distribution/links.service";
import { publicRequestView, resolveUploadRequest } from "../distribution/requests.service";
import { completeSession, sessionState, startSession, writePart, type SessionOwner } from "../distribution/sessions.service";
import { NOTICE_SIGNATURE_HEADER, recordNotice, verifyNotice } from "../distribution/publications.service";
import { MIB } from "../distribution/view";
import { VendorError, notFoundError } from "../lib/errors";
import type { VendorContext } from "../services/context";
import { parseStrict, rawBodyOf } from "./body";
import { clientAddress, proxyTrustFrom } from "./client-address";
import { sendDownloadPage, sendUploadPage } from "./distribution-pages";
import { rateLimit } from "./rate-limit";

const StartBody = z.strictObject({
  clientToken: z.uuid(),
  dosyaAdi: z.string().min(1).max(400),
  boyut: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mime: z.string().max(100).optional(),
});

function param(req: Request, name: string): string {
  const v = req.params[name];
  return typeof v === "string" ? v : "";
}

function uuidParam(req: Request, name: string): string {
  const v = param(req, name);
  if (!z.uuid().safeParse(v).success) throw notFoundError("Yükleme oturumu");
  return v;
}

/** RFC 6266: ASCII yedek ad + UTF-8 ad. */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function hashHandle(fh: FileHandle): Promise<string> {
  const { createHash } = await import("node:crypto");
  const h = createHash("sha256");
  for await (const chunk of fh.createReadStream({ start: 0, autoClose: false })) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** Gövdeyi açık tanıtıcıdan akıtır; tanıtıcı açıkken gövde budansa da okuma sürer (POSIX). */
export async function streamFile(res: Response, fh: FileHandle, t: Pick<DownloadTarget, "name" | "mime" | "bytes">): Promise<void> {
  res.status(200).set({
    "Content-Type": t.mime,
    "Content-Length": String(t.bytes),
    "Content-Disposition": contentDisposition(t.name),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  try {
    await pipeline(fh.createReadStream({ start: 0, autoClose: true }), res);
  } catch {
    // İstemci indirmeyi yarıda kesti: hak indirme BAŞINDA tüketildi (belgeli); bağlantı kapatılır, hata günlüğe taşınmaz.
    res.destroy();
  }
}

/** Diskteki gövde bağlantının beklediği gövde mi (boyut + özet)? Değilse hak TÜKETİLMEDEN 410. */
export async function openVerified(t: DownloadTarget): Promise<FileHandle> {
  const fh = await open(t.path, "r").catch(() => null);
  if (!fh) throw new VendorError(410, "GOVDE_BUDANDI", "Dosya artık sunucuda değil; yeni bağlantı isteyin");
  try {
    const st = await fh.stat();
    if (st.size !== t.bytes || (await hashHandle(fh)) !== t.sha256) {
      throw new VendorError(410, "BAGLANTI_GECERSIZ", "Dosya bağlantı verildikten sonra değişmiş; yeni bağlantı isteyin");
    }
    return fh;
  } catch (err) {
    await fh.close();
    throw err;
  }
}

export function mountDistributionPublic(app: Express, ctx: VendorContext): void {
  const trust = proxyTrustFrom(ctx.config);
  const limited = rateLimit({ perMinute: ctx.config.DAGITIM_HIZ_IP_DK, trust });
  const json = express.json({ limit: "16kb", strict: true });
  const noStore = (_req: Request, res: Response, next: () => void): void => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    next();
  };
  app.use(["/d", "/y", "/yayin"], limited, noStore);

  app.get("/d/:b", async (req, res) => {
    const t = await resolveDownload(ctx, param(req, "b"), Date.now());
    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }
    sendDownloadPage(res, param(req, "b"), {
      name: t.name,
      bytes: t.bytes,
      expiresAt: t.link.bitis,
      remaining: t.link.azamiIndirme - t.link.indirmeSayisi,
      firstInstall: t.link.tur === "ILK_KURULUM",
    });
  });

  app.post("/d/:b", async (req, res) => {
    const nowMs = Date.now();
    const t = await resolveDownload(ctx, param(req, "b"), nowMs);
    const fh = await openVerified(t);
    try {
      await claimDownload({ linkId: t.link.id, nowMs, client: clientAddress(req, trust) });
    } catch (err) {
      await fh.close();
      throw err;
    }
    await streamFile(res, fh, t);
  });

  const owner = async (req: Request, nowMs: number): Promise<SessionOwner> => {
    const request = await resolveUploadRequest(ctx, param(req, "b"), nowMs);
    return { kind: "ISTEK", request, actor: `musteri:yukleme/${request.belirtecSonu}` };
  };

  app.get("/y/:b", async (req, res) => {
    await resolveUploadRequest(ctx, param(req, "b"), Date.now());
    sendUploadPage(res);
  });
  app.get("/y/:b/durum", async (req, res) => {
    const request = await resolveUploadRequest(ctx, param(req, "b"), Date.now());
    res.json({ success: true, data: publicRequestView(request, ctx.config.PARCA_AZAMI_MB * MIB) });
  });
  app.post("/y/:b/oturum", json, async (req, res) => {
    const nowMs = Date.now();
    const o = await owner(req, nowMs);
    const b = parseStrict(StartBody, req.body ?? {});
    const data = await startSession(ctx.config, { owner: o, clientToken: b.clientToken, name: b.dosyaAdi, mime: b.mime, size: b.boyut, sha256: b.sha256 }, nowMs);
    res.status(200).json({ success: true, data });
  });
  app.get("/y/:b/oturum/:id", async (req, res) => {
    res.json({ success: true, data: await sessionState(await owner(req, Date.now()), uuidParam(req, "id")) });
  });
  app.put("/y/:b/oturum/:id/parca/:sira", async (req, res) => {
    const nowMs = Date.now();
    const data = await writePart(ctx.config, {
      owner: await owner(req, nowMs),
      sessionId: uuidParam(req, "id"),
      index: /^\d{1,6}$/.test(param(req, "sira")) ? Number(param(req, "sira")) : -1,
      sha256: String(req.get("x-parca-sha256") ?? ""),
      body: req,
      nowMs,
    });
    res.json({ success: true, data });
  });
  app.post("/y/:b/oturum/:id/tamamla", json, async (req, res) => {
    const nowMs = Date.now();
    const file = await completeSession(ctx.config, { owner: await owner(req, nowMs), sessionId: uuidParam(req, "id"), nowMs });
    res.json({ success: true, data: { dosyaId: file.id, ad: file.ad, boyut: Number(file.boyut), sha256: file.sha256 } });
  });

  app.post("/yayin/bildirim", express.raw({ type: () => true, limit: "16kb" }), async (req, res) => {
    const { notice } = await verifyNotice(rawBodyOf(req.body), req.get(NOTICE_SIGNATURE_HEADER), Date.now());
    const { row, tekrar } = await recordNotice(notice);
    res.status(tekrar ? 200 : 201).json({ success: true, data: { id: row.id, bildirimKimligi: row.bildirimKimligi, tekrar } });
  });
}
