import { ShieldAlert, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Uzaktan girmek için 2FA kurulmalı" ekranı (403 TOTP_ENROLLMENT_REQUIRED).
 *
 * ⚠️ BURADA "KENDİN KUR" DÜĞMESİ YOK ve bu bilinçli. Kurulumun tek yolu bir
 * yöneticinin açtığı tek kullanımlık penceredir; "parola doğruysa kullanıcı
 * kendi kursun" 2FA'nın koruduğu TEK senaryoyu kapatırdı (parola sızmışsa
 * saldırgan kendi telefonunu bağlar ve meşru sahibi kilitler).
 *
 * Bu yüzden ekranın işi bir eylem sunmak değil, DOĞRU ADIMI söylemek.
 */
export function TotpEnrollmentNotice({ onBack }: { onBack: () => void }) {
  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="flex flex-col items-center space-y-4 text-center">
        <div className="relative">
          <div className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-amber-500/20 via-orange-500/15 to-red-500/20 blur-2xl" />
          <div className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-muted shadow-lg ring-1 ring-white/10">
            <ShieldAlert className="h-9 w-9 text-amber-500" />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">
            İki adımlı doğrulama gerekli
          </h2>
          <p className="text-sm text-muted-foreground">
            Şifren doğru, ancak dışarıdan bağlanabilmek için hesabına iki adımlı
            doğrulama kurulmuş olmalı.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <p className="font-medium">Ne yapmalısın</p>
        <p className="mt-1.5 text-muted-foreground">
          Sistem yöneticinden <span className="font-medium text-foreground">kurulum
          bağlantısı</span> iste. Bağlantı 15 dakika geçerlidir ve telefonundaki
          doğrulama uygulamasıyla bir kez okutman yeterlidir.
        </p>
      </div>

      <Button type="button" variant="outline" className="w-full" onClick={onBack}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Giriş ekranına dön
      </Button>
    </div>
  );
}
