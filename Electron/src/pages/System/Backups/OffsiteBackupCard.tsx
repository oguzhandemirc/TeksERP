import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CloudUpload, ShieldAlert, ShieldCheck, RefreshCw, Plug, KeyRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/PermissionGate";
import {
  useOffsiteStatus,
  updateOffsiteConfig,
  testOffsiteConnection,
  sweepOffsiteNow,
  authorizeOffsiteDrive,
  OFFSITE_QUERY_KEY,
} from "./service";

/**
 * OFFSITE YEDEK KARTI — "yedeklerim başka bir yerde mi" sorusunun tek yüzeyi.
 *
 * (denetim 2026-08-10, F-OPS-VER-003) Veritabanı ve 30 günlük yedeklerin tamamı
 * aynı fiziksel diskteydi; tek disk arızası, yangın, hırsızlık ya da fidye
 * yazılımı ikisini birden götürür ve geri dönüş noktası kalmaz. Sorunun yıllarca
 * fark edilmemesinin sebebi görünürlük yokluğuydu — bu kart onu kapatır.
 *
 * ⚠️ EN ÖNEMLİ SAYI `missingCount`. "Bağlı" olmak yetmez: kopyalama aylar önce
 * bir kez düşmüş olabilir ve o dosya sonsuza dek eksik kalır. Backend bu yüzden
 * yerel↔uzak listelerini KARŞILAŞTIRIYOR; kart o farkı en üstte gösterir.
 */
export function OffsiteBackupCard() {
  const { data, isLoading } = useOffsiteStatus();
  const qc = useQueryClient();
  const [remote, setRemote] = useState<string | null>(null);
  const [localDir, setLocalDir] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [tokenName, setTokenName] = useState("gdrive");
  const [token, setToken] = useState("");

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: OFFSITE_QUERY_KEY });
  };

  const saveConfig = useMutation({
    mutationFn: updateOffsiteConfig,
    onSuccess: () => {
      invalidate();
      setRemote(null);
      setLocalDir(null);
      toast.success("Offsite hedefi kaydedildi. En geç bir saat içinde süpürme koşar.");
    },
  });

  const test = useMutation({
    mutationFn: testOffsiteConnection,
    onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)),
  });

  const sweep = useMutation({
    mutationFn: sweepOffsiteNow,
    onSuccess: (r) => {
      invalidate();
      if (r.ok) toast.success(`Süpürme tamam — ${r.remoteCount} kopya uzakta, eksik yok.`);
      else toast.error(r.warnings?.[0] ?? "Süpürme tamamlanamadı.");
    },
  });

  const authorize = useMutation({
    mutationFn: authorizeOffsiteDrive,
    onSuccess: (r) => {
      invalidate();
      // Token state'ten HEMEN silinir — ekranda kalmasının hiçbir faydası yok.
      setToken("");
      setShowWizard(false);
      toast.success(r.message);
    },
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Offsite durumu yükleniyor…
        </CardContent>
      </Card>
    );
  }

  const o = data.offsite;
  const cfg = data.config;
  const missing = o.missingCount ?? 0;
  // Üç durum: hiç ayarlanmamış · ayarlı ama sorunlu · sağlıklı.
  const state: "yok" | "sorun" | "iyi" = !o.configured ? "yok" : o.ok && missing === 0 ? "iyi" : "sorun";

  const remoteValue = remote ?? cfg.remote;
  const localValue = localDir ?? cfg.localDir;
  const dirty = (remote !== null && remote !== cfg.remote) || (localDir !== null && localDir !== cfg.localDir);

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5">
        {/* ── Durum başlığı ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {state === "iyi" ? (
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            ) : (
              <ShieldAlert
                className={`mt-0.5 size-5 shrink-0 ${state === "yok" ? "text-red-600" : "text-amber-600"}`}
              />
            )}
            <div className="min-w-0">
              <h3 className="font-semibold">Offsite Yedek</h3>
              {state === "yok" ? (
                <p className="text-sm text-red-600">
                  Kapalı — tüm yedekler veritabanıyla <strong>aynı diskte</strong>. Tek disk arızası,
                  yangın ya da fidye yazılımı ikisini birden götürür.
                </p>
              ) : state === "sorun" ? (
                <p className="text-sm text-amber-700 dark:text-amber-500">
                  {missing > 0
                    ? `${missing} yedeğin uzak kopyası YOK.`
                    : (o.warnings?.[0] ?? "Son süpürme tamamlanamadı.")}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Yerel {o.localCount} · Uzak {o.remoteCount} · Eksik yok
                  {o.finishedAt ? ` · son süpürme ${new Date(o.finishedAt).toLocaleTimeString("tr-TR")}` : ""}
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => test.mutate()} disabled={test.isPending || !cfg.remote}>
              <Plug className="mr-1.5 size-4" />
              Bağlantıyı test et
            </Button>
            <Button size="sm" onClick={() => sweep.mutate()} disabled={sweep.isPending}>
              <RefreshCw className={`mr-1.5 size-4 ${sweep.isPending ? "animate-spin" : ""}`} />
              Şimdi süpür
            </Button>
          </div>
        </div>

        {/* Eksik dosyalar — sayı yetmez, HANGİLERİ olduğu da lazım. */}
        {missing > 0 && o.missing && o.missing.length > 0 && (
          <ul className="rounded border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/40">
            {o.missing.map((n) => (
              <li key={n} className="font-mono">
                {n}
              </li>
            ))}
            {missing > o.missing.length && <li className="mt-1 italic">…ve {missing - o.missing.length} tane daha</li>}
          </ul>
        )}

        {/* ── Hedefler ──────────────────────────────────────────────────── */}
        <PermissionGate anyOf={["admin:settings"]}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="offsite-remote">Uzak hedef (rclone)</Label>
              <Input
                id="offsite-remote"
                value={remoteValue}
                placeholder="gdrive:tekserp-yedek"
                onChange={(e) => setRemote(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Buluta kopyalar. Boş bırakmak kapatır.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="offsite-dir">Yerel ikinci hedef</Label>
              <Input
                id="offsite-dir"
                value={localValue}
                placeholder="\\\\NAS\\yedek\\tekserp"
                onChange={(e) => setLocalDir(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Ağ paylaşımı ya da ikinci disk. Yetkilendirme gerektirmez.
              </p>
            </div>
          </div>

          {dirty && (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  saveConfig.mutate({
                    ...(remote !== null ? { remote } : {}),
                    ...(localDir !== null ? { localDir } : {}),
                  })
                }
                disabled={saveConfig.isPending}
              >
                Kaydet
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRemote(null);
                  setLocalDir(null);
                }}
              >
                Vazgeç
              </Button>
            </div>
          )}

          {/* ── Google Drive sihirbazı ──────────────────────────────────── */}
          <div className="rounded border p-4">
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left text-sm font-medium"
              onClick={() => setShowWizard((v) => !v)}
            >
              <KeyRound className="size-4" />
              Google Drive bağla
              <span className="ml-auto text-xs text-muted-foreground">{showWizard ? "gizle" : "göster"}</span>
            </button>

            {showWizard && (
              <div className="mt-4 flex flex-col gap-4 text-sm">
                {/*
                  ⚠️ KENDİ Google OAuth istemcimizi GÖMMÜYORUZ — bu, depoya bir
                  client secret koymak demekti ve şu an açık olan kritik bulgunun
                  (.env sırları git'te) aynısını üretirdi. rclone'un kendi
                  istemcisi kullanılıyor; bu onun belgelenmiş "başsız sunucu"
                  akışıdır.
                */}
                <p className="text-muted-foreground">
                  Tarayıcısı olan herhangi bir bilgisayarda <strong>bir kez</strong> aşağıdaki komutu
                  çalıştırın, Google hesabınızla giriş yapın ve çıkan metni buraya yapıştırın.
                </p>
                <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs">
                  rclone authorize "drive"
                </pre>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="offsite-name">Hedef adı</Label>
                  <Input
                    id="offsite-name"
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    className="max-w-48"
                  />
                  <p className="text-xs text-muted-foreground">
                    Uzak hedef alanında <span className="font-mono">{tokenName || "ad"}:klasör</span> olarak
                    kullanılır.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="offsite-token">Token</Label>
                  <Textarea
                    id="offsite-token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    rows={4}
                    className="font-mono text-xs"
                    placeholder={'{"access_token":"…","refresh_token":"…"}'}
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">
                    Yalnız süslü parantezle başlayan bölümü yapıştırın. Token sunucuda saklanır,
                    ekranda tutulmaz ve hiçbir yere loglanmaz.
                  </p>
                </div>

                <div>
                  <Button
                    size="sm"
                    onClick={() => authorize.mutate({ name: tokenName.trim(), token })}
                    disabled={authorize.isPending || token.trim().length < 20}
                  >
                    <CloudUpload className="mr-1.5 size-4" />
                    Kaydet ve bağla
                  </Button>
                </div>

                {cfg.configPath && (
                  <p className="text-xs text-muted-foreground">
                    Yapılandırma dosyası: <span className="font-mono">{cfg.configPath}</span>
                    {" · "}rclone: <span className="font-mono">{cfg.rcloneBin}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        </PermissionGate>
      </CardContent>
    </Card>
  );
}
