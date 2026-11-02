import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok' }))

// List all homes (helpful for UI switcher)
app.get('/api/homes', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name FROM homes ORDER BY rowid ASC').all<{
    id: string
    name: string
  }>()
  return c.json({ homes: results })
})

// Create a new home
app.post('/api/homes', async (c) => {
  let body: { name?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'Name is required' }, 422)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

// List members of a home
app.get('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const { results } = await c.env.DB.prepare(
    'SELECT id, home_id AS homeId, name FROM members WHERE home_id = ? ORDER BY rowid ASC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; name: string }>()

  return c.json({ members: results })
})

// Add a member to a home
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  let body: { name?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'Name is required' }, 422)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, name)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// List bills for a home
app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const { results: bills } = await c.env.DB.prepare(
    'SELECT id, home_id AS homeId, title, total_cents AS totalCents FROM bills WHERE home_id = ? ORDER BY rowid DESC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; title: string; totalCents: number }>()

  const billsWithShares = await Promise.all(
    bills.map(async (bill) => {
      const { results: shares } = await c.env.DB.prepare(
        'SELECT id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt FROM shares WHERE bill_id = ? ORDER BY rowid ASC',
      )
        .bind(bill.id)
        .all<{ id: string; memberId: string; amountCents: number; paidAt: string | null }>()

      return {
        ...bill,
        shares,
      }
    }),
  )

  return c.json({ bills: billsWithShares })
})

// Create a bill for a home (Part 2)
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  let body: { title?: unknown; totalCents?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  if (
    typeof body.totalCents !== 'number' ||
    !Number.isInteger(body.totalCents) ||
    body.totalCents <= 0
  ) {
    return c.json({ error: 'totalCents must be a positive integer' }, 422)
  }

  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    return c.json({ error: 'Title is required' }, 422)
  }

  const { results: members } = await c.env.DB.prepare(
    'SELECT id, name FROM members WHERE home_id = ? ORDER BY rowid ASC',
  )
    .bind(homeId)
    .all<{ id: string; name: string }>()

  if (members.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const billId = crypto.randomUUID()
  const totalCents = body.totalCents
  const title = body.title.trim()

  // Euclidean remainder division to preserve exact cents
  const n = members.length
  const q = Math.floor(totalCents / n)
  const r = totalCents % n

  const shares = members.map((member, index) => ({
    id: crypto.randomUUID(),
    billId,
    memberId: member.id,
    amountCents: index < r ? q + 1 : q,
    paidAt: null as string | null,
  }))

  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(share.id, share.billId, share.memberId, share.amountCents),
    ),
  ]

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares: shares.map(({ id, memberId, amountCents, paidAt }) => ({
        id,
        memberId,
        amountCents,
        paidAt,
      })),
    },
    201,
  )
})

// Pay a share (Part 2)
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const idempotencyKey = c.req.header('Idempotency-Key')
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const now = new Date().toISOString()

  // Atomic Compare-And-Swap (CAS) update
  const casResult = await c.env.DB.prepare(`
    UPDATE shares
    SET paid_at = ?1, idempotency_key = ?2
    WHERE id = ?3 AND bill_id = ?4 AND paid_at IS NULL
    RETURNING id, member_id, amount_cents, paid_at
  `)
    .bind(now, idempotencyKey, shareId, billId)
    .first<{ id: string; member_id: string; amount_cents: number; paid_at: string }>()

  if (casResult) {
    return c.json({
      id: casResult.id,
      memberId: casResult.member_id,
      amountCents: casResult.amount_cents,
      paidAt: casResult.paid_at,
    })
  }

  // If CAS did not return a row, determine why: non-existent share/bill or already paid
  const existing = await c.env.DB.prepare(`
    SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key
    FROM shares
    WHERE id = ?1 AND bill_id = ?2
  `)
    .bind(shareId, billId)
    .first<{
      id: string
      bill_id: string
      member_id: string
      amount_cents: number
      paid_at: string | null
      idempotency_key: string | null
    }>()

  if (!existing) {
    return c.json({ error: 'Share or bill not found' }, 404)
  }

  if (existing.paid_at !== null) {
    // If same idempotency key was supplied, return the recorded result idempotently
    if (existing.idempotency_key === idempotencyKey) {
      return c.json({
        id: existing.id,
        memberId: existing.member_id,
        amountCents: existing.amount_cents,
        paidAt: existing.paid_at,
      })
    }
    // If a different key was used, return 409 Conflict
    return c.json({ error: 'Share already paid' }, 409)
  }

  return c.json({ error: 'Unable to process payment' }, 500)
})

// Get balances for a home (Part 2)
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const { results } = await c.env.DB.prepare(`
    SELECT 
      m.id AS memberId,
      m.name,
      COALESCE((
        SELECT SUM(s.amount_cents)
        FROM shares s
        JOIN bills b ON b.id = s.bill_id
        WHERE s.member_id = m.id AND s.paid_at IS NULL AND b.home_id = m.home_id
      ), 0) AS outstandingCents
    FROM members m
    WHERE m.home_id = ?
    ORDER BY m.rowid ASC
  `)
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()

  return c.json({ balances: results })
})

export default app
