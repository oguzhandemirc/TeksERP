import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import type { SameTypeSessionPolicy } from "@/types/auth";
import { SAME_TYPE_SESSION_POLICY_OPTIONS } from "@/lib/session-auth";
import { DurationField } from "./DurationField";
import { LoginMethodsField } from "./LoginMethodsField";
import { SessionSettingsReadOnly } from "./SessionSettingsReadOnly";
import {
  MAX_SESSION_MINUTES,
  MAX_IDLE_MINUTES,
  MIN_MOBILE_IDLE_LOCK_MIN,
  MAX_MOBILE_IDLE_LOCK_MIN,
  useSessionSettingsForm,
} from "./useSessionSettingsForm";

/**
 * Oturum & Güvenlik paneli — TEKDÜZE dakika modeli (durum/mantık
 * `useSessionSettingsForm`'da). Yukarıdan aşağı:
 *  1) Oturum süresi (dakika) — DurationField, backend `sessionDurationMinutes`.
 *  2) Token dolunca otomatik çıkış (switch) — client ENFORCE.
 *  3) Panel hareketsizlik çıkışı (bu bilgisayar) — DurationField toggle (0=kapalı).
 *  4) Mobil hareketsizlik kilidi — DurationField toggle (ayrı switch + dakika).
 *  5) Çalışma oturumu zaman aşımı — saha — DurationField toggle (0=kapalı).
 *  6) Aynı tip oturum politikası (select) — backend (login) ENFORCE.
 *  7) Mobil giriş yöntemleri.
 * Tek Kaydet + admin:settings yetkisi ister.
 */
export function SessionSettingsSection() {
  const s = useSessionSettingsForm();
  if (s.isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <PermissionGate
      permission="admin:settings"
      fallback={
        <SessionSettingsReadOnly
          sessionMinutes={s.current.sessionMin}
          idleMinutes={s.current.idle}
          autoLogout={s.current.autoLogout}
          policy={s.current.policy}
          workIdleMinutes={s.current.workIdle}
          mobileLock={s.current.mobileLock}
          mobileLockMinutes={s.current.mobileLockMin}
          methods={s.current.methods}
        />
      }
    >
      <div className="space-y-5">
        {/* 1) Oturum zaman aşımı — TEK ayar: aç/kapa + süre. Açık: süre dolunca
            sistem OTOMATİK çıkarır. Kapalı: oturum süresiz (zaman aşımı yok);
            toggle kapalıyken dakika input'u da pasifleşir. */}
        <DurationField
          label="Oturum zaman aşımı — token ömrü (dakika)"
          desc="Açıkken oturum bu kadar dakika sonra dolar ve sistem kullanıcıyı OTOMATİK çıkarır (mobil + bu bilgisayar). Kapalıyken oturum süresiz olur — zaman aşımıyla çıkış yok (yönetici yine iptal edebilir). Değişiklik yalnızca sonraki girişlere uygulanır; şu an açık oturumlar mevcut süreleriyle devam eder."
          valueMinutes={s.sessionMin}
          onChangeMinutes={s.setSessionMin}
          maxMinutes={MAX_SESSION_MINUTES}
          minMinutes={1}
          toggle={{
            enabled: s.autoLogout,
            onToggle: s.setAutoLogout,
            label: "Token dolunca otomatik çıkış",
          }}
          error={
            s.autoLogout && !s.sessionValid
              ? `1–${MAX_SESSION_MINUTES} arası bir dakika girin.`
              : undefined
          }
        />

        {/* 3) Panel hareketsizlik çıkışı */}
        <div className="border-t pt-4">
          <DurationField
            label="Yönetim paneli hareketsizlik çıkışı süresi"
            desc="Bu bilgisayarda (hangi program açık olursa olsun) bu kadar dakika hiç fare/klavye hareketi olmazsa yönetim paneli oturumu kapanır. Sistem-geneli sayılır: başka programla çalışırken de sayaç sıfırlanır, yalnız kimse bilgisayara hiç dokunmadığında çıkış olur. Ayar tüm panel bilgisayarları için geçerlidir ama her bilgisayar kendi boşta süresini kendi sayar (ayar ortak, çıkış her bilgisayara özeldir). Kapalıyken hareketsizlikle çıkış olmaz. Açık paneller yeni ayarı kısa sürede otomatik alır."
            valueMinutes={s.idleMin}
            onChangeMinutes={s.setIdleMin}
            maxMinutes={MAX_IDLE_MINUTES}
            minMinutes={1}
            toggle={{
              enabled: s.idleEnabled,
              onToggle: s.toggleIdle,
              label: "Yönetim paneli hareketsizlik çıkışı",
            }}
            error={
              s.idleEnabled && !s.idleValid
                ? `1–${MAX_IDLE_MINUTES} arası bir dakika girin.`
                : undefined
            }
          />
        </div>

        {/* 4) Mobil hareketsizlik kilidi */}
        <div className="border-t pt-4">
          <DurationField
            label="Mobil kilit süresi"
            desc="Açıkken (varsayılan) tablet/telefon bu kadar dakika kullanılmazsa kilit ekranı gelir; iş oturumu açık kalır, operatör kart/PIN ile hızlıca devam eder. Kapalıyken mobilde hareketsizlik kilidi hiç devreye girmez. Açık tabletler yeni ayarı kısa sürede otomatik alır (uygulama öne gelince); yeni girişlerde hemen geçerli."
            valueMinutes={s.mobileLockMin}
            onChangeMinutes={s.setMobileLockMin}
            maxMinutes={MAX_MOBILE_IDLE_LOCK_MIN}
            minMinutes={MIN_MOBILE_IDLE_LOCK_MIN}
            toggle={{
              enabled: s.mobileLock,
              onToggle: s.setMobileLock,
              label: "Mobil hareketsizlik kilidi",
            }}
            error={
              s.mobileLock && !s.mobileLockMinValid
                ? `${MIN_MOBILE_IDLE_LOCK_MIN}–${MAX_MOBILE_IDLE_LOCK_MIN} arası bir dakika girin.`
                : undefined
            }
          />
        </div>

        {/* 5) Çalışma oturumu zaman aşımı — saha */}
        <div className="border-t pt-4">
          <DurationField
            label="Çalışma oturumu zaman aşımı süresi — saha"
            desc="Bir tablet bu kadar dakika hiç kullanılmazsa oradaki iş oturumu otomatik kapanır ve makine yeniden boşa düşer. Operatör bir sonraki işlemde yeniden yer onayı verir. Kapalıyken saha oturumu hareketsizlikle kapanmaz. Değişiklik hemen geçerli — açık oturumlar da yeni süreye göre değerlendirilir."
            valueMinutes={s.workMin}
            onChangeMinutes={s.setWorkMin}
            maxMinutes={MAX_IDLE_MINUTES}
            minMinutes={1}
            toggle={{
              enabled: s.workEnabled,
              onToggle: s.toggleWork,
              label: "Çalışma oturumu zaman aşımı (saha)",
            }}
            error={
              s.workEnabled && !s.workValid
                ? `1–${MAX_IDLE_MINUTES} arası bir dakika girin.`
                : undefined
            }
          />
        </div>

        {/* 6) Aynı tip oturum politikası */}
        <div className="border-t pt-4">
          <label htmlFor="same-type-policy" className="text-sm font-medium">
            Aynı hesap aynı cihaz tipinde ikinci kez açılırsa
          </label>
          <p className="text-xs text-muted-foreground">
            Aynı kullanıcı aynı tip cihazda (ör. iki bilgisayar ya da iki telefon) ikinci
            kez giriş yaptığında ne olacağı. Farklı tipler (1 bilgisayar + 1 telefon) her
            zaman serbesttir. Değişiklik sonraki girişlerde geçerli olur.
          </p>
          <select
            id="same-type-policy"
            className="mt-2 flex h-9 w-80 max-w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            value={s.policy}
            onChange={(e) => s.setPolicy(e.target.value as SameTypeSessionPolicy)}
          >
            {SAME_TYPE_SESSION_POLICY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* 7) Mobil giriş yöntemleri */}
        <LoginMethodsField
          enabled={s.enabledMethods}
          primary={s.primaryMethod}
          valid={s.methodsValid}
          onToggle={s.toggleMethod}
          onPrimaryChange={s.setPrimaryMethod}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={!s.dirty || !s.allValid || s.isSaving}
            onClick={s.save}
          >
            {s.isSaving ? "Kaydediliyor…" : "Kaydet"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Oturum süresi + same-type politikası backend tarafından uygulanır; panel
            hareketsizlik çıkışı her panel bilgisayarında kendi başına, mobil kilit sahadaki cihazlarda çalışır.
            Çalışma oturumu zaman aşımı tüm saha cihazları için backend tarafından uygulanır.
          </span>
        </div>
      </div>
    </PermissionGate>
  );
}
