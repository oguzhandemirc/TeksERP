#!/usr/bin/env node
// =============================================================================
// deneme-veri/hizmet-hesabi — doldurmanın HİZMET hesabını (`demoveri`) panelin resmi uçlarıyla kurar.
//
// Giriş: kurulumun süperadmini, masaüstü clientType + parola (2FA'sız olmalı; web/çerez kipinde 2FA zorunlu).
// Süperadminin parolasına/TOTP'sine/izinlerine DOKUNULMAZ. Hizmet hesabı süperadmin DEĞİLDİR; izinleri aşağıdaki dar
// kümedir (SoD üçlüsü shipping:invoice · shipping:undo-dispatch · roll:manual-adjust VERİLMEZ). İdempotent: hesap varsa
// izin kümesi yeniden yazılır (replace), Anahtar Zinciri'ndeki parola çalışıyorsa korunur, çalışmıyorsa döndürülür.
//
//   node scripts/deneme-veri/hizmet-hesabi.mjs --url https://deneme.etkiliyazilim.com \
//        --sa-sir tekserp/deneme-superadmin-parola --sir tekserp/deneme-demoveri-parola
// Çıktı sır basmaz (parola/token yok).
// =============================================================================
import { randomBytes } from "node:crypto";
import { istemciKur, zincirOku, zincirYaz, liste } from "./lib/istemci.mjs";

export const HIZMET_KULLANICISI = "demoveri";
export const HIZMET_ADI = "Demo Veri Hizmeti";
/** Doldurmanın çağırdığı uçların kapılarından türetilen küme (doldur.mjs adımları). */
export const HIZMET_IZINLERI = [
  "customer:read", "customer:write", "item:read", "item:write", "order:read", "order:write",
  "roll:read", "roll:write", "workorder:read", "workorder:write", "quality:read", "quality:write",
  "property:read", "property:write", "station:read", "station:write",
  "subcontractor:read", "subcontractor:write", "kartela:read", "kartela:write",
  "shipping:read", "shipping:write", "shipping:packing-lot", "return:read", "return:write", "label:read",
  "warehouse:read", "warehouse:write", "warehouse:transfer", "goods-receipt:read", "goods-receipt:write",
  "yarn:write", "price:write", "purchase-order:read", "purchase-order:write",
  "finance:read", "finance:write", "finance:invoice", "finance:payment", "finance:cheque",
  "warpspec:read", "warpspec:write", "warpbeam:read", "warpbeam:write", "weavingorder:read", "weavingorder:write",
  "loom:run", "loom:doff", "loom:manual-entry", "loom:classify", "loom:spec-manage", "loom:live-view", "loom:alarm-view",
  "report:production", "report:sales", "report:quality", "report:inventory", "report:subcontract", "report:customer", "report:finance",
];
export const SOD_UCLUSU = ["shipping:invoice", "shipping:undo-dispatch", "roll:manual-adjust"];

const arg = (ad, vars) => { const i = process.argv.indexOf(ad); return i > 0 ? process.argv[i + 1] : vars; };
const yeniParola = () => randomBytes(24).toString("base64url");

async function main() {
  const url = arg("--url");
  const saSir = arg("--sa-sir");
  const sir = arg("--sir");
  const saKullanici = arg("--sa-kullanici", "tekserp");
  if (!url || !saSir || !sir) throw new Error("kullanım: hizmet-hesabi.mjs --url <adres> --sa-sir <zincir servisi> --sir <zincir servisi> [--sa-kullanici tekserp]");
  if (HIZMET_IZINLERI.some((k) => SOD_UCLUSU.includes(k) || k.startsWith("admin:"))) throw new Error("izin kümesi SoD/admin kodu taşıyor");
  const saParola = zincirOku(saSir);
  if (!saParola) throw new Error(`Anahtar Zinciri'nde '${saSir}' yok`);

  const sa = istemciKur({ url, kullanici: saKullanici, parola: saParola });
  await sa.giris();
  console.log("süperadmin girişi tamam (masaüstü, parola)");
  try {
    const katalog = liste(await sa.api("GET", "/api/admin/permissions"));
    const idOf = new Map(katalog.map((p) => [p.code, p.id]));
    const eksik = HIZMET_IZINLERI.filter((c) => !idOf.has(c));
    if (eksik.length) throw new Error("izin kataloğunda olmayan kod: " + eksik.join(", "));

    let hedef = liste(await sa.api("GET", "/api/admin/users")).find((u) => String(u.username).toLowerCase() === HIZMET_KULLANICISI);
    let parola = zincirOku(sir);
    let yazilacak = null;
    if (!hedef) {
      yazilacak = yeniParola();
      hedef = (await sa.api("POST", "/api/admin/users", {
        username: HIZMET_KULLANICISI, fullName: HIZMET_ADI, password: yazilacak, grantOperatorDefaults: false, generateMobileCredentials: false,
      }, { tekDeneme: true })).data;
      console.log(`hesap oluşturuldu: ${HIZMET_KULLANICISI}`);
    } else {
      if (hedef.isSystemAccount) throw new Error(`${HIZMET_KULLANICISI} sistem hesabı — dokunulmadı`);
      if (!hedef.isActive) throw new Error(`${HIZMET_KULLANICISI} pasif — panelden aktifleştirin`);
      console.log(`hesap mevcut: ${HIZMET_KULLANICISI}`);
    }
    // İzinler parola adımından ÖNCE (izinsiz hesap masaüstü kapısında CHANNEL_DENIED alır).
    await sa.api("PUT", `/api/admin/users/${hedef.id}/permissions`, { permissions: HIZMET_IZINLERI.map((c) => ({ permissionId: idOf.get(c) })) });
    console.log(`izinler yazıldı: ${HIZMET_IZINLERI.length} kod (SoD üçlüsü yok)`);
    const totp = (await sa.api("GET", `/api/admin/users/${hedef.id}/totp`)).data;
    if (totp?.enabled) throw new Error(`${HIZMET_KULLANICISI} hesabında 2FA açık — betik giremez`);

    // Parola: yeni hesapta ilk parola; mevcutta zincirdeki çalışıyorsa korunur, çalışmıyorsa sıfırla → değiştir.
    let calisan = null;
    if (yazilacak) calisan = yazilacak;
    else if (parola) {
      const d = istemciKur({ url, kullanici: HIZMET_KULLANICISI, parola, sessiz: true, deneme: 1 });
      try { await d.giris(); calisan = parola; await d.cikis(); } catch { calisan = null; }
    }
    if (!calisan) {
      const gecici = yeniParola();
      await sa.api("POST", `/api/admin/users/${hedef.id}/reset-password`, { password: gecici }, { tekDeneme: true });
      calisan = gecici;
      console.log("parola sıfırlandı (geçici)");
    }
    // Yönetici atadığı parola GEÇİCİDİR (mustChangePassword) → hesap kendi kalıcı parolasını belirler.
    const h = istemciKur({ url, kullanici: HIZMET_KULLANICISI, parola: calisan, sessiz: true, deneme: 1 });
    const g = await h.hamIstek("POST", "/api/auth/login", { username: HIZMET_KULLANICISI, password: calisan, clientType: "electron", confirmKick: true }, { tokenli: false });
    if (g.data?.mustChangePassword) {
      const kalici = yeniParola();
      const r = await fetch(url + "/api/auth/change-password", {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + g.data.token },
        body: JSON.stringify({ currentPassword: calisan, newPassword: kalici }),
      });
      if (!r.ok) throw new Error(`parola değişimi ${r.status}`);
      calisan = kalici;
      console.log("kalıcı parola belirlendi");
    }
    if (calisan !== parola) { zincirYaz(sir, HIZMET_KULLANICISI, calisan); console.log(`parola Anahtar Zinciri'ne yazıldı: ${sir}`); }
    else console.log("Anahtar Zinciri'ndeki parola geçerli — değiştirilmedi");

    // Doğrulama: zincirdeki parolayla gir, efektif izinleri say.
    const v = istemciKur({ url, kullanici: HIZMET_KULLANICISI, parola: zincirOku(sir), sessiz: true, deneme: 1 });
    await v.giris();
    const me = (await v.api("GET", "/api/auth/me")).data ?? {};
    const perms = me.permissions ?? me.user?.permissions ?? [];
    const eksikE = HIZMET_IZINLERI.filter((c) => !perms.includes(c));
    const fazla = SOD_UCLUSU.filter((c) => perms.includes(c) || perms.includes("*"));
    await v.cikis();
    if (eksikE.length) throw new Error("efektif izinde eksik: " + eksikE.join(", "));
    if (fazla.length) throw new Error("hizmet hesabı SoD/tam yetki taşıyor: " + fazla.join(", "));
    console.log(`doğrulama tamam: ${HIZMET_KULLANICISI} girişi çalışıyor, ${HIZMET_IZINLERI.length} izin etkin, SoD yok`);
  } finally {
    await sa.cikis();
  }
}

main().catch((e) => { console.error("HATA: " + e.message); process.exit(1); });
