// =============================================================================
// BİLDİRİM HTTP FİKSTÜRÜ — süreç içi sunucu + kendi kullanıcıları (test_bildirim_api · test_bildirim_zil)
// =============================================================================
// Sunucu bu sürecin içinde 127.0.0.1:0'da açılır (ikinci kalıcı süreç yok); kullanıcılar koşuma özgü
// parolayla yaratılır ve HTTP girişiyle token alınır. Temizlik yalnız kendi kullanıcılarına dokunur.
// =============================================================================
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as bcrypt from "bcryptjs";
import prisma from "../../src/lib/prisma";
import app from "../../src/app";
import { SETTING_KEYS } from "../../src/services/system-setting.service";
import { kosumaOzguParola } from "../fixture-test-user";

export interface FiksturKullanici {
  id: string;
  username: string;
  token: string;
}

export class BildirimFikstur {
  server: Server | null = null;
  base = "";
  readonly users: string[] = [];
  private readonly parola = kosumaOzguParola();
  private bayrakIlk: { value: unknown } | null | undefined;

  constructor(private readonly tag: string) {}

  async ac(): Promise<void> {
    this.server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
    this.bayrakIlk = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  }

  async bayrak(v: boolean): Promise<void> {
    const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  }

  async kullanici(ek: string, kodlar: string[]): Promise<FiksturKullanici> {
    const izinler = await prisma.permission.findMany({ where: { code: { in: kodlar } }, select: { id: true } });
    if (izinler.length !== kodlar.length) throw new Error(`izin kataloğu eksik: ${kodlar.join(",")}`);
    const u = await prisma.user.create({
      data: {
        username: `${this.tag}-${ek}`,
        passwordHash: await bcrypt.hash(this.parola, 10),
        fullName: `${this.tag} ${ek}`,
        isActive: true,
        permissions: { create: izinler.map((p) => ({ permissionId: p.id })) },
      },
      select: { id: true, username: true },
    });
    this.users.push(u.id);
    return { ...u, token: await this.giris(u.username) };
  }

  async giris(username: string): Promise<string> {
    const r = await fetch(`${this.base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: this.parola, clientType: "electron" }),
    });
    const token = ((await r.json()) as { data?: { token?: string } }).data?.token;
    if (!token) throw new Error(`giriş başarısız (${r.status}) ${username}`);
    return token;
  }

  async istek(token: string | null, method: string, yol: string, body?: unknown): Promise<{ status: number; json: any }> {
    const r = await fetch(`${this.base}${yol}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: r.status, json };
  }

  async kapat(): Promise<void> {
    const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
    if (this.bayrakIlk) await prisma.systemSetting.update({ where: { key }, data: { value: this.bayrakIlk.value as never } });
    else if (this.bayrakIlk === null) await prisma.systemSetting.deleteMany({ where: { key } });
    if (this.users.length) {
      await prisma.notificationInbox.deleteMany({ where: { userId: { in: this.users } } });
      await prisma.session.deleteMany({ where: { userId: { in: this.users } } });
      await prisma.userPermission.deleteMany({ where: { userId: { in: this.users } } });
      await prisma.user.deleteMany({ where: { id: { in: this.users } } }).catch(async () => {
        // Başka tablolar (audit vb.) bağlıysa satır kalır ama pasifleşir — bir sonraki koşumu etkilemez.
        await prisma.user.updateMany({ where: { id: { in: this.users } }, data: { isActive: false } });
      });
    }
    const s = this.server;
    this.server = null;
    if (s) {
      s.closeAllConnections();
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  }
}
