// Bildirim ayarları formu (görünüm): ana anahtar ("bildirim yok" dahil), tür başına aç/kapat, sessiz saatler,
// eşikler. İzni yetmeyen tür gösterilir ama açıklanır (sunucu zaten göndermez) — kullanıcı neden gelmediğini bilsin.
import { View } from "react-native";
import type { NotificationKindInfo } from "../api/wire";
import { notificationKind } from "../lib/labels/diger";
import type { NotificationForm } from "../lib/notification-form";
import { GroupCaption, GroupNote, ToggleRow } from "./diger/parts";
import { Field } from "./kit";
import { ListGroup } from "./ListRow";
import { SectionHeader } from "./SectionHeader";
import { space } from "./tokens";

export function NotificationSettingsForm(p: { form: NotificationForm; kinds: readonly NotificationKindInfo[]; onChange: (f: NotificationForm) => void }) {
  const f = p.form;
  const set = <K extends keyof NotificationForm>(k: K, v: NotificationForm[K]) => p.onChange({ ...f, [k]: v });
  return (
    <View>
      <ListGroup>
        <ToggleRow label="Bildirimler açık" hint="Kapalıyken hiçbir bildirim gelmez" value={f.acik} onChange={(v) => set("acik", v)} testID="bildirim-ana"
          icon={f.acik ? "notifications" : "notifications-off-outline"} domain="gelenKutusu" />
      </ListGroup>
      <GroupCaption>Bildirim türleri</GroupCaption>
      <ListGroup testID="bildirim-turleri">
        {p.kinds.map((k) => {
          const look = notificationKind(k.tur);
          return (
            <ToggleRow key={k.tur} label={k.finans ? `${k.ad} (finans)` : k.ad} testID={`tur-${k.tur}`} icon={look.icon} domain={look.domain}
              hint={k.izinli ? k.aciklama : "Yetkiniz bu bildirimi almaya yetmiyor"}
              value={f.turler[k.tur]} disabled={!f.acik || !k.izinli}
              onChange={(v) => set("turler", { ...f.turler, [k.tur]: v })} />
          );
        })}
      </ListGroup>
      <GroupCaption>Sessiz saatler</GroupCaption>
      <ListGroup>
        <ToggleRow label="Sessiz saatler" hint="Bu aralıkta doğan bildirim aralık bitince gelir (İstanbul saati)" value={f.sessizAcik} onChange={(v) => set("sessizAcik", v)}
          disabled={!f.acik} testID="sessiz" icon="moon-outline" domain="uretim" />
        {f.sessizAcik ? (
          <View style={{ flexDirection: "row", gap: space.m, paddingHorizontal: space.l, paddingTop: space.m }}>
            <View style={{ flex: 1 }}><Field label="Başlangıç" value={f.baslangic} onChangeText={(t) => set("baslangic", t.slice(0, 5))} placeholder="22:00" /></View>
            <View style={{ flex: 1 }}><Field label="Bitiş" value={f.bitis} onChangeText={(t) => set("bitis", t.slice(0, 5))} placeholder="07:00" /></View>
          </View>
        ) : null}
      </ListGroup>
      <SectionHeader title="Eşikler" />
      <GroupNote>Boş bırakılan eşik kapalıdır. Değerler fabrikanın gönderdiği özetle karşılaştırılır.</GroupNote>
      <ListGroup testID="bildirim-esikler">
        <View style={{ paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: space.xs }}>
          <Field label="Ham stok şu miktarın altına inince" value={f.hamStokAlt} onChangeText={(t) => set("hamStokAlt", t)} keyboardType="decimal-pad" />
          <Field label="Bitmiş stok şu miktarın altına inince" value={f.bitmisStokAlt} onChangeText={(t) => set("bitmisStokAlt", t)} keyboardType="decimal-pad" />
          <Field label="Geciken sipariş kalemi şu sayıyı aşınca" value={f.gecikenKalemUst} onChangeText={(t) => set("gecikenKalemUst", t)} keyboardType="number-pad" />
          <Field label="Günlük üretim şu miktarın altındaysa" value={f.gunlukUretimAlt} onChangeText={(t) => set("gunlukUretimAlt", t)} keyboardType="decimal-pad" />
          <Field label="Günlük üretim kontrol saati (0–23)" value={f.gunlukUretimSaati} onChangeText={(t) => set("gunlukUretimSaati", t.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" />
          <Field label="Fabrikadan şu kadar dakika veri gelmezse" value={f.esitlemeGecikmeDk} onChangeText={(t) => set("esitlemeGecikmeDk", t.replace(/\D/g, "").slice(0, 5))} keyboardType="number-pad" />
        </View>
      </ListGroup>
    </View>
  );
}
