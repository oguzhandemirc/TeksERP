// Müşterinin gördüğü iki sayfa: /d/<belirteç> açılış (indirme bir DÜĞMEYLE — bağlantı önizleme botları GET
// ile hak tüketmesin) ve /y/<belirteç> yükleme. Belirteç URL'de olduğundan Referer ASLA gönderilmez; betik
// nonce'lu CSP ile; dosya adı HTML'e kaçışlı girer. Müşteri adı, satıcı kullanıcısı, iç kimlik sayfada YOK.
import { randomBytes } from "node:crypto";
import type { Response } from "express";
import { SHA256_JS, UPLOAD_JS } from "./upload-page-script";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function pageHeaders(res: Response, nonce: string | null): void {
  res.set({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": [
      "default-src 'none'",
      nonce ? `script-src 'nonce-${nonce}'` : "script-src 'none'",
      "style-src 'unsafe-inline'",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
  });
}

const STYLE = `body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#f6f7f9;color:#1d2330}
main{max-width:560px;margin:0 auto;padding:32px 16px}h1{font-size:20px;margin:0 0 16px}
.kart{background:#fff;border:1px solid #dde1e7;border-radius:10px;padding:20px}
.alt{color:#5b6475;font-size:14px;margin:8px 0}button{font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#1f5eff;color:#fff;cursor:pointer}
button:disabled{opacity:.5}input[type=file]{margin:12px 0;max-width:100%}.hata{color:#b3261e}#durum{margin-top:12px;font-size:14px}`;

function shell(title: string, body: string, script: string | null, nonce: string | null): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main>${script && nonce ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
}

export interface DownloadPageInfo {
  readonly name: string;
  readonly bytes: number;
  readonly expiresAt: Date;
  readonly remaining: number;
  readonly firstInstall: boolean;
}

/** Açılış sayfası: yalnız form (betik yok). Düğme aynı adrese POST eder — hak o anda tüketilir. */
export function sendDownloadPage(res: Response, token: string, i: DownloadPageInfo): void {
  pageHeaders(res, null);
  const size = `${(i.bytes / 1048576).toFixed(1)} MB`;
  res.status(200).send(
    shell(
      "TeksERP dosya indirme",
      `<h1>${i.firstInstall ? "TeksERP kurulum dosyası" : "TeksERP dosya paylaşımı"}</h1><div class="kart">
<p><strong>${escapeHtml(i.name)}</strong></p><p class="alt">${size} · kalan indirme hakkı: ${i.remaining} · son gün: ${escapeHtml(i.expiresAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }))}</p>
<form method="post" action="/d/${escapeHtml(token)}"><button type="submit">İndir</button></form>
<p class="alt">Her indirme bir hak tüketir. Bağlantıyı başkasıyla paylaşmayın.</p></div>`,
      null,
      null,
    ),
  );
}

export function sendUploadPage(res: Response): void {
  const nonce = randomBytes(16).toString("base64");
  pageHeaders(res, nonce);
  res.status(200).send(
    shell(
      "TeksERP dosya gönderme",
      `<h1>TeksERP'ye dosya gönderin</h1><div class="kart"><p id="aciklama"></p><p class="alt" id="bilgi">Yükleniyor…</p>
<form id="form"><input type="file" id="dosya" required><br><button id="gonder" type="submit">Gönder</button></form>
<div id="durum"></div><p class="alt">Büyük dosyalar parça parça gönderilir; bağlantı koparsa aynı dosyayı yeniden seçin, kaldığı yerden sürer.</p></div>`,
      `${SHA256_JS}\n${UPLOAD_JS}`,
      nonce,
    ),
  );
}
