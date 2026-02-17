import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { name: "Adrian" },
    update: {},
    create: { name: "Adrian" },
  });

  console.log(`User: ${user.name} (${user.id})`);

  const defaults = [
    { query: "vintage jacket", count: 10 },
    { query: "vintage pant", count: 10 },
  ];

  for (const { query, count } of defaults) {
    await prisma.searchQuery.upsert({
      where: { userId_query: { userId: user.id, query } },
      update: {},
      create: { query, count, userId: user.id },
    });
  }

  console.log("Seeded default queries");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
