// =============================================================================
// deneme-veri — panel API istemcisi (masaüstü clientType, Bearer). Sır yalnız macOS Anahtar Zinciri'nden okunur/yazılır;
// parola/token hiçbir çıktıya, hata metnine, dosyaya girmez. Belirsiz hatada (ağ · zaman aşımı · 5xx · 429) AYNI gövdeyle
// (aynı clientToken) yeniden dener; kesin 4xx'te dener DEĞİL — hata `status` + `kod` (details.code) ile yükselir.
// =============================================================================
import { execFileSync, spawnSync } from "node:child_process";

export class ApiHatasi extends Error {
  constructor(method, path, status, j) {
    const mesaj = j?.message ?? j?.error ?? "";
    super(`${method} ${path} → ${status}${j?.details?.code ? " " + j.details.code : ""}${mesaj ? " — " + String(mesaj).slice(0, 300) : ""}${j?.details?.issues ? " " + JSON.stringify(j.details.issues).slice(0, 400) : ""}${j?.errors ? " " + JSON.stringify(j.errors).slice(0, 400) : ""}`);
    this.status = status;
    this.kod = j?.details?.code;
    this.govde = j;
  }
}

/** Anahtar Zinciri'nden parola (yoksa null). Değer yalnız bellekte. */
export function zincirOku(servis) {
  try {
    return execFileSync("security", ["find-generic-password", "-s", servis, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\n$/, "");
  } catch {
    return null;
  }
}
/** Anahtar Zinciri'ne yaz (-U: varsa güncelle). Parola argv'ye girmez — `security -i` komutu stdin'den okunur. */
export function zincirYaz(servis, hesap, parola) {
  if (!/^[A-Za-z0-9_-]+$/.test(parola)) throw new Error("zincirYaz: parola yalnız base64url karakter taşımalı");
  const r = spawnSync("security", ["-i"], { input: `add-generic-password -U -s ${servis} -a ${hesap} -w ${parola}\n`, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`Anahtar Zinciri yazılamadı (çıkış ${r.status})`);
  if (zincirOku(servis) !== parola) throw new Error("Anahtar Zinciri doğrulaması tutmadı");
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

export function istemciKur({ url, kullanici, parola, deneme = 5, sessiz = false }) {
  let token = null;
  const sayac = { istek: 0, yeniden: 0 };

  async function hamIstek(method, path, body, { tokenli = true, enCok = deneme } = {}) {
    for (let i = 1; ; i++) {
      sayac.istek++;
      let r, txt;
      try {
        r = await fetch(url + path, {
          method,
          headers: { "content-type": "application/json", ...(tokenli && token ? { authorization: "Bearer " + token } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
        txt = await r.text();
      } catch (e) {
        if (i >= enCok) throw new Error(`${method} ${path} → ağ hatası (${e.name}); ${i} deneme`);
        sayac.yeniden++;
        if (!sessiz) console.log(`  ↻ ${method} ${path} ağ hatası — aynı gövdeyle yeniden (${i})`);
        await bekle(500 * 2 ** i);
        continue;
      }
      let j;
      try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt.slice(0, 200) }; }
      if (r.ok) return j;
      if ((r.status >= 500 || r.status === 429) && i < enCok) {
        sayac.yeniden++;
        if (!sessiz) console.log(`  ↻ ${method} ${path} ${r.status} — aynı gövdeyle yeniden (${i})`);
        await bekle(Number(r.headers.get("retry-after") ?? 0) * 1000 || 500 * 2 ** i);
        continue;
      }
      throw new ApiHatasi(method, path, r.status, j);
    }
  }

  async function giris() {
    const j = await hamIstek("POST", "/api/auth/login", { username: kullanici, password: parola, clientType: "electron", confirmKick: true }, { tokenli: false });
    if (j.data?.mustChangePassword) throw new Error(`"${kullanici}" parola değişimi bekliyor`);
    token = j.data?.token;
    if (!token) throw new Error("giriş token döndürmedi");
    return j.data;
  }

  /** `tekDeneme`: tokensız yaratma — belirsiz hatada körlemesine yeniden denenmez (çağıran ara-yoksa-yarat ile yeniden okur). */
  async function api(method, path, body, { tekDeneme = false } = {}) {
    if (!token) await giris();
    const o = tekDeneme ? { enCok: 1 } : {};
    try {
      return await hamIstek(method, path, body, o);
    } catch (e) {
      if (e.status === 401) { await giris(); return hamIstek(method, path, body, o); }
      throw e;
    }
  }
  const cikis = async () => { if (token) await hamIstek("POST", "/api/auth/logout", {}).catch(() => undefined); token = null; };
  return { api, giris, cikis, sayac, hamIstek };
}

/** Liste yanıtını diziye indir (data dizi · data.items · data.rows · data.data). */
export function liste(j) {
  const d = j?.data ?? j;
  if (Array.isArray(d)) return d;
  return d?.items ?? d?.rows ?? d?.data ?? d?.list ?? [];
}
