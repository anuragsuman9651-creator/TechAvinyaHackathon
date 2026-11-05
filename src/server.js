const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
app.use(express.json({ limit: '100kb' }));

const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const wrap = fn => (req, res) => Promise.resolve().then(() => fn(req, res)).catch(e => {
  if (e.name === 'ZodError') return res.status(400).json({ error: 'Invalid input: ' + e.issues.map(i => i.path.join('.') + ' ' + i.message).join(', ') });
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(e); res.status(500).json({ error: 'Server error' });
});
const auth = (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET); next(); }
  catch { res.status(401).json({ error: 'Please log in' }); }
};
const publicUser = { id: true, name: true, department: true, academicYear: true, photoUrl: true };

/* ---------- Auth ---------- */
app.post('/api/auth/register', wrap(async (req, res) => {
  const d = z.object({ name: z.string().trim().min(2).max(80), email: z.string().email().toLowerCase(), password: z.string().min(8).max(100), department: z.string().max(80).optional(), academicYear: z.string().max(30).optional() }).parse(req.body);
  if (await prisma.user.findUnique({ where: { email: d.email } })) fail(409, 'Email already registered');
  const u = await prisma.user.create({ data: { name: d.name, email: d.email, department: d.department, academicYear: d.academicYear, passwordHash: await bcrypt.hash(d.password, 10), photoUrl: `https://i.pravatar.cc/200?u=${encodeURIComponent(d.email)}` } });
  res.status(201).json({ token: jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' }), user: { id: u.id, name: u.name } });
}));
app.post('/api/auth/login', wrap(async (req, res) => {
  const d = z.object({ email: z.string().email().toLowerCase(), password: z.string() }).parse(req.body);
  const u = await prisma.user.findUnique({ where: { email: d.email } });
  if (!u || !(await bcrypt.compare(d.password, u.passwordHash))) fail(401, 'Incorrect email or password');
  res.json({ token: jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' }), user: { id: u.id, name: u.name } });
}));
app.get('/api/auth/me', auth, wrap(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, name: true, email: true } });
  if (!u) fail(401, 'Please log in'); res.json(u);
}));

/* ---------- Rating service ---------- */
const score = z.number().int().min(1).max(10);
const createSchema = z.object({
  transactionId: z.string().uuid(), sellerId: z.string().uuid().optional(),
  overallRating: score, productAccuracyRating: score, productConditionRating: score,
  communicationRating: score, overallExperienceRating: score,
  reviewText: z.string().trim().max(1000).optional(),
});
const RATEABLE_TYPES = ['SELL']; // add 'RENT' / 'DONATE' here to extend later
const r1 = n => Math.round(n * 10) / 10;

async function sellerSummary(sellerId) {
  const [agg, groups] = await Promise.all([
    prisma.rating.aggregate({ where: { sellerId }, _avg: { overallRating: true }, _count: { _all: true } }),
    prisma.rating.groupBy({ by: ['overallRating'], where: { sellerId }, _count: { _all: true } }),
  ]);
  const distribution = {}; for (let i = 1; i <= 10; i++) distribution[i] = 0;
  groups.forEach(g => { distribution[g.overallRating] = g._count._all; });
  return { sellerId, average: agg._avg.overallRating == null ? null : r1(agg._avg.overallRating), total: agg._count._all, distribution };
}
async function summariesFor(ids) {
  if (!ids.length) return {};
  const rows = await prisma.rating.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids } }, _avg: { overallRating: true }, _count: { _all: true } });
  return Object.fromEntries(rows.map(r => [r.sellerId, { average: r1(r._avg.overallRating), total: r._count._all }]));
}
const shortName = n => { const [f, ...rest] = n.trim().split(/\s+/); return rest.length ? `${f} ${rest[rest.length - 1][0]}.` : f; };
async function sellerReviews(sellerId, q = {}) {
  const limit = Math.min(Math.max(parseInt(q.limit) || 20, 1), 50), page = Math.max(parseInt(q.page) || 1, 1);
  const rows = await prisma.rating.findMany({
    where: { sellerId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
    select: { id: true, overallRating: true, productAccuracyRating: true, productConditionRating: true, communicationRating: true, overallExperienceRating: true, reviewText: true, createdAt: true, buyer: { select: { name: true } }, product: { select: { title: true } } },
  });
  return rows.map(({ buyer, product, ...r }) => ({ ...r, buyerName: shortName(buyer.name), productTitle: product.title })); // no email/phone/id exposed
}

/* ---------- Rating routes ---------- */
const R = express.Router();
R.post('/', auth, wrap(async (req, res) => {
  const d = createSchema.parse(req.body);
  const tx = await prisma.transaction.findUnique({ where: { id: d.transactionId }, include: { rating: { select: { id: true } } } });
  if (!tx || tx.buyerId !== req.user.id) fail(403, 'You can only rate your own purchases');
  if (tx.sellerId === req.user.id) fail(403, 'You cannot rate yourself');
  if (d.sellerId && d.sellerId !== tx.sellerId) fail(400, 'Transaction does not belong to this seller');
  if (!RATEABLE_TYPES.includes(tx.type)) fail(400, 'This transaction type cannot be rated yet');
  if (tx.status !== 'COMPLETED') fail(400, 'Only completed transactions can be rated');
  if (tx.rating) fail(409, 'This transaction has already been rated');
  const { sellerId: _ignored, ...data } = d;
  try {
    const rating = await prisma.rating.create({ data: { ...data, buyerId: req.user.id, sellerId: tx.sellerId, productId: tx.productId } });
    res.status(201).json(rating);
  } catch (e) { if (e.code === 'P2002') fail(409, 'This transaction has already been rated'); throw e; }
}));
R.get('/eligible-transactions', auth, wrap(async (req, res) => {
  res.json(await prisma.transaction.findMany({
    where: { buyerId: req.user.id, status: 'COMPLETED', type: { in: RATEABLE_TYPES }, rating: null },
    include: { product: { select: { id: true, title: true } }, seller: { select: { id: true, name: true } } }, orderBy: { updatedAt: 'desc' } }));
}));
R.get('/my-reviews', auth, wrap(async (req, res) => {
  res.json(await prisma.rating.findMany({ where: { buyerId: req.user.id }, orderBy: { createdAt: 'desc' },
    select: { id: true, overallRating: true, reviewText: true, createdAt: true, seller: { select: { id: true, name: true } }, product: { select: { title: true } } } }));
}));
// "my-*" routes must come before ":sellerId"
R.get('/seller/my-summary', auth, wrap(async (req, res) => res.json(await sellerSummary(req.user.id))));
R.get('/seller/my-reviews', auth, wrap(async (req, res) => res.json(await sellerReviews(req.user.id, req.query))));
R.get('/seller/:sellerId/summary', wrap(async (req, res) => res.json(await sellerSummary(z.string().uuid().parse(req.params.sellerId)))));
R.get('/seller/:sellerId', wrap(async (req, res) => res.json(await sellerReviews(z.string().uuid().parse(req.params.sellerId), req.query))));
// No PUT/DELETE routes exist: sellers (and everyone else) cannot edit or remove ratings.
app.use('/api/ratings', R);

/* ---------- Users ---------- */
app.get('/api/users/:id', wrap(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: z.string().uuid().parse(req.params.id) }, select: publicUser });
  if (!u) fail(404, 'Seller not found'); res.json(u);
}));

/* ---------- Products ---------- */
app.get('/api/products', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const items = await prisma.product.findMany({
    where: { status: 'AVAILABLE', ...(q && { OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] }) },
    include: { seller: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  const sums = await summariesFor([...new Set(items.map(i => i.sellerId))]);
  res.json(items.map(i => ({ ...i, sellerRating: sums[i.sellerId] || { average: null, total: 0 } })));
}));
app.get('/api/products/mine', auth, wrap(async (req, res) => res.json(await prisma.product.findMany({ where: { sellerId: req.user.id }, orderBy: { createdAt: 'desc' } }))));
app.get('/api/products/:id', wrap(async (req, res) => {
  const p = await prisma.product.findUnique({ where: { id: z.string().uuid().parse(req.params.id) }, include: { seller: { select: publicUser } } });
  if (!p) fail(404, 'Product not found');
  res.json({ ...p, seller: { ...p.seller, rating: await sellerSummary(p.sellerId) } });
}));
app.post('/api/products', auth, wrap(async (req, res) => {
  const d = z.object({ title: z.string().trim().min(2).max(120), description: z.string().trim().min(2).max(2000), price: z.number().int().min(0).max(10000000), imageUrl: z.string().url().max(500).optional().or(z.literal('')) }).parse(req.body);
  res.status(201).json(await prisma.product.create({ data: { ...d, imageUrl: d.imageUrl || `https://picsum.photos/seed/${Date.now()}/600/400`, sellerId: req.user.id } }));
}));

/* ---------- Transactions ---------- */
app.post('/api/transactions', auth, wrap(async (req, res) => {
  const { productId } = z.object({ productId: z.string().uuid() }).parse(req.body);
  const p = await prisma.product.findUnique({ where: { id: productId } });
  if (!p || p.status !== 'AVAILABLE') fail(400, 'Product is not available');
  if (p.sellerId === req.user.id) fail(400, 'You cannot buy your own listing');
  if (await prisma.transaction.findFirst({ where: { productId, buyerId: req.user.id, status: { in: ['PENDING', 'ACCEPTED'] } } })) fail(409, 'You already have an open request for this product');
  res.status(201).json(await prisma.transaction.create({ data: { productId, buyerId: req.user.id, sellerId: p.sellerId, type: 'SELL' } }));
}));
app.get('/api/transactions/mine', auth, wrap(async (req, res) => {
  const inc = { product: { select: { id: true, title: true } }, buyer: { select: { name: true } }, seller: { select: { name: true } } };
  const [asBuyer, asSeller] = await Promise.all([
    prisma.transaction.findMany({ where: { buyerId: req.user.id }, include: inc, orderBy: { createdAt: 'desc' } }),
    prisma.transaction.findMany({ where: { sellerId: req.user.id }, include: inc, orderBy: { createdAt: 'desc' } })]);
  res.json({ asBuyer, asSeller });
}));
app.patch('/api/transactions/:id', auth, wrap(async (req, res) => {
  const { action } = z.object({ action: z.enum(['accept', 'reject', 'complete', 'cancel']) }).parse(req.body);
  const tx = await prisma.transaction.findUnique({ where: { id: z.string().uuid().parse(req.params.id) } });
  if (!tx) fail(404, 'Transaction not found');
  const isSeller = tx.sellerId === req.user.id, isBuyer = tx.buyerId === req.user.id;
  let next;
  if (isSeller && action === 'accept' && tx.status === 'PENDING') next = 'ACCEPTED';
  else if (isSeller && action === 'reject' && tx.status === 'PENDING') next = 'REJECTED';
  else if (isSeller && action === 'complete' && tx.status === 'ACCEPTED') next = 'COMPLETED';
  else if (isBuyer && action === 'cancel' && ['PENDING', 'ACCEPTED'].includes(tx.status)) next = 'CANCELLED';
  else fail(403, 'This action is not allowed');
  const [updated] = await prisma.$transaction([
    prisma.transaction.update({ where: { id: tx.id }, data: { status: next } }),
    ...(next === 'COMPLETED' ? [prisma.product.update({ where: { id: tx.productId }, data: { status: 'SOLD' } })] : []),
  ]);
  res.json(updated);
}));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => req.path.startsWith('/api') ? res.status(404).json({ error: 'Not found' }) : res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.listen(process.env.PORT || 3000, () => console.log('CampusLoop running'));
