import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const admin = await prisma.user.upsert({
    where: { channel_externalId: { channel: "telegram", externalId: "admin001" } },
    update: {},
    create: { name: "Admin", channel: "telegram", externalId: "admin001", role: "ADMIN" },
  });

  const reza = await prisma.user.upsert({
    where: { channel_externalId: { channel: "telegram", externalId: "reza001" } },
    update: {},
    create: { name: "رضا", channel: "telegram", externalId: "reza001", role: "EMPLOYEE" },
  });

  const ali = await prisma.user.upsert({
    where: { channel_externalId: { channel: "telegram", externalId: "ali001" } },
    update: {},
    create: { name: "علی", channel: "telegram", externalId: "ali001", role: "EMPLOYEE" },
  });

  const saadatabad = await prisma.project.upsert({
    where: { id: "proj-saadatabad" },
    update: {},
    create: { id: "proj-saadatabad", name: "سعادت‌آباد" },
  });

  const pasdaran = await prisma.project.upsert({
    where: { id: "proj-pasdaran" },
    update: {},
    create: { id: "proj-pasdaran", name: "پاسداران" },
  });

  const vank = await prisma.project.upsert({
    where: { id: "proj-vank" },
    update: {},
    create: { id: "proj-vank", name: "ونک" },
  });

  await prisma.userProject.upsert({
    where: { userId_projectId: { userId: admin.id, projectId: saadatabad.id } },
    update: {},
    create: { userId: admin.id, projectId: saadatabad.id },
  });
  await prisma.userProject.upsert({
    where: { userId_projectId: { userId: admin.id, projectId: pasdaran.id } },
    update: {},
    create: { userId: admin.id, projectId: pasdaran.id },
  });
  await prisma.userProject.upsert({
    where: { userId_projectId: { userId: admin.id, projectId: vank.id } },
    update: {},
    create: { userId: admin.id, projectId: vank.id },
  });

  await prisma.userProject.upsert({
    where: { userId_projectId: { userId: reza.id, projectId: saadatabad.id } },
    update: {},
    create: { userId: reza.id, projectId: saadatabad.id },
  });
  await prisma.userProject.upsert({
    where: { userId_projectId: { userId: reza.id, projectId: pasdaran.id } },
    update: {},
    create: { userId: reza.id, projectId: pasdaran.id },
  });

  await prisma.userProject.upsert({
    where: { userId_projectId: { userId: ali.id, projectId: vank.id } },
    update: {},
    create: { userId: ali.id, projectId: vank.id },
  });

  console.log("Seed completed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });