// scripts/seed-loadtest-users.js
import prisma from "../../../../src/config/db.js";// adjust to your actual path

const N = 50;
for (let i = 1; i <= N; i++) {
  await prisma.user.upsert({
    where: { email: `loadtest-user-${i}@example.com` },
    update: {},
    create: {
      name: `Load Test User ${i}`,
      email: `loadtest-user-${i}@example.com`,
      password: "$2b$12$placeholderplaceholderplaceholderplaceholderplaceholde",
    },
  });
}
console.log(`seeded ${N} users`);
process.exit(0);