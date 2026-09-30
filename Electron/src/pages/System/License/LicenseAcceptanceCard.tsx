import { Fragment, useState, type ReactNode } from "react";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAttemptToken } from "@/lib/attemptToken";
import { apiErrorText } from "@/lib/api-error";
import { acceptanceGate, inlineSegments } from "@/lib/license/acceptance";
import { licenseService } from "@/services/licenseService";
import type { AcceptanceBlock, LicenseAcceptanceView } from "@/types/license";
import { LICENSE_ACCEPTANCE_KEY } from "./hooks";
import { InfoRow, LicenseCard, when } from "./LicenseParts";

const NAME_MIN = 2;
const NAME_MAX = 120;

const STATE_TEXT: Record<Exclude<LicenseAcceptanceView["durum"], "GECERLI">, string> = {
  YOK: "Bu kurulum için sözleşme henüz kabul edilmedi. Etkinleştirme kabulden sonra açılır.",
  METIN_DEGISTI: "Sözleşme metni güncellendi; önceki kabul bu metni kapsamıyor. Yeni metni okuyup kabul edin.",
  ANAHTAR_DEGISTI: "Bu sunucunun lisans anahtarı değişti (yeni makine ya da taşıma); sözleşmeyi bu sunucuda yeniden kabul edin.",
};

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineSegments(text).map((s, i) =>
        s.bold ? <strong key={i}>{s.text}</strong> : s.italic ? <em key={i}>{s.text}</em> : <Fragment key={i}>{s.text}</Fragment>,
      )}
    </>
  );
}

/** Metin bloğu: paragraf · madde · kutu · alan · düğme — kutu/alan/düğme yerine çağıranın verdiği denetim çizilir. */
function Blocks({ blocks, box, fields, buttons }: {
  blocks: AcceptanceBlock[];
  box: (b: Extract<AcceptanceBlock, { tur: "kutu" }>) => ReactNode;
  fields: ReactNode;
  buttons: ReactNode;
}) {
  const hasFields = blocks.some((b) => b.tur === "alanlar");
  const hasButtons = blocks.some((b) => b.tur === "dugmeler");
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        if (b.tur === "paragraf") {
          return (
            <p key={i}>
              {b.satirlar.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  <Inline text={l} />
                </Fragment>
              ))}
            </p>
          );
        }
        if (b.tur === "liste") {
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-5">
              {b.maddeler.map((m, j) => (
                <li key={j}>
                  <Inline text={m} />
                </li>
              ))}
            </ul>
          );
        }
        if (b.tur === "kutu") return <Fragment key={i}>{box(b)}</Fragment>;
        if (b.tur === "alanlar") return <Fragment key={i}>{fields}</Fragment>;
        return <Fragment key={i}>{buttons}</Fragment>;
      })}
      {!hasFields && fields}
      {!hasButtons && buttons}
    </div>
  );
}

function AcceptanceForm({ view }: { view: LicenseAcceptanceView }) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [fullName, setFullName] = useState(view.oneri.adSoyad ?? "");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const allChecked = view.metin.kutular.every((no) => checked[no] === true);
  const ready = allChecked && fullName.trim().length >= NAME_MIN && title.trim().length >= NAME_MIN && !busy;
  const reset = () => {
    setChecked({});
    setTitle("");
    attempt.renew();
  };
  const submit = async () => {
    setBusy(true);
    try {
      await licenseService.accept({
        clientToken: attempt.token(),
        metinKimligi: view.metin.kimlik,
        metinOzeti: view.metin.ozet,
        kutular: view.metin.kutular.filter((no) => checked[no]),
        adSoyad: fullName.trim(),
        unvan: title.trim(),
      });
      attempt.onSuccess();
      toast.success("Sözleşme kabul edildi; etkinleştirme açıldı.");
      await qc.invalidateQueries({ queryKey: LICENSE_ACCEPTANCE_KEY });
    } catch (err) {
      attempt.onFailure(err);
      toast.error(apiErrorText(err, "Sözleşme kabulü kaydedilemedi."));
      // Metin değiştiyse ekrandaki metin bayattır: taze metin yüklenir, kutular yeniden işaretlenir.
      await qc.invalidateQueries({ queryKey: LICENSE_ACCEPTANCE_KEY });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Blocks
      blocks={view.metin.bloklar}
      box={(b) => (
        <label className="flex items-start gap-2 rounded-md border p-2">
          <Checkbox
            className="mt-0.5"
            checked={checked[b.no] === true}
            onCheckedChange={(v) => setChecked((c) => ({ ...c, [b.no]: v === true }))}
            aria-label={`Onay ${b.no}`}
          />
          <span>
            <strong>{b.no}.</strong> <Inline text={b.metin} />
          </span>
        </label>
      )}
      fields={
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="kabul-ad">Ad Soyad</Label>
            <Input id="kabul-ad" value={fullName} maxLength={NAME_MAX} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kabul-unvan">Unvan</Label>
            <Input id="kabul-unvan" value={title} maxLength={NAME_MAX} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </div>
      }
      buttons={
        <div className="flex flex-wrap gap-2 pt-1">
          <Button disabled={!ready} onClick={() => void submit()}>
            Kabul ediyorum ve devam et
          </Button>
          <Button variant="outline" disabled={busy} onClick={reset}>
            Vazgeç
          </Button>
        </div>
      }
    />
  );
}

/** Kabul edilmiş metnin salt-okunur hâli: kutular işaretli metin olarak. */
function ReadOnlyText({ view }: { view: LicenseAcceptanceView }) {
  return (
    <Blocks
      blocks={view.metin.bloklar.filter((b) => b.tur !== "alanlar" && b.tur !== "dugmeler")}
      box={(b) => (
        <p>
          ☑ <strong>{b.no}.</strong> <Inline text={b.metin} />
        </p>
      )}
      fields={null}
      buttons={null}
    />
  );
}

function History({ view }: { view: LicenseAcceptanceView }) {
  if (view.kayitlar.length === 0) return <p className="text-xs text-muted-foreground">Kabul kaydı yok.</p>;
  return (
    <div className="space-y-1.5" data-testid="lisans-kabul-kayitlari">
      {view.kayitlar.map((r) => (
        <div key={r.kabulId} className="rounded-md border p-2 text-xs">
          <InfoRow label="Kabul zamanı">{when(r.zaman)}</InfoRow>
          <InfoRow label="Kabul eden">{`${r.adSoyad} · ${r.unvan}`}</InfoRow>
          <InfoRow label="Oturum">{r.kabulEden.ad}</InfoRow>
          <InfoRow label="Metin">
            <span className="font-mono">{`${r.metinKimligi} · ${r.metinOzeti.slice(0, 12)}…`}</span>
          </InfoRow>
          {r.anahtarKimligi !== view.anahtarKimligi && <InfoRow label="Not">Başka bir sunucu anahtarına ait</InfoRow>}
        </div>
      ))}
    </div>
  );
}

/**
 * SÖZLEŞME KABULÜ (Ek-7) — etkinleştirmenin ön şartı. Metin backend'den gelir (tek kaynak hukuk belgesi); kutular
 * önceden işaretli gelmez, düğme bütün kutular + ad + unvan dolmadan açılmaz. Kabul bu sunucunun anahtarına bağlıdır.
 */
export function LicenseAcceptanceCard({ q, canManage, active }: {
  q: UseQueryResult<LicenseAcceptanceView>;
  canManage: boolean;
  active: boolean;
}) {
  const [showText, setShowText] = useState(false);
  const view = q.data;
  const gate = acceptanceGate(q);
  const badge = view ? (
    <div className="flex gap-1.5">
      {view.metin.taslak && <Badge variant="outline">Taslak metin</Badge>}
      <Badge variant={view.durum === "GECERLI" ? "secondary" : "destructive"}>{view.durum === "GECERLI" ? "Kabul edildi" : "Kabul bekleniyor"}</Badge>
    </div>
  ) : undefined;
  return (
    <LicenseCard title="Lisans sözleşmesi" action={badge}>
      {q.isLoading && <Skeleton className="h-24 w-full" />}
      {!view && !q.isLoading && gate.reason && (
        <Callout tone="warning" title="Sözleşme kabulü okunamadı">
          {gate.reason}
        </Callout>
      )}
      {view && view.metin.taslak && (
        <p className="text-xs text-muted-foreground">Metin avukat onayı bekleyen taslaktır ({view.metin.kimlik}); onaylı sürüm yayımlanınca yeniden kabul istenir.</p>
      )}
      {view && view.durum === "GECERLI" && view.gecerli && (
        <div className="space-y-1.5">
          <InfoRow label="Kabul eden">{`${view.gecerli.adSoyad} · ${view.gecerli.unvan}`}</InfoRow>
          <InfoRow label="Kabul zamanı">{when(view.gecerli.zaman)}</InfoRow>
          <InfoRow label="Metin">{view.gecerli.metinKimligi}</InfoRow>
        </div>
      )}
      {view && view.durum !== "GECERLI" && (
        <Callout tone={active ? "muted" : "warning"} title={active ? "Kabul kaydı yok" : "Etkinleştirmeden önce"}>
          {STATE_TEXT[view.durum]}
        </Callout>
      )}
      {view && view.durum !== "GECERLI" && canManage && !active && <AcceptanceForm key={view.metin.ozet} view={view} />}
      {view && (view.durum === "GECERLI" || active || !canManage) && (
        <div className="space-y-2 pt-1">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setShowText((s) => !s)}>
            {showText ? "Metni gizle" : "Metni göster"}
          </Button>
          {showText && <ReadOnlyText view={view} />}
          <div className="pt-1">
            <p className="pb-1 text-xs font-medium">Kabul kayıtları</p>
            <History view={view} />
          </div>
        </div>
      )}
    </LicenseCard>
  );
}
