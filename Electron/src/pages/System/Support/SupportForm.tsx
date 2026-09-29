import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { supportService } from "@/services/supportService";
import type { ScreenshotResult } from "@shared/screenshot";
import type { SupportTicket } from "./types";

/** Yakalamadan önce kullanıcı sorunlu sekmeye geçebilsin (sekmeler bağlı kalır, sayaç sürer). */
export const CAPTURE_DELAY_SECONDS = 5;

/** Yakalama yalnız masaüstü panelinde (IPC); tarayıcı panelinde düğme çizilmez. */
export function canCaptureScreenshot(): boolean {
  return typeof window.api?.window?.captureScreenshot === "function";
}

/** Gecikmeli pencere yakalama: sayaç biter, IPC panel penceresini yakalar; sonuç önizlemeye düşer. */
function useDelayedScreenshot() {
  const [shot, setShot] = useState<ScreenshotResult | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const capture = () => {
    if (!canCaptureScreenshot() || countdown !== null) return;
    toast.info(`${CAPTURE_DELAY_SECONDS} saniye içinde sorunlu ekrana geçin; panel penceresi yakalanacak.`);
    let left = CAPTURE_DELAY_SECONDS;
    setCountdown(left);
    timer.current = setInterval(() => {
      left -= 1;
      if (left > 0) {
        setCountdown(left);
        return;
      }
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setCountdown(null);
      void window.api!.window.captureScreenshot().then((r) => {
        setShot(r);
        if (r) toast.success("Ekran görüntüsü talebe eklendi.");
        else toast.error("Ekran görüntüsü alınamadı.");
      });
    }, 1000);
  };

  return { shot, setShot, countdown, capture };
}

/**
 * Yeni destek talebi: konu + açıklama + isteğe bağlı ekran görüntüsü (yalnız panel penceresi).
 * Sağlık özeti sunucuda otomatik eklenir. clientToken mantıksal deneme başına bir kez doğar.
 */
export function SupportForm({ onCreated }: { onCreated: (t: SupportTicket) => void }) {
  const attempt = useAttemptToken();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const { shot, setShot, countdown, capture } = useDelayedScreenshot();

  const submit = async () => {
    setBusy(true);
    try {
      const t = await supportService.create({ clientToken: attempt.token(), konu: subject.trim(), aciklama: description.trim(), ekranGoruntusu: shot });
      attempt.onSuccess();
      setSubject("");
      setDescription("");
      setShot(null);
      toast.success(t.ticketNo ? `Talep iletildi: ${t.ticketNo}` : "Talep kaydedildi; satıcıya ulaşılınca gönderilecek.");
      onCreated(t);
    } catch (err) {
      attempt.onFailure(err);
      toast.error(apiErrorText(err, "Destek talebi gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const ready = subject.trim().length > 0 && description.trim().length > 0 && !busy;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Yeni destek talebi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="destek-konu">Konu</Label>
          <Input id="destek-konu" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="destek-aciklama">Açıklama</Label>
          <Textarea id="destek-aciklama" rows={6} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Sunucu sürümü, yedek durumu, disk doluluğu ve bağlı istemci sürümleri talebe otomatik eklenir; iş verisi ve kişi adı eklenmez.
        </p>
        {shot ? (
          <div className="space-y-2">
            <img src={`data:${shot.tur};base64,${shot.veri}`} alt="Talebe eklenecek ekran görüntüsü" className="max-h-48 rounded border" />
            <Button variant="outline" size="sm" onClick={() => setShot(null)}>
              Ekran görüntüsünü kaldır
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {canCaptureScreenshot() ? (
            <Button variant="outline" onClick={capture} disabled={countdown !== null || busy}>
              {countdown !== null ? `Yakalanıyor… ${countdown}` : "Ekran görüntüsü ekle"}
            </Button>
          ) : null}
          <Button onClick={() => void submit()} disabled={!ready}>
            Talebi gönder
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
