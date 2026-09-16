import { NextRequest, NextResponse } from 'next/server'
import { createSingleUnit, type CreateSingleUnitInput } from '@/app/app/disbursements/admin/units/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: CreateSingleUnitInput
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'بيانات غير صالحة.' }, { status: 400 })
  }
  const res = await createSingleUnit(body)
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}
