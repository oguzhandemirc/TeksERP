import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService, type LoginMethod } from "@/services/featureFlagService";

const DEFAULT_SESSION_HOURS = 8;
const MAX_SESSION_HOURS = 720; // 30 gün
const MAX_IDLE_MINUTES = 1440; // 24 saat
const DEFAULT_WORK_SESSION_IDLE = 600; // 10 saat
const DEFAULT_LOGIN_METHODS: { enabled: LoginMethod[]; primary: LoginMethod } = {
  enabled: ["list"],
  primary: "list",
};
const METHOD_LABELS: Record<LoginMethod, string> = {
  list: "Kullanıcı + Şifre",
  pin: "Hızlı PIN",
  card: "QR Personel Kartı",
};
const METHOD_DESCS: Record<LoginMethod, string> = {
  list: "Klasik: kullanıcı listeden seçilir, şifre/PIN girilir.",
  pin: "SALT PIN: kullanıcı seçme yok — kişiye özel BENZERSİZ 6 haneli hızlı PIN kimliği belirler.",
  card: "QR personel kartı okutulur — kullanıcı seçme ve PIN gerekmez.",
};

/**
 * Oturum & Güvenlik paneli — üç ayrı sayısal ayar:
 *  1) Oturum (JWT) ömrü, saat: giriş sonrası token kaç saat geçerli (backend ENFORCE).
 *  2) Hareketsizlik zaman aşımı, dakika: panel bu kadar dakika işlem görmezse otomatik
 *     çıkış (0 = kapalı; frontend ENFORCE — useIdleLogout).
 *  3) Çalışma oturumu (saha — kim hangi makinede) idle zaman aşımı, dakika: süre dolan
 *     oturum okuma anında IDLE kapanır, operatör yeniden yer onayı verir (backend TEMBEL
 *     enforce; timer yok).
 * Üçü de admin:settings yetkisi ister.
 */
export function SessionSettingsSection() {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const currentSession = flagsQ.data?.data?.sessionDurationHours ?? DEFAULT_SESSION_HOURS;
  const currentIdle = flagsQ.data?.data?.idleTimeoutMinutes ?? 0;
  const currentWorkIdle =
    flagsQ.data?.data?.workSessionIdleTimeoutMinutes ?? DEFAULT_WORK_SESSION_IDLE;
  const currentMethods = flagsQ.data?.data?.loginMethods ?? DEFAULT_LOGIN_METHODS;

  // String tutulur — input'ta geçici boş değere izin vermek için (kaydederken parse edilir).
  const [session, setSession] = useState(String(currentSession));
  const [idle, setIdle] = useState(String(currentIdle));
  const [workIdle, setWorkIdle] = useState(String(currentWorkIdle));
  const [enabledMethods, setEnabledMethods] = useState<LoginMethod[]>(currentMethods.enabled);
  const [primaryMethod, setPrimaryMethod] = useState<LoginMethod>(currentMethods.primary);
  useEffect(() => {
    setSession(String(currentSession));
    setIdle(String(currentIdle));
    setWorkIdle(String(currentWorkIdle));
    setEnabledMethods(currentMethods.enabled);
    setPrimaryMethod(currentMethods.primary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSession, currentIdle, currentWorkIdle, JSON.stringify(currentMethods)]);

  const mut = useMutation({
    mutationFn: (payload: {
      sessionDurationHours: number;
      idleTimeoutMinutes: number;
      workSessionIdleTimeoutMinutes: number;
      loginMethods: { enabled: LoginMethod[]; primary: LoginMethod };
    }) => featureFlagService.update(payload),
    onSuccess: () => {
      toast.success("Oturum ayarları kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  if (flagsQ.isLoading) return <Skeleton className="h-48 w-full" />;

  const sessionNum = Number(session);
  const idleNum = Number(idle);
  const workIdleNum = Number(workIdle);
  const sessionValid =
    Number.isInteger(sessionNum) && sessionNum >= 1 && sessionNum <= MAX_SESSION_HOURS;
  const idleValid = Number.isInteger(idleNum) && idleNum >= 0 && idleNum <= MAX_IDLE_MINUTES;
  const workIdleValid =
    Number.isInteger(workIdleNum) && workIdleNum >= 0 && workIdleNum <= MAX_IDLE_MINUTES;
  const methodsValid = enabledMethods.length > 0 && enabledMethods.includes(primaryMethod);
  const dirty =
    sessionNum !== currentSession ||
    idleNum !== currentIdle ||
    workIdleNum !== currentWorkIdle ||
    JSON.stringify([...enabledMethods].sort()) !== JSON.stringify([...currentMethods.enabled].sort()) ||
    primaryMethod !== currentMethods.primary;

  const toggleMethod = (m: LoginMethod, on: boolean) => {
    setEnabledMethods((prev) => {
      const next = on ? [...new Set([...prev, m])] : prev.filter((x) => x !== m);
      // Öncelikli yöntem kapatıldıysa kalan ilk yönteme kaydır.
      const fallback = next[0];
      if (!on && primaryMethod === m && fallback) setPrimaryMethod(fallback);
      return next;
    });
  };

  return (
    <PermissionGate
      permission="admin:settings"
      fallback={
        <div className="space-y-1 text-sm">
          <ReadOnlyLine label="Oturum süresi" value={`${currentSession} saat`} />
          <ReadOnlyLine
            label="Hareketsizlik zaman aşımı"
            value={currentIdle > 0 ? `${currentIdle} dakika` : "Kapalı"}
          />
          <ReadOnlyLine
            label="Çalışma oturumu zaman aşımı (saha)"
            value={currentWorkIdle > 0 ? `${currentWorkIdle} dakika` : "Kapalı"}
          />
          <ReadOnlyLine
            label="Mobil giriş yöntemleri"
            value={`${currentMethods.enabled.map((m) => METHOD_LABELS[m]).join(" · ")} (öncelik: ${METHOD_LABELS[currentMethods.primary]})`}
          />
          <p className="pt-2 text-xs text-muted-foreground">
            Bu ayarları değiştirmek için <code>admin:settings</code> yetkisi gerekir.
          </p>
        </div>
      }
    >
      <div className="space-y-5">
        <NumberField
          id="session-hours"
          label="Oturum süresi (saat)"
          desc="Giriş yaptıktan sonra oturum bu kadar saat geçerli kalır; süre dolunca — aktif kullanırken bile — yeniden giriş gerekir. Değişiklik yalnızca bundan sonraki girişlere uygulanır; şu an açık olan oturumlar mevcut süreleriyle devam eder."
          value={session}
          min={1}
          max={MAX_SESSION_HOURS}
          onChange={setSession}
          error={!sessionValid ? `1–${MAX_SESSION_HOURS} arası bir saat girin.` : undefined}
        />

        <div className="border-t pt-4">
          <NumberField
            id="idle-minutes"
            label="Hareketsizlik zaman aşımı (dakika)"
            desc="Panelde bu kadar dakika boyunca hiçbir işlem (fare/klavye) olmazsa oturum otomatik kapanır. Aktif kullanımda sayaç sürekli sıfırlanır. 0 = kapalı (hareketsizlikle otomatik çıkış yok)."
            value={idle}
            min={0}
            max={MAX_IDLE_MINUTES}
            onChange={setIdle}
            error={!idleValid ? `0–${MAX_IDLE_MINUTES} arası bir dakika girin (0 = kapalı).` : undefined}
          />
          {idleValid && idleNum === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Şu an kapalı: oturum yalnızca yukarıdaki süre dolunca veya elle çıkışta sona erer.
            </p>
          )}
        </div>

        <div className="border-t pt-4">
          <NumberField
            id="work-session-idle-minutes"
            label="Çalışma oturumu zaman aşımı — saha (dakika)"
            desc="Sahadaki 'kim hangi makinede' oturumu bu kadar dakika hareketsiz kalırsa kapanır; operatör bir sonraki işlemde yeniden yer onayı verir. Varsayılan 600 (10 saat): vardiya boyunca molalarda düşmez, gece açık unutulan tablet sabaha temiz oturumla başlar. 0 = kapalı."
            value={workIdle}
            min={0}
            max={MAX_IDLE_MINUTES}
            onChange={setWorkIdle}
            error={!workIdleValid ? `0–${MAX_IDLE_MINUTES} arası bir dakika girin (0 = kapalı).` : undefined}
          />
        </div>

        <div className="border-t pt-4">
          <span className="text-sm font-medium">Mobil giriş yöntemleri</span>
          <p className="text-xs text-muted-foreground">
            En az bir yöntem seçili olmalı. Sahadaki giriş ekranı <b>öncelikli</b> yöntemle
            açılır; diğer seçili yöntemler "Diğer giriş yöntemlerini dene" tuşuyla sunulur.
            Kartlar ve hızlı PIN'ler Yetkilendirme → Kullanıcılar'dan yönetilir.
          </p>
          <div className="mt-2 space-y-2">
            {(Object.keys(METHOD_LABELS) as LoginMethod[]).map((m) => (
              <label key={m} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={enabledMethods.includes(m)}
                  onChange={(e) => toggleMethod(m, e.target.checked)}
                />
                <span>
                  {METHOD_LABELS[m]}
                  <span className="block text-xs text-muted-foreground">{METHOD_DESCS[m]}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3">
            <label htmlFor="primary-method" className="text-xs font-medium">
              Öncelikli yöntem
            </label>
            <select
              id="primary-method"
              className="mt-1 flex h-9 w-64 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              value={primaryMethod}
              onChange={(e) => setPrimaryMethod(e.target.value as LoginMethod)}
            >
              {enabledMethods.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          {!methodsValid && (
            <p className="mt-1 text-xs text-destructive">
              En az bir yöntem seçin; öncelikli yöntem seçililerden biri olmalı.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={!dirty || !sessionValid || !idleValid || !workIdleValid || !methodsValid || mut.isPending}
            onClick={() =>
              mut.mutate({
                sessionDurationHours: sessionNum,
                idleTimeoutMinutes: idleNum,
                workSessionIdleTimeoutMinutes: workIdleNum,
                loginMethods: { enabled: enabledMethods, primary: primaryMethod },
              })
            }
          >
            {mut.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Oturum süresi backend tarafından (token ömrü) uygulanır; hareketsizlik zaman
            aşımı bu paneli açan her bilgisayarda geçerlidir. Çalışma oturumu zaman aşımı
            sahadaki tüm cihazlar için backend tarafından uygulanır.
          </span>
        </div>
      </div>
    </PermissionGate>
  );
}

function ReadOnlyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-medium">{label}</span>
      <span className="shrink-0 rounded-md border px-2 py-0.5 text-xs">{value}</span>
    </div>
  );
}

function NumberField({
  id,
  label,
  desc,
  value,
  min,
  max,
  onChange,
  error,
}: {
  id: string;
  label: string;
  desc: string;
  value: string;
  min: number;
  max: number;
  onChange: (next: string) => void;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <p className="text-xs text-muted-foreground">{desc}</p>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        step={1}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 flex h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
