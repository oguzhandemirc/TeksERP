// Fabrika kanalının gövdesi HAM baytlarıyla okunur: imzalı özet (`govdeOzeti`) sıkıştırılmış/ham
// baytlardan hesaplanır — ayrıştırıcı (express.json/raw) gzip'i kendiliğinden açtığı için KULLANILMAZ.
// Sınır aşılırsa okuma kesilir: 413 PAKET_BUYUK.
import type { Request } from "express";
import { CloudError } from "../lib/errors";

export function readRawBody(req: Request, limitBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? "0");
    if (declared > limitBytes) {
      reject(new CloudError(413, "PAKET_BUYUK", `Gövde ${limitBytes} baytı aşıyor`));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limitBytes) {
        failed = true;
        reject(new CloudError(413, "PAKET_BUYUK", `Gövde ${limitBytes} baytı aşıyor`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      if (!failed) reject(err);
    });
  });
}
