import { NextRequest, NextResponse } from 'next/server'
import { createSinglePayment, type CreateSinglePaymentInput } from '@/app/app/disbursements/admin/lists/payments/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: CreateSinglePaymentInput
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'بيانات غير صالحة.' }, { status: 400 })
  }
  const res = await createSinglePayment(body)
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}
