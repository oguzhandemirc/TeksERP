// Yeni renk (V5c, yalnız ERP): kod fabrikada doğar; ad mükerreri fabrikada 409. Gönderim `useWrite` (deneme kimliği
// kuralı); fabrika renk doğuşunda kimlik almaz, belirsiz tekrardaki ad mükerreri "önceki deneme" iletisine çevrilir.
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ApiError } from "../../../src/api/client";
import { islemVar } from "../../../src/api/yetenek";
import { renkGovdesi, tanimEkleHatasi, type RenkFormu } from "../../../src/lib/duzenleme";
import { invalidate } from "../../../src/state/changes";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { Banner, Button, Card, Field, Muted } from "../../../src/ui/kit";
import { useWrite } from "../../../src/ui/useWrite";

export default function NewColor() {
  const { yazici, permissions, offline } = useSession();
  const router = useRouter();
  const [f, setF] = useState<RenkFormu>({ ad: "", hex: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const built = renkGovdesi(f);
  const belirsiz = useRef(false);
  const send = useCallback(async (id: string) => {
    if (!built.ok) throw new Error(built.error);
    try {
      const r = await yazici.renkEkle(id, built.body);
      belirsiz.current = false;
      return r;
    } catch (err) {
      const once = belirsiz.current;
      belirsiz.current = err instanceof ApiError && err.ambiguous;
      throw tanimEkleHatasi(err, once, "Renk");
    }
  }, [yazici, built]);
  const w = useWrite(send);
  if (!islemVar("renk.ekle", permissions)) return <Screen title="Yeni renk" module="renkler" back><Muted>Bu işlem için yetkiniz yok.</Muted></Screen>;

  async function submit() {
    if (!built.ok) return setFormError(built.error);
    setFormError(null);
    const r = await w.run(JSON.stringify(built.body));
    if (r) {
      invalidate(["renk"]);
      router.back();
    }
  }
  const shown = formError ?? w.error;
  return (
    <Screen title="Yeni renk" module="renkler" back>
      <Card domain="uretim">
        <Field label="Ad" value={f.ad} onChangeText={(v) => setF((o) => ({ ...o, ad: v }))} testID="renk-ad" placeholder="Örn. 055 BEYAZ" />
        <Field label="Renk kodu (isteğe bağlı)" value={f.hex} onChangeText={(v) => setF((o) => ({ ...o, hex: v }))} testID="renk-hex" placeholder="#RRGGBB" autoCapitalize="characters" />
      </Card>
      {offline ? <Banner tone="off" text="Sunucuya ulaşılamıyor; değişiklik yapılamaz" testID="yazma-kapali" /> : null}
      {shown ? <Banner tone="error" text={shown} testID="renk-hata" /> : null}
      <Button label={belirsiz.current && shown ? "Tekrar dene" : "Kaydet"} icon="checkmark-circle-outline" busy={w.busy} disabled={w.disabled} onPress={() => void submit()} testID="renk-gonder" />
    </Screen>
  );
}
