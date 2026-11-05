// Adds CHECK constraints Prisma cannot express. Safe to run on every deploy.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const cols = ['overallRating', 'productAccuracyRating', 'productConditionRating', 'communicationRating', 'overallExperienceRating'];
(async () => {
  for (const c of cols) {
    const n = `rating_${c.toLowerCase()}_range`;
    await p.$executeRawUnsafe(`ALTER TABLE "Rating" DROP CONSTRAINT IF EXISTS ${n}`);
    await p.$executeRawUnsafe(`ALTER TABLE "Rating" ADD CONSTRAINT ${n} CHECK ("${c}" BETWEEN 1 AND 10)`);
  }
  await p.$executeRawUnsafe(`ALTER TABLE "Rating" DROP CONSTRAINT IF EXISTS rating_no_self`);
  await p.$executeRawUnsafe(`ALTER TABLE "Rating" ADD CONSTRAINT rating_no_self CHECK ("buyerId" <> "sellerId")`);
  console.log('Rating constraints applied');
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
