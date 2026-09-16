import { NextRequest, NextResponse } from 'next/server'
import { createSingleSale, type CreateSingleSaleInput } from '@/app/app/disbursements/admin/units/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: CreateSingleSaleInput
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'بيانات غير صالحة.' }, { status: 400 })
  }
  const res = await createSingleSale(body)
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}
