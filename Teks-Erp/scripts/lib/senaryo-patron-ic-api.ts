// SENARYO P — SAHTE SATICI İÇ API'si (bulut → satıcı; iç ağ, bearer). Gerçek satıcıda `/ic/v1/*` henüz
// YOK (satıcı dilimi ayrı); bulut `KURULUM_KAYNAGI=satici` kipinde bu sözleşmeyi ister (`patron/sunucu/
// src/wire/satici-ic.ts`). İki uç: kurulum kaydı (açık anahtar · sınıf · modüller · abonelik bitişi) ve
// kapı zili (bulut → sahte satıcının SSE akışına aktarılır). `test_` öneki yok → bekçi değil.
import { randomBytes } from "node:crypto";
import http from "node:http";
import type net from "node:net";

export interface IcKurulum {
  kurulumId: string;
  tesis: { id: string; ad: string };
  acikAnahtar: string | null;
  sinif: "URETIM" | "TEST" | "DR" | "DEMO" | "BAYI" | "BARINDIRILAN";
  moduller: string[];
  patronBulutBitis: string | null;
  devredildi: boolean;
  aktif: boolean;
  saklamaAy?: 3 | 13 | 25 | null;
}

export interface IcApi {
  readonly url: string;
  readonly belirtec: string;
  readonly kurulumlar: Map<string, IcKurulum>;
  /** Bulutun çaldığı ziller (sırayla) — kanıt. */
  readonly ziller: Array<{ tesisId: string; konu: string; at: number }>;
  /** Kurulum kaydı isteği sayacı (önbellek tazeliği kanıtı). */
  readonly sayac: { kurulum: number; zil: number; red: number };
  kapat(): Promise<void>;
}

/**
 * `zilAktar(tesisId, konu)` sahte satıcının açık SSE akışlarına iletir; iletilmediyse (tesis tanınmıyor)
 * iç API yine 202 döner — gerçek satıcı da zili best-effort iletir.
 */
export async function icApiBaslat(zilAktar: (tesisId: string, konu: string) => void): Promise<IcApi> {
  const belirtec = randomBytes(24).toString("hex");
  const kurulumlar = new Map<string, IcKurulum>();
  const ziller: IcApi["ziller"] = [];
  const sayac = { kurulum: 0, zil: 0, red: 0 };
  const sunucu = http.createServer((req, res) => {
    const parcalar: Buffer[] = [];
    req.on("data", (c: Buffer) => parcalar.push(c));
    req.on("end", () => {
      const yol = new URL(req.url ?? "/", "http://ic").pathname;
      if (req.headers.authorization !== `Bearer ${belirtec}`) {
        sayac.red++;
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ success: false, message: "yetkisiz" }));
      }
      const k = /^\/ic\/v1\/kurulum\/([0-9a-f-]{36})$/.exec(yol);
      if (req.method === "GET" && k) {
        sayac.kurulum++;
        const kayit = kurulumlar.get(k[1]);
        if (!kayit) {
          res.writeHead(404, { "content-type": "application/json" });
          return res.end(JSON.stringify({ success: false }));
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ v: 1, ...kayit }));
      }
      if (req.method === "POST" && yol === "/ic/v1/zil") {
        let g: { tesisId?: unknown; konu?: unknown } = {};
        try {
          g = JSON.parse(Buffer.concat(parcalar).toString("utf8")) as typeof g;
        } catch {
          /* aşağıda 400 */
        }
        if (typeof g.tesisId !== "string" || typeof g.konu !== "string") {
          res.writeHead(400);
          return res.end();
        }
        sayac.zil++;
        ziller.push({ tesisId: g.tesisId, konu: g.konu, at: Date.now() });
        zilAktar(g.tesisId, g.konu);
        res.writeHead(202);
        return res.end();
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((r) => sunucu.listen(0, "127.0.0.1", () => r()));
  const port = (sunucu.address() as net.AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    belirtec,
    kurulumlar,
    ziller,
    sayac,
    async kapat(): Promise<void> {
      sunucu.closeAllConnections();
      await new Promise<void>((r) => sunucu.close(() => r()));
    },
  };
}
