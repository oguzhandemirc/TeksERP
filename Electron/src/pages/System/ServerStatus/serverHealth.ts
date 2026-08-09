import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import apiClient from "@/services/apiClient";

/** Backend `/health` ucundan KULLANILAN alanlar (uç daha fazlasını döner). */
export interface HealthResponse {
  api: string;
  db: "UP" | "DOWN";
  version: string;
  uptimeSec: number;
  dbSizeBytes: number | null;
  dbConnections: number | null;
  cacheHitPct: number | null;
  dbBlockedCount: number | null;
  lastBackup: { name: string; time: string } | null;
  auditWriteFailures: number;
  // Bağlantı havuzu — backend'in KENDİ havuzu. `dbConnections` ise
  // `pg_stat_activity` sayımıdır (SUNUCU tarafı: psql/pgAdmin/pg_dump dahil,
  // idle/busy ayırt etmez). Doygunluk ve zaman aşımı yalnız bu alanlarda görünür.
  // Sürüm kayması: eski bir backend bu alanları GÖNDERMEZ → tüm okumalar
  // null/undefined toleranslı olmalı (karşılaştırmalar false'a düşer, alarm çıkmaz).
  poolMax: number;
  poolTotalCount: number;
  poolIdleCount: number;
  poolWaitingCount: number;
  poolWaitingMax: number;
  /** /health'te var; UI'da gösterilmiyor — soğuk-connect doğrulaması için curl'le okunur. */
  poolConnectsTotal: number;
  poolAcquireTimeouts: number;
  lastPoolTimeoutAt: string | null;
  lastPoolTimeoutError: string | null;
  // Kaynak metrikleri (app.ts)
  cpuCores: number;
  procRssBytes: number;
  procHeapUsedBytes: number;
  procHeapTotalBytes: number;
  procCpuPct: number | null;
  sysCpuPct: number | null;
  sysTotalMemBytes: number;
  sysFreeMemBytes: number;
  sysUsedMemBytes: number;
  eventLoopLagMs: number;
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
  diskUsedPct: number | null;
  activeUsers: number;
  activeDevices: number;
}

export type Level = "ok" | "warn" | "crit";

export interface Sample {
  t: number;
  procCpu: number;
  sysCpu: number;
  procMemPct: number;
  sysMemPct: number;
}

const REFRESH_MS = 5_000;
const HISTORY_CAP = 24; // 24 × 5sn = son ~2 dk

/**
 * /health'i 5sn'de bir çeker (YALNIZ sayfa açıkken — yük bindirmez) ve istemci
 * tarafında son ~2 dk'lık örnek tamponu tutar (sparkline için, backend/DB'ye
 * EK MALİYET YOK). Her başarılı fetch'te (yeni dataUpdatedAt) tek örnek eklenir.
 *
 * K-A8 fix: sekme sistemi pasif sekmeleri MOUNT tutar — "sayfa açıkken" varsayımı
 * arka planda bırakılan Sunucu Durumu sekmesinde süresiz 5sn polling'e dönüşüyordu.
 * Pasif sekmedeyken interval durur; sekmeye dönünce kaldığı yerden sürer.
 */
export function useServerHealth() {
  const isTabActive = useIsTabActive();
  const q = useQuery({
    queryKey: ["server-health"],
    queryFn: async () => {
      // ⚠️ `/health` DEĞİL `/admin/health` (backend denetimi 2026-08-09,
      // F-CORE-GUV-002). Public `/health` artık YALNIZ canlılık döndürüyor
      // (status/api/db/version/time) — bu ekranın okuduğu her metrik
      // (lastBackup, poolMax, diskUsedPct, dbSizeBytes, activeUsers,
      // lastPoolTimeoutError) `admin:settings` arkasına alındı; o alanlar
      // kimlik doğrulamasız bir uçtan LAN'a açıktı.
      // ⚠️ BACKEND ile AYNI PENCEREDE deploy edilmeli: backend önce giderse bu
      // ekran 404, panel önce giderse 401 alır.
      const res = await apiClient.get<HealthResponse>("/admin/health", {
        suppressErrorToast: true,
      });
      return res.data;
    },
    refetchInterval: isTabActive ? REFRESH_MS : false,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const [history, setHistory] = useState<Sample[]>([]);
  const lastStamp = useRef(0);

  useEffect(() => {
    const d = q.data;
    if (!d || q.dataUpdatedAt === lastStamp.current) return;
    lastStamp.current = q.dataUpdatedAt;
    const sysMemPct = d.sysTotalMemBytes ? (d.sysUsedMemBytes / d.sysTotalMemBytes) * 100 : 0;
    const procMemPct = d.sysTotalMemBytes ? (d.procRssBytes / d.sysTotalMemBytes) * 100 : 0;
    setHistory((h) =>
      [
        ...h,
        {
          t: q.dataUpdatedAt,
          procCpu: d.procCpuPct ?? 0,
          sysCpu: d.sysCpuPct ?? 0,
          procMemPct,
          sysMemPct,
        },
      ].slice(-HISTORY_CAP),
    );
  }, [q.data, q.dataUpdatedAt]);

  return { data: q.data, isError: q.isError, dataUpdatedAt: q.dataUpdatedAt, history };
}

// ---------------------------------------------------------------------------
// Eşikler + uyarı değerlendirme (saf hesap — yük yok)
// ---------------------------------------------------------------------------

export function levelOf(pct: number | null | undefined, warn: number, crit: number): Level {
  if (pct == null || isNaN(pct)) return "ok";
  if (pct >= crit) return "crit";
  if (pct >= warn) return "warn";
  return "ok";
}

export interface Alert {
  level: Exclude<Level, "ok">;
  message: string;
}

/** Backend verisinden aksiyon gerektiren durumları çıkarır (kırmızı önce). */
export function evaluateAlerts(d: HealthResponse | undefined): Alert[] {
  if (!d) return [];
  const out: Alert[] = [];
  if (d.db === "DOWN") out.push({ level: "crit", message: "Veritabanı bağlantısı yok." });

  const disk = levelOf(d.diskUsedPct, 80, 90);
  if (disk !== "ok")
    out.push({
      level: disk,
      message: `Disk %${d.diskUsedPct} dolu — yer açın, dolarsa veritabanı durur.`,
    });

  const mem = levelOf(
    d.sysTotalMemBytes ? (d.sysUsedMemBytes / d.sysTotalMemBytes) * 100 : null,
    85,
    95,
  );
  if (mem !== "ok") out.push({ level: mem, message: "Makine RAM'i dolmak üzere." });

  const lag = levelOf(d.eventLoopLagMs, 100, 500);
  if (lag !== "ok")
    out.push({ level: lag, message: `Sunucu yanıt gecikmesi yüksek (${d.eventLoopLagMs} ms).` });

  if (d.dbBlockedCount && d.dbBlockedCount > 0)
    out.push({
      level: d.dbBlockedCount >= 3 ? "crit" : "warn",
      message: `${d.dbBlockedCount} sorgu kilit bekliyor — işlemler takılmış olabilir.`,
    });

  // Havuz doygunluğu MEŞGUL bağlantıyla ölçülür (total − idle), toplamla DEĞİL.
  // Neden: backend havuzu bilinçli olarak SICAK tutuyor (idleTimeoutMillis 10dk)
  // → açılış patlamasından sonra poolTotalCount uzun süre 24/30 civarında kalır ve
  // bu İSTENEN durumdur (soğuk connect = 2026-07 olaylarının sebebi). Toplama
  // eşik koymak kalıcı yanlış alarm üretirdi (ölçüldü: boot sonrası total=24,
  // idle=24, meşgul=0). Gerçek baskı = meşgul bağlantı + kuyruk.
  // Eşikler disk (80/90) ve RAM (85/95) ev konvansiyonuyla hizalı.
  const poolBusy = d.poolTotalCount != null && d.poolIdleCount != null ? d.poolTotalCount - d.poolIdleCount : null;
  const poolLvl = levelOf(d.poolMax && poolBusy != null ? (poolBusy / d.poolMax) * 100 : null, 80, 95);
  if (poolLvl !== "ok")
    out.push({
      level: poolLvl,
      message: `Veritabanı bağlantı havuzu doluyor (${poolBusy}/${d.poolMax} meşgul) — istekler sıraya girmek üzere.`,
    });

  // Anlık kuyruk: bir istek bağlantı bekliyorsa O AN bir kullanıcı bekliyor.
  // 5+ = havuz fiilen tavanda; connectionTimeoutMillis (5sn) içinde 503 gelmesi
  // muhtemel → kritik.
  if (d.poolWaitingCount > 0)
    out.push({
      level: d.poolWaitingCount >= 5 ? "crit" : "warn",
      message: `${d.poolWaitingCount} istek veritabanı bağlantısı bekliyor.`,
    });

  // Kümülatif: her sayı, kullanıcıya "Sunucu şu anda yoğun" (503) dönmüş bir
  // istektir → auditWriteFailures gibi >0'da uyarır (5sn poll'de kaçmaz).
  // Gözlenen taban 5 günde 2 olay; tek uptime'da 10+ = sistemik → kritik.
  if (d.poolAcquireTimeouts > 0)
    out.push({
      level: d.poolAcquireTimeouts >= 10 ? "crit" : "warn",
      message: `Veritabanı bağlantı havuzu ${d.poolAcquireTimeouts} kez zaman aşımına düştü (istek reddedildi).`,
    });

  if (d.auditWriteFailures > 0)
    out.push({ level: "warn", message: "Denetim (audit) log yazımı başarısız oluyor." });

  // Yedek bayatlığı: 24sa üstü uyarı, 48sa üstü kritik.
  const ageH = d.lastBackup ? (Date.now() - new Date(d.lastBackup.time).getTime()) / 3_600_000 : null;
  if (ageH == null) out.push({ level: "warn", message: "Henüz yedek alınmamış." });
  else if (ageH >= 48) out.push({ level: "crit", message: `Son yedek ${Math.floor(ageH / 24)} gün önce.` });
  else if (ageH >= 24) out.push({ level: "warn", message: "Son yedek 24 saatten eski." });

  // Kritikler önce.
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "crit" ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Biçimlendiriciler
// ---------------------------------------------------------------------------

export function fmtBytes(b: number | null | undefined): string {
  if (b == null || isNaN(b)) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return (i === 0 ? v : v.toFixed(1)) + " " + u[i];
}

export function fmtUptime(sec: number | null | undefined): string {
  if (sec == null || isNaN(sec)) return "—";
  const s = Math.floor(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(d + " gün");
  if (h > 0) parts.push(h + " sa");
  parts.push(m + " dk");
  return parts.join(" ");
}

export function fmtPct(p: number | null | undefined): string {
  return p == null || isNaN(p) ? "—" : "%" + p;
}

export function fmtBackupAge(lb: HealthResponse["lastBackup"]): string {
  if (!lb) return "Henüz yedek yok";
  const diffMs = Date.now() - new Date(lb.time).getTime();
  if (diffMs < 0 || isNaN(diffMs)) return new Date(lb.time).toLocaleString("tr-TR");
  const hrs = Math.floor(diffMs / 3_600_000);
  let rel: string;
  if (hrs < 1) rel = "1 saatten az önce";
  else if (hrs < 24) rel = hrs + " saat önce";
  else rel = Math.floor(hrs / 24) + " gün önce";
  return `${new Date(lb.time).toLocaleString("tr-TR")} (${rel})`;
}
