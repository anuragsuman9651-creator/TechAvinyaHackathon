// Demo data. Skipped automatically if users already exist. All demo passwords: password123
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  if (await p.user.count()) { console.log('Seed skipped'); return; }
  const h = await bcrypt.hash('password123', 10);
  const mk = (name, email, department, academicYear) => p.user.create({ data: { name, email, passwordHash: h, department, academicYear, photoUrl: `https://i.pravatar.cc/200?u=${email}` } });
  const rahul = await mk('Rahul Sharma', 'rahul@campusloop.test', 'Electronics Engineering', '3rd Year');
  const meera = await mk('Meera Nair', 'meera@campusloop.test', 'Mechanical Engineering', '2nd Year');
  const anurag = await mk('Anurag Singh', 'anurag@campusloop.test', 'Computer Science', '1st Year');
  const priya = await mk('Priya Verma', 'priya@campusloop.test', 'Civil Engineering', '2nd Year');
  const vikram = await mk('Vikram Rao', 'vikram@campusloop.test', 'Chemistry', '4th Year');
  const img = s => `https://picsum.photos/seed/${encodeURIComponent(s)}/600/400`;
  const sold = [
    [rahul, anurag, 'Scientific Calculator', 500, [9, 9, 9, 10, 9], 'Product was exactly as described. The seller was cooperative and handed it over on time.'],
    [rahul, priya, 'Engineering Drawing Kit', 350, [8, 8, 7, 9, 8], 'Good kit, one scale had light scratches.'],
    [rahul, vikram, 'Physics Lab Manual', 150, [10, 10, 10, 10, 10], 'Perfect condition and quick handover.'],
    [meera, anurag, 'Study Lamp', 400, [7, 7, 6, 8, 7], 'Works fine. Pickup took a couple of days to arrange.'],
  ];
  for (const [s, b, title, price, r, text] of sold) {
    const prod = await p.product.create({ data: { title, description: `${title} in good condition.`, price, imageUrl: img(title), status: 'SOLD', sellerId: s.id } });
    const tx = await p.transaction.create({ data: { productId: prod.id, buyerId: b.id, sellerId: s.id, status: 'COMPLETED' } });
    await p.rating.create({ data: { buyerId: b.id, sellerId: s.id, transactionId: tx.id, productId: prod.id, overallRating: r[0], productAccuracyRating: r[1], productConditionRating: r[2], communicationRating: r[3], overallExperienceRating: r[4], reviewText: text } });
  }
  const open = [[rahul, 'Casio fx-991EX Calculator', 500, 'Scientific calculator, lightly used, with cover.'], [rahul, 'Data Structures Textbook', 300, 'Latest edition with notes in margins.'], [meera, 'Hostel Bucket and Mug Set', 120, 'Barely used.'], [priya, 'Drafting Table Lamp', 450, 'LED, adjustable arm.']];
  for (const [s, title, price, description] of open) await p.product.create({ data: { title, description, price, imageUrl: img(title), sellerId: s.id } });
  console.log('Seeded demo data');
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
