import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/')({
  component: BillSplitterApp,
})

// --- Data Types ---
type Home = { id: string; name: string }
type Member = { id: string; homeId: string; name: string }
type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
type Bill = { id: string; homeId: string; title: string; totalCents: number; shares: Share[] }
type Balance = { memberId: string; name: string; outstandingCents: number }

// Currency formatter helper: always turns integer cents into formatted dollars
function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

function BillSplitterApp() {
  // Navigation / Selected home state
  const [homes, setHomes] = useState<Home[]>([])
  const [selectedHomeId, setSelectedHomeId] = useState<string>('')
  const [members, setMembers] = useState<Member[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])

  // Global loading and error states
  const [isLoadingInitial, setIsLoadingInitial] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  // Creation form states
  const [newHomeName, setNewHomeName] = useState('')
  const [isCreatingHome, setIsCreatingHome] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [isAddingMember, setIsAddingMember] = useState(false)

  // Bill creation form
  const [billTitle, setBillTitle] = useState('')
  const [billAmountInput, setBillAmountInput] = useState('')
  const [isCreatingBill, setIsCreatingBill] = useState(false)
  const [billFormError, setBillFormError] = useState<string | null>(null)

  // Share payment progress tracking (shareId -> boolean)
  const [payingShareId, setPayingShareId] = useState<string | null>(null)
  const [payError, setPayError] = useState<string | null>(null)

  // Helper: Parse currency input string to integer cents
  const parsedBillCents = useMemo(() => {
    const cleaned = billAmountInput.replace(/[^0-9.]/g, '')
    const num = Number.parseFloat(cleaned)
    if (Number.isNaN(num) || num <= 0) return 0
    return Math.round(num * 100)
  }, [billAmountInput])

  // Live preview of Euclidean remainder distribution before bill creation
  const splitPreview = useMemo(() => {
    if (parsedBillCents <= 0 || members.length === 0) return []
    const n = members.length
    const q = Math.floor(parsedBillCents / n)
    const r = parsedBillCents % n
    return members.map((member, idx) => ({
      name: member.name,
      amountCents: idx < r ? q + 1 : q,
    }))
  }, [parsedBillCents, members])

  // Load all homes
  const loadHomes = useCallback(async () => {
    try {
      const res = await fetch('/api/homes')
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`)
      const data = (await res.json()) as { homes: Home[] }
      setHomes(data.homes || [])
      const firstHome = data.homes?.[0]
      if (firstHome && !selectedHomeId) {
        setSelectedHomeId(firstHome.id)
      }
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Unable to connect to the Bill Splitter API.',
      )
    } finally {
      setIsLoadingInitial(false)
    }
  }, [selectedHomeId])

  // Load data for the active home
  const loadHomeData = useCallback(async (homeId: string) => {
    if (!homeId) return
    setIsRefreshing(true)
    setGlobalError(null)

    try {
      const [membersRes, billsRes, balancesRes] = await Promise.all([
        fetch(`/api/homes/${homeId}/members`),
        fetch(`/api/homes/${homeId}/bills`),
        fetch(`/api/homes/${homeId}/balances`),
      ])

      if (membersRes.status === 404 || billsRes.status === 404 || balancesRes.status === 404) {
        throw new Error('This home was not found. It may have been deleted.')
      }

      if (!membersRes.ok) throw new Error(`Failed to load members (${membersRes.status})`)
      if (!billsRes.ok) throw new Error(`Failed to load bills (${billsRes.status})`)
      if (!balancesRes.ok) throw new Error(`Failed to load balances (${balancesRes.status})`)

      const membersData = (await membersRes.json()) as { members: Member[] }
      const billsData = (await billsRes.json()) as { bills: Bill[] }
      const balancesData = (await balancesRes.json()) as { balances: Balance[] }

      setMembers(membersData.members || [])
      setBills(billsData.bills || [])
      setBalances(balancesData.balances || [])
    } catch (err) {
      setGlobalError(
        err instanceof Error
          ? err.message
          : 'Failed to retrieve home details. Please retry shortly.',
      )
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    loadHomes()
  }, [loadHomes])

  // Trigger home data reload when selectedHomeId changes
  useEffect(() => {
    if (selectedHomeId) {
      loadHomeData(selectedHomeId)
    } else {
      setMembers([])
      setBills([])
      setBalances([])
    }
  }, [selectedHomeId, loadHomeData])

  // Create Home Action
  const handleCreateHome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newHomeName.trim()) return

    setIsCreatingHome(true)
    setGlobalError(null)

    try {
      const res = await fetch('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newHomeName.trim() }),
      })

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errJson.error || `Failed to create home (HTTP ${res.status})`)
      }

      const created = (await res.json()) as Home
      setHomes((prev) => [...prev, created])
      setSelectedHomeId(created.id)
      setNewHomeName('')
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Error creating home.')
    } finally {
      setIsCreatingHome(false)
    }
  }

  // Add Member Action
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMemberName.trim() || !selectedHomeId) return

    setIsAddingMember(true)
    setGlobalError(null)

    try {
      const res = await fetch(`/api/homes/${selectedHomeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMemberName.trim() }),
      })

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errJson.error || `Failed to add member (HTTP ${res.status})`)
      }

      setNewMemberName('')
      await loadHomeData(selectedHomeId)
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Error adding member.')
    } finally {
      setIsAddingMember(false)
    }
  }

  // Create Bill Action
  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    setBillFormError(null)

    if (!billTitle.trim()) {
      setBillFormError('Please provide a bill title (e.g. "Rent" or "Groceries").')
      return
    }

    if (parsedBillCents <= 0) {
      setBillFormError('Please enter a valid amount greater than $0.00.')
      return
    }

    if (members.length === 0) {
      setBillFormError('Cannot create a bill for a home with zero members. Add a member first.')
      return
    }

    setIsCreatingBill(true)

    try {
      const res = await fetch(`/api/homes/${selectedHomeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: billTitle.trim(),
          totalCents: parsedBillCents,
        }),
      })

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errJson.error || `Failed to create bill (HTTP ${res.status})`)
      }

      setBillTitle('')
      setBillAmountInput('')
      await loadHomeData(selectedHomeId)
    } catch (err) {
      setBillFormError(err instanceof Error ? err.message : 'Error creating bill.')
    } finally {
      setIsCreatingBill(false)
    }
  }

  // Pay Share Action (with Idempotency-Key)
  const handlePayShare = async (billId: string, shareId: string) => {
    setPayingShareId(shareId)
    setPayError(null)

    const idempotencyKey = crypto.randomUUID()

    try {
      const res = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
      })

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errJson.error || `Payment failed (HTTP ${res.status})`)
      }

      const updatedShare = (await res.json()) as Share

      // Optimistically update the share in the local bills state
      setBills((prevBills) =>
        prevBills.map((b) => {
          if (b.id !== billId) return b
          return {
            ...b,
            shares: b.shares.map((s) =>
              s.id === shareId ? { ...s, paidAt: updatedShare.paidAt } : s,
            ),
          }
        }),
      )

      // Refresh balances from the server
      if (selectedHomeId) {
        const balancesRes = await fetch(`/api/homes/${selectedHomeId}/balances`)
        if (balancesRes.ok) {
          const balancesData = (await balancesRes.json()) as { balances: Balance[] }
          setBalances(balancesData.balances || [])
        }
      }
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Payment could not be completed.')
    } finally {
      setPayingShareId(null)
    }
  }

  // Member map for easy lookups
  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of members) {
      map.set(m.id, m.name)
    }
    return map
  }, [members])

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        color: '#0f172a',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
        padding: '32px 16px',
      }}
    >
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        {/* App Header */}
        <header
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 28,
            paddingBottom: 20,
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: '-0.025em',
                margin: 0,
                color: '#0f172a',
              }}
            >
              Shared Bill Splitter
            </h1>
            <p style={{ margin: '4px 0 0 0', fontSize: 14, color: '#64748b' }}>
              Split shared living expenses with exact integer cents and atomic payments.
            </p>
          </div>

          {/* Home Selector / Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {homes.length > 0 && (
              <select
                value={selectedHomeId}
                onChange={(e) => setSelectedHomeId(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  fontSize: 14,
                  fontWeight: 500,
                  color: '#0f172a',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {homes.map((h) => (
                  <option key={h.id} value={h.id}>
                    🏡 {h.name}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => {
                const name = window.prompt('Enter name for new home:')
                if (name?.trim()) {
                  setNewHomeName(name.trim())
                  fetch('/api/homes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name.trim() }),
                  })
                    .then((r) => r.json() as Promise<Home>)
                    .then((newHome) => {
                      setHomes((prev) => [...prev, newHome])
                      setSelectedHomeId(newHome.id)
                    })
                    .catch(() => setGlobalError('Failed to create new home.'))
                }
              }}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: '1px solid #0f172a',
                backgroundColor: '#0f172a',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'opacity 0.15s ease',
              }}
            >
              + New Home
            </button>
          </div>
        </header>

        {/* Global Error Banner */}
        {globalError && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#fef2f2',
              color: '#991b1b',
              border: '1px solid #fecaca',
              borderRadius: 8,
              fontSize: 14,
              marginBottom: 20,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>⚠️ {globalError}</span>
            <button
              type="button"
              onClick={() => {
                setGlobalError(null)
                if (selectedHomeId) loadHomeData(selectedHomeId)
                else loadHomes()
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#991b1b',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Payment Error Notification */}
        {payError && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#fffbeb',
              color: '#92400e',
              border: '1px solid #fde68a',
              borderRadius: 8,
              fontSize: 14,
              marginBottom: 20,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>⚠️ Payment Notice: {payError}</span>
            <button
              type="button"
              onClick={() => setPayError(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#92400e',
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Initial Empty State: No Homes Created Yet */}
        {isLoadingInitial ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Connecting to Bill Splitter...</div>
          </div>
        ) : homes.length === 0 ? (
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 12,
              padding: '40px 24px',
              textAlign: 'center',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>🏠</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px 0' }}>
              Create your first shared home
            </h2>
            <p
              style={{ fontSize: 14, color: '#64748b', maxWidth: 420, margin: '0 auto 24px auto' }}
            >
              Add a home to start adding roommates, splitting expenses, and keeping track of who
              owes what.
            </p>
            <form
              onSubmit={handleCreateHome}
              style={{
                display: 'inline-flex',
                gap: 8,
                maxWidth: 380,
                width: '100%',
              }}
            >
              <input
                type="text"
                placeholder="e.g. Flat 4B or Baker Street"
                value={newHomeName}
                onChange={(e) => setNewHomeName(e.target.value)}
                required
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={isCreatingHome}
                style={{
                  padding: '10px 18px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: isCreatingHome ? 'not-allowed' : 'pointer',
                  opacity: isCreatingHome ? 0.7 : 1,
                }}
              >
                {isCreatingHome ? 'Creating...' : 'Create'}
              </button>
            </form>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Top Row: Roommates & Outstanding Balances */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 16,
              }}
            >
              {/* Card 1: Roommates */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  padding: 20,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                    Roommates ({members.length})
                  </h2>
                  {isRefreshing && (
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>Syncing...</span>
                  )}
                </div>

                {members.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px 0' }}>
                    No roommates added yet. Add at least one person before creating bills.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                    {members.map((m, idx) => (
                      <span
                        key={m.id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '4px 10px',
                          borderRadius: 20,
                          backgroundColor: '#f1f5f9',
                          color: '#334155',
                          fontSize: 13,
                          fontWeight: 500,
                        }}
                      >
                        <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 4 }}>
                          #{idx + 1}
                        </span>
                        {m.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Add Member inline form */}
                <form onSubmit={handleAddMember} style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="New roommate name..."
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    required
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      outline: 'none',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={isAddingMember}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: '1px solid #e2e8f0',
                      backgroundColor: '#f8fafc',
                      color: '#0f172a',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: isAddingMember ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isAddingMember ? 'Adding...' : 'Add'}
                  </button>
                </form>
              </div>

              {/* Card 2: Balances Overview */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  padding: 20,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px 0' }}>
                  Outstanding Balances
                </h2>

                {balances.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>No balance data yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {balances.map((b) => {
                      const isClear = b.outstandingCents === 0
                      return (
                        <div
                          key={b.memberId}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 12px',
                            borderRadius: 8,
                            backgroundColor: isClear ? '#f0fdf4' : '#fff',
                            border: `1px solid ${isClear ? '#bbf7d0' : '#f1f5f9'}`,
                          }}
                        >
                          <span style={{ fontSize: 14, fontWeight: 500, color: '#1e293b' }}>
                            {b.name}
                          </span>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              fontVariantNumeric: 'tabular-nums',
                              color: isClear ? '#16a34a' : '#e11d48',
                            }}
                          >
                            {isClear ? '✓ Settled' : formatCents(b.outstandingCents)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Split a New Bill Section */}
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 12,
                padding: 20,
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px 0' }}>
                Split a New Bill
              </h2>

              {billFormError && (
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#fef2f2',
                    color: '#991b1b',
                    borderRadius: 6,
                    fontSize: 13,
                    marginBottom: 14,
                  }}
                >
                  ⚠️ {billFormError}
                </div>
              )}

              <form onSubmit={handleCreateBill}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <label
                      htmlFor="bill-title-input"
                      style={{
                        display: 'block',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#475569',
                        marginBottom: 6,
                      }}
                    >
                      Bill Title
                    </label>
                    <input
                      id="bill-title-input"
                      type="text"
                      placeholder="e.g. Electricity, Groceries"
                      value={billTitle}
                      onChange={(e) => setBillTitle(e.target.value)}
                      required
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: 14,
                        outline: 'none',
                      }}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="bill-amount-input"
                      style={{
                        display: 'block',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#475569',
                        marginBottom: 6,
                      }}
                    >
                      Total Amount ($)
                    </label>
                    <input
                      id="bill-amount-input"
                      type="text"
                      placeholder="0.00"
                      value={billAmountInput}
                      onChange={(e) => setBillAmountInput(e.target.value)}
                      required
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: 14,
                        fontVariantNumeric: 'tabular-nums',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>

                {/* Real-time Euclidean Remainder Split Preview */}
                {splitPreview.length > 0 && (
                  <div
                    style={{
                      padding: 12,
                      backgroundColor: '#f8fafc',
                      borderRadius: 8,
                      border: '1px dashed #cbd5e1',
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#64748b',
                        marginBottom: 6,
                      }}
                    >
                      Equal Share Breakdown ({splitPreview.length} roommates):
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {splitPreview.map((s) => (
                        <span
                          key={s.name}
                          style={{
                            fontSize: 13,
                            color: '#334155',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          <strong>{s.name}</strong>: {formatCents(s.amountCents)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isCreatingBill || members.length === 0}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 8,
                    border: 'none',
                    backgroundColor: '#0f172a',
                    color: '#ffffff',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: isCreatingBill || members.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: isCreatingBill || members.length === 0 ? 0.6 : 1,
                  }}
                >
                  {isCreatingBill ? 'Splitting...' : 'Split Bill'}
                </button>
              </form>
            </div>

            {/* Bills & Share Payment List */}
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px 0' }}>
                Bills & Shares ({bills.length})
              </h2>

              {bills.length === 0 ? (
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: 12,
                    padding: 32,
                    textAlign: 'center',
                    border: '1px solid #e2e8f0',
                    color: '#64748b',
                  }}
                >
                  <p style={{ margin: 0, fontSize: 14 }}>
                    No bills created for this home yet. Use the form above to split your first bill!
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {bills.map((bill) => {
                    const allPaid = bill.shares.every((s) => s.paidAt !== null)
                    return (
                      <div
                        key={bill.id}
                        style={{
                          backgroundColor: '#ffffff',
                          borderRadius: 12,
                          padding: 20,
                          border: '1px solid #e2e8f0',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                        }}
                      >
                        {/* Bill Header */}
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            justifyContent: 'space-between',
                            alignItems: 'baseline',
                            gap: 8,
                            marginBottom: 16,
                            paddingBottom: 12,
                            borderBottom: '1px solid #f1f5f9',
                          }}
                        >
                          <div>
                            <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                              {bill.title}
                            </span>
                            {allPaid && (
                              <span
                                style={{
                                  marginLeft: 8,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: '#16a34a',
                                  backgroundColor: '#dcfce7',
                                  padding: '2px 8px',
                                  borderRadius: 12,
                                }}
                              >
                                Fully Paid
                              </span>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: 16,
                              fontWeight: 700,
                              fontVariantNumeric: 'tabular-nums',
                              color: '#0f172a',
                            }}
                          >
                            Total: {formatCents(bill.totalCents)}
                          </div>
                        </div>

                        {/* Shares Table */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {bill.shares.map((share) => {
                            const memberName = memberNameMap.get(share.memberId) || 'Unknown'
                            const isPaid = share.paidAt !== null
                            const isPaying = payingShareId === share.id

                            return (
                              <div
                                key={share.id}
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '10px 14px',
                                  borderRadius: 8,
                                  backgroundColor: isPaid ? '#f8fafc' : '#ffffff',
                                  border: '1px solid #e2e8f0',
                                  gap: 12,
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span
                                    style={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: '50%',
                                      backgroundColor: isPaid ? '#10b981' : '#f59e0b',
                                    }}
                                  />
                                  <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                                    {memberName}
                                  </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                  <span
                                    style={{
                                      fontSize: 14,
                                      fontWeight: 600,
                                      fontVariantNumeric: 'tabular-nums',
                                      color: '#1e293b',
                                    }}
                                  >
                                    {formatCents(share.amountCents)}
                                  </span>

                                  {isPaid ? (
                                    <span
                                      style={{
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: '#15803d',
                                        backgroundColor: '#dcfce7',
                                        padding: '4px 10px',
                                        borderRadius: 6,
                                      }}
                                    >
                                      ✓ Paid
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={isPaying}
                                      onClick={() => handlePayShare(bill.id, share.id)}
                                      style={{
                                        padding: '6px 14px',
                                        borderRadius: 6,
                                        border: '1px solid #cbd5e1',
                                        backgroundColor: '#ffffff',
                                        color: '#0f172a',
                                        fontSize: 13,
                                        fontWeight: 600,
                                        cursor: isPaying ? 'not-allowed' : 'pointer',
                                        opacity: isPaying ? 0.6 : 1,
                                        transition: 'all 0.15s ease',
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                      }}
                                    >
                                      {isPaying ? 'Paying...' : 'Pay Share'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
