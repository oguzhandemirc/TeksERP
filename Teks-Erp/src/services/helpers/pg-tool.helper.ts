// =============================================================================
// PostgreSQL komut satırı araçlarını çalıştırma (pg_dump / pg_restore / psql)
// =============================================================================
// `backup.service.ts`'ten ayıklandı — geri yükleme kopyası akışı da aynı iki
// yardımcıya ihtiyaç duyuyor (`pg_restore` kopyaya, `psql` yolu takas komutuna).
// =============================================================================

import { spawn } from "child_process";

export type PgToolName = "pg_dump" | "pg_restore" | "psql";

/**
 * Aracın tam yolu. `PG_BIN_DIR` **çağrı anında** okunur (modül-yükleme anında
 * değil) — böylece test env'i değiştirip hatalı-yol dalını doğrulayabilir,
 * üretimde davranış aynı kalır (env pm2 start'ta sabitlenir).
 *
 * Windows'ta PostgreSQL bin klasörü PATH'te olmaz → env ile verilir
 * (örn. C:\Program Files\PostgreSQL\18\bin). Boşsa PATH denenir.
 */
export function pgTool(name: PgToolName): string {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const dir = process.env.PG_BIN_DIR;
  return dir ? `${dir.replace(/[\\/]$/, "")}/${exe}` : exe;
}

// ── İSTEMCİ ↔ SUNUCU SÜRÜM UYUMU ───────────────────────────────────────────
// ⚠️ BU YÜKLEM BİZİM KULLANIMIMIZA ÖZGÜDÜR ve kapsamı burada yazılıdır:
// dump'ı ALDIĞIMIZ sunucuya (ya da aynı sürüm ailesindeki bir kopyasına) GERİ
// YÜKLÜYORUZ. Genel PostgreSQL tavsiyesi terstir — dump alırken YENİ istemci
// önerilir, çünkü orada hedef genellikle daha yeni bir sunucudur. Bizde hedef
// aynı aile olduğu için ihlal yönü `istemci > sunucu`dur.
// ⇒ Kapsamı yazmazsak yarın biri PG belgesini okuyup yönü "düzeltir" ve kapı
//   sessizce tersine döner. (Kapsamı yazılmamış bir yüklem, onu OKUYANIN
//   kapsamıyla okunur.)
//
// ÖLÇÜLDÜ 2026-09-13: istemci 18.6 ↔ sunucu 16.15 → `pg_restore` "unrecognized
// configuration parameter transaction_timeout" (PG17+ parametresi) ile düşüyor.
// Yani uyumsuz istemciyle alınan yedek BUGÜN sorunsuz görünür, LAZIM OLDUĞU GÜN
// açılmaz. `pgTool()` `PG_BIN_DIR` yoksa PATH'e düşer ⇒ bu saha için de gerçek.

/** Üç sonuç, iki değil: "araç YOK" ile "araç UYUMSUZ" aynı şey DEĞİLDİR. */
export type SurumUyumu =
  | { sonuc: "uyumlu"; istemci: number; sunucu: number }
  | { sonuc: "istemci-yeni"; istemci: number; sunucu: number }
  | { sonuc: "olculemedi"; sebep: string };

/** `pg_dump (PostgreSQL) 18.6` → 18. Okunamazsa null (uyumsuz DEĞİL, ölçülemedi). */
export function istemciAnaSurumu(versionCiktisi: string | null | undefined): number | null {
  const m = /\b(\d+)(?:\.\d+)*\s*$/.exec((versionCiktisi ?? "").trim());
  return m ? Number(m[1]) : null;
}

/**
 * SAF karar — süreç doğurmaz, DB'ye gitmez. Bekçi bunu ENJEKTE EDİLMİŞ çiftlerle
 * sınar; gerçek bir PG 18 kurulumu GEREKMEZ (yoksa bekçi "yalnız bir makinede
 * koşan" sınıfına düşerdi).
 */
export function surumUyumu(istemci: number | null, sunucuVersionNum: number | null): SurumUyumu {
  if (istemci === null) return { sonuc: "olculemedi", sebep: "istemci sürümü okunamadı" };
  if (sunucuVersionNum === null || sunucuVersionNum <= 0) {
    return { sonuc: "olculemedi", sebep: "sunucu sürümü okunamadı" };
  }
  const sunucu = Math.floor(sunucuVersionNum / 10000);
  return istemci > sunucu ? { sonuc: "istemci-yeni", istemci, sunucu } : { sonuc: "uyumlu", istemci, sunucu };
}

/** İz metni — "uyardım" bir kapı değildir; okunabilir iz bırakmıyorsa hiç olmamıştır. */
export function surumUyumuMetni(u: SurumUyumu, yol: "yedek" | "geri-yükleme"): string {
  if (u.sonuc === "olculemedi") {
    return `PostgreSQL sürüm uyumu ÖLÇÜLEMEDİ (${u.sebep}) — ${yol} yolu devam ediyor, uyum GARANTİ EDİLMİYOR.`;
  }
  if (u.sonuc === "istemci-yeni") {
    return (
      `PostgreSQL istemcisi (${u.istemci}) sunucudan (${u.sunucu}) YENİ — ${yol} yolu. ` +
      `Bu istemciyle alınan yedek bu sunucuya GERİ YÜKLENEMEZ. ` +
      `Çözüm: PG_BIN_DIR'i sunucu sürümüyle aynı aileden bir bin klasörüne gösterin.`
    );
  }
  return `PostgreSQL sürüm uyumu: istemci ${u.istemci} ↔ sunucu ${u.sunucu}.`;
}

/**
 * Sunucunun ana sürüm numarasını okuyan SQL. **Tek kaynak** — iki çağrı yeri de
 * (yedek · geri yükleme kopyası) bunu kullanır; ayrı yazılırsa biri değişip
 * diğeri kalır ve uyum kapısı yalnız BİR yolda çalışır.
 * `server_version_num`: 16.15 → 160015.
 */
export const SUNUCU_SURUM_SQL = `SELECT current_setting('server_version_num') AS v`;

/** `SUNUCU_SURUM_SQL` sonucunu sayıya çevirir. Okunamazsa null (uyumsuz DEĞİL). */
export function sunucuSurumNumarasi(ham: string | null | undefined): number | null {
  const n = Number((ham ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * İstemci aracının ana sürümü — süreç doğurur, sonucu ÖNBELLEKLER.
 * Önbellek anahtarı `pgTool(name)` ÇÖZÜLMÜŞ YOLUDUR (araç adı değil): böylece
 * `PG_BIN_DIR` değişince yeniden ölçülür ve `pgTool`un "env çağrı anında okunur"
 * sözleşmesi bozulmaz. Okunamazsa null döner — **fırlatmaz**, çünkü bu yol
 * hiçbir işi durdurmamalı.
 */
const istemciSurumOnbellegi = new Map<string, number | null>();
export async function istemciSurumu(name: PgToolName): Promise<number | null> {
  const yol = pgTool(name);
  const onbellek = istemciSurumOnbellegi.get(yol);
  if (onbellek !== undefined) return onbellek;
  const r = await runProcess(yol, ["--version"], { captureStdout: true, timeoutMs: 15_000 });
  const surum = r.spawnError !== null || r.code !== 0 ? null : istemciAnaSurumu(r.stdout);
  istemciSurumOnbellegi.set(yol, surum);
  return surum;
}

/**
 * İki okuyucuyu birleştirip üç sonuçlu kararı üretir. **Okuyucular ENJEKTE
 * EDİLİR** — bekçi bu birleştirmeyi gerçek bir PG kurulumu ve DB bağlantısı
 * OLMADAN ölçebilsin diye (aksi hâlde bu dal hiç basılmazdı).
 *
 * Okuyucu fırlatırsa sonuç "ölçülemedi"dir ve hata metni **gerekçeye yazılır** —
 * yokluğa mekanizma atfedilmez, ölçülen sebep iz bırakır.
 */
export async function surumUyumuOlc(
  istemciOku: () => Promise<number | null>,
  sunucuOku: () => Promise<number | null>,
): Promise<SurumUyumu> {
  let istemci: number | null = null;
  let sunucu: number | null = null;
  const okumaNotu: string[] = [];
  try {
    istemci = await istemciOku();
  } catch (e) {
    okumaNotu.push(`istemci: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    sunucu = await sunucuOku();
  } catch (e) {
    okumaNotu.push(`sunucu: ${e instanceof Error ? e.message : String(e)}`);
  }
  const u = surumUyumu(istemci, sunucu);
  if (u.sonuc === "olculemedi" && okumaNotu.length > 0) {
    return { sonuc: "olculemedi", sebep: `${u.sebep} — ${okumaNotu.join("; ")}` };
  }
  return u;
}

export interface ToolResult {
  code: number;
  stderr: string;
  spawnError: string | null;
  /** Zaman aşımı nedeniyle öldürüldü mü — çağıran "başarısız" ile "asıldı"yı ayırabilsin. */
  timedOut?: boolean;
  /** Yalnız `captureStdout` istendiğinde dolar (örn. `rclone lsf`). */
  stdout?: string;
}

export interface RunProcessOptions {
  timeoutMs?: number;
  /** `process.env` ÜZERİNE eklenir (üzerine yazmaz — çağıran neyi ezdiğini bilir). */
  env?: NodeJS.ProcessEnv;
  /**
   * stdout'u topla. VARSAYILAN KAPALI ve bu bilinçli: `pg_dump -Fc -f` dosyaya
   * yazar, `pg_restore --list` çıktısı bizi ilgilendirmez. Yalnız çıktısı VERİ
   * olan araçlar için aç (`rclone lsf`).
   */
  captureStdout?: boolean;
}

/**
 * Varsayılan üst sınır: 3 saat. Dolu bir fabrika veritabanının `pg_dump`'ı
 * dakikalar sürer; 3 saat "bu iş artık bitmez" demenin cömert eşiğidir ve
 * `backup-scheduler`'ın kendi watchdog'uyla (3 saat) hizalıdır.
 */
export const DEFAULT_TOOL_TIMEOUT_MS = 3 * 60 * 60 * 1000;

/**
 * Aracı çalıştırır, exit code + stderr toplar.
 *
 * stdout TÜKETİLMEZ: `pg_dump -Fc -f` dosyaya yazar, `pg_restore --list` çıktısı
 * bizi ilgilendirmez (yalnız exit code). stderr'i tüketmek ŞART — yoksa pipe
 * dolduğunda child asılır.
 *
 * Şifre yalnız `PGPASSWORD` env'i ile geçer: komut satırına yazılmaz (ps
 * çıktısında görünmesin) ve log'a düşmez.
 *
 * ⚠️ ZAMAN AŞIMI ZORUNLU (denetim 2026-08-09, F-OPS-VER-004). Eskiden `spawn`a
 * hiçbir üst sınır verilmiyordu: child asılırsa (ağ sürücüsü yanıt vermiyor, PG
 * kilitli, disk dolu) ne `error` ne `close` olayı gelir, promise HİÇ SETTLE
 * ETMEZ ve zincirin üstündeki `runBackupJob` da dönmez — yani o gece için ne
 * `BACKUP_COMPLETED` ne `BACKUP_FAILED` audit kaydı doğar. Yedek sessizce
 * alınmamış olur ve damga işin BAŞINDA yazıldığı için tekrar da denenmez.
 * `timeout` verildiğinde Node child'ı öldürür, `close` tetiklenir ve mevcut
 * hata yolu (audit + `fs.rm` temizliği) KENDİLİĞİNDEN çalışır.
 */
export function runTool(
  file: string,
  args: string[],
  password: string,
  timeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS,
): Promise<ToolResult> {
  return runProcess(file, args, { timeoutMs, env: { PGPASSWORD: password } });
}

/**
 * `runTool`'un altındaki genel çocuk-süreç disiplini. PG'ye özgü DEĞİLDİR;
 * offsite kopya (`rclone`) da buradan geçer.
 *
 * ⚠️ TEK UYGULAMA NOKTASI OLARAK KALMALI. Zaman aşımı + `SIGKILL` + stderr
 * tüketimi + `error`/`close` ayrımı burada bir kez doğru yazıldı (F-OPS-VER-004:
 * üst sınırsız `spawn` asılırsa promise HİÇ settle etmez ve o gecenin yedeği
 * sessizce kaybolur). Yeni bir dış araç eklerken `spawn`ı doğrudan çağırma —
 * o disiplini yeniden yazman gerekir ve bir yerini atlarsan aynı sessiz kayıp
 * bu kez başka bir yoldan geri gelir.
 *
 * stderr'i tüketmek ŞART (yoksa pipe dolduğunda child asılır). stdout yalnız
 * istendiğinde toplanır; ikisi de 64 KB ile sınırlı — bozuk bir çağrı
 * megabaytlarca çıktı üretip belleği şişirmesin.
 */
export function runProcess(
  file: string,
  args: string[],
  opts: RunProcessOptions = {},
): Promise<ToolResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      windowsHide: true,
      env: { ...process.env, ...(opts.env ?? {}) },
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    let stderr = "";
    let stdout = "";
    child.stderr?.on("data", (d) => {
      if (stderr.length < 64 * 1024) stderr += d.toString();
    });
    if (opts.captureStdout) {
      child.stdout?.on("data", (d) => {
        if (stdout.length < 64 * 1024) stdout += d.toString();
      });
    }
    child.on("error", (err) =>
      resolve({ code: -1, stderr, spawnError: err.message, ...(opts.captureStdout ? { stdout } : {}) }),
    );
    child.on("close", (code, signal) => {
      // Node timeout'ta `killSignal` ile öldürür → code null, signal dolu gelir.
      const timedOut = signal === "SIGKILL" && code === null;
      resolve({
        code: code ?? -1,
        stderr: timedOut
          ? `${stderr}\n[pg-tool] ${Math.round(timeoutMs / 1000)} sn zaman aşımı — süreç öldürüldü.`
          : stderr,
        spawnError: null,
        timedOut,
        ...(opts.captureStdout ? { stdout } : {}),
      });
    });
  });
}
