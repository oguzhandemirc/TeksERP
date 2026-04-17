import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Assigning item permissions to all roles...");

  const readPerm = await prisma.permission.findUnique({ where: { code: "item:read" } });
  const writePerm = await prisma.permission.findUnique({ where: { code: "item:write" } });

  if (!readPerm || !writePerm) throw new Error("Permissions not found!");

  const roles = await prisma.role.findMany();
  
  for (const role of roles) {
    // Give everyone item:read
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: readPerm.id } },
      update: {},
      create: { roleId: role.id, permissionId: readPerm.id },
    });

    // Give Planning (Planlama Şefi) write access too
    if (role.name === "Planlama Şefi") {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: writePerm.id } },
        update: {},
        create: { roleId: role.id, permissionId: writePerm.id },
      });
    }
  }

  console.log("Permissions assigned successfully.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
