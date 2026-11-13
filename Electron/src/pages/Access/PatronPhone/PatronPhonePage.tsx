import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Info, Smartphone } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/ui/section-card";
import { getActiveApiBaseUrl } from "@/lib/api-config";
import { kipFor } from "@shared/internet-tls";
import { patronAdresiDenetle, patronKarekoduYap } from "@shared/patron-karekod";
import { ADRES_RET_METNI, varsayilanPatronAdresi } from "./patron-telefon";

/**
 * Patron telefonunu bu sunucuya bağlama karekodu. Karekod YALNIZ adresi taşır (sır yok): giriş yine kullanıcı adı +
 * parolayla, fotoğrafı başkasına geçse de parolasız girilemez — bu yüzden uzaktan (fotoğrafla) gönderilebilir.
 */
export function PatronPhonePage() {
  const [adres, setAdres] = useState(() => varsayilanPatronAdresi(getActiveApiBaseUrl(), typeof window !== "undefined" ? window.location.origin : undefined));
  const check = patronAdresiDenetle(adres);
  const karekod = check.tamam ? patronKarekoduYap(check.adres) : null;
  const host = check.tamam ? check.adres.slice("https://".length).split(":")[0] ?? "" : "";

  return (
    <PageShell>
      <PageHeader title="Patron Telefonu" description="Patron uygulamasını karekodla bu fabrikanın sunucusuna bağlayın." />
      <PageBody className="space-y-4">
        <SectionCard title="Sunucu adresi" description="Patron telefonunun internetten ulaşacağı https adresi. Varsayılan, bu panelin bağlandığı adrestir.">
          <div className="max-w-xl space-y-1.5">
            <Label htmlFor="patron-adres">Adres</Label>
            <Input id="patron-adres" value={adres} onChange={(e) => setAdres(e.target.value)} spellCheck={false} autoComplete="off" placeholder="https://erp.fabrikaniz.com" />
          </div>
        </SectionCard>

        {check.tamam && karekod ? (
          <SectionCard title="Bağlantı karekodu">
            <div className="flex flex-wrap items-start gap-6">
              <div className="rounded-md bg-white p-3">
                <QRCodeSVG value={karekod} size={220} level="M" data-testid="patron-karekod" />
              </div>
              <div className="max-w-md space-y-3 text-sm">
                <p className="font-mono text-base" data-testid="patron-karekod-adres">{check.adres}</p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Patron uygulamasında “Fabrika sunucusuna bağlan” → “Karekod okut”a dokunun.</li>
                  <li>Bu karekodu okutun (yanınızda değilse fotoğrafını gönderebilirsiniz).</li>
                  <li>Kullanıcı adı ve parolanızla giriş yapın.</li>
                </ol>
                <p className="text-muted-foreground">
                  Karekod yalnız sunucu adresini taşır; parola ya da giriş anahtarı içermez. Giriş için kullanıcının rolünde “Patron
                  telefon uygulamasıyla giriş” yetkisi olmalıdır.
                </p>
              </div>
            </div>
          </SectionCard>
        ) : (
          <Callout tone="warning" icon={AlertTriangle} title="Karekod üretilmedi">
            <span data-testid="patron-karekod-neden">{ADRES_RET_METNI[check.tamam ? "gecersiz" : check.neden]}</span>
          </Callout>
        )}

        {check.tamam && kipFor(host) === "sabitli" && (
          <Callout tone="info" icon={Info} title="Sertifikayı denetleyin">
            Telefon bu adrese genel (internet) sertifikasıyla bağlanır. Adres fabrika içi şifreli bağlantının kendi sertifikasını
            kullanıyorsa telefon bağlanamaz; o durumda alan adınızın internet sertifikalı adresini yazın.
          </Callout>
        )}
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Smartphone className="h-3.5 w-3.5" /> Karekod okutma telefon uygulamasının yeni sürümüyle gelir; eski sürümde adres elle yazılır.
        </p>
      </PageBody>
    </PageShell>
  );
}
