/**
 * POST /api/dsb-chat
 * ----------------------------------------------------------------------------
 * Chat endpoint for the in-app assistant (ChatAgent floating button). Streams
 * a Claude response to the client as Server-Sent Events so the UI can render
 * tokens as they arrive.
 *
 * Request body:
 *   {
 *     messages: Array<{ role: 'user' | 'assistant'; content: string }>,
 *   }
 *
 * The caller's identity (user, tenant, dsb_role) is resolved server-side from
 * the Supabase cookie session — never trusted from the request body — and
 * injected into the system prompt so Claude can tailor answers.
 *
 * MVP scope: conversational help about navigating the app. No DB tool-use
 * yet (that's phase 2). Uses Haiku for cost — the app has free-form help
 * turns, so a fast + cheap model is the right fit. Phase 2 can bump to
 * Sonnet when we add tool-use loops.
 */
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = process.env.DSB_CHAT_MODEL || 'claude-haiku-4-5-20251001'

// System prompt — tells Claude who they are and how the app is laid out.
// Kept as a constant so Anthropic prompt caching can cache the 1 KB of
// instructions across turns in the same session.
const SYSTEM_PROMPT = `أنت مساعد داخل تطبيق «Full Scope» — نظام SaaS لإشراف حسابات الضمان العقاري في السعودية. مهمتك مساعدة المستخدمين على:
- التنقل بين صفحات النظام
- فهم المصطلحات (طلب الصرف، سجل المشترين، حساب الضمان، نموذج المحاسب القانوني، RCA/REGA)
- شرح سير العمل (رفع الوثيقة → مراجعة الموظف → اعتماد المشرف → توقيع المدير → تسليم)
- الإجابة على أسئلة «وين ألقى…؟» أو «كيف أسوي…؟»

بنية النظام الأساسية:
• **الصفحة الرئيسية** — لوحة تحكم وKPIs
• **السبورة** — kanban للطلبات
• **رفع وثيقة صرف** — ابدأ طلب جديد
• **المشاريع** — كل مشروع له صفحة فيها 9 تبويبات (نظرة عامة / وحدات / عقود / موردون / حسابات / دفعات / وثائق / تقارير / تهيئة)
• **السجلات** (مدير) — 5 قوائم شاملة: سجل الوثائق، الدفعات، المشترون، العقود، الوحدات
• **التقارير** — تقرير المدير، الأرشيف
• **الإدارة** (مدير) — موظفون، استيراد Excel، القوائم والنسب، الإعدادات، سجل التدقيق

قواعد الرد:
1. **اللغة**: العربية الفصحى المختصرة. السعودية لهجة مسموحة في الأسئلة.
2. **الطول**: 2-4 أسطر كحد أقصى لمعظم الأسئلة. طويل فقط لو الشرح يتطلب.
3. **الروابط**: لما تذكر صفحة، أعطي المسار (مثل /app/disbursements/admin/lists). لا تضع URLs كاملة.
4. **الدور**: احترم دور المستخدم — إذا كان موظف ما يقدر يوصل لصفحات المدير، أخبره بأدب.
5. **لا تخترع**: إذا ما تعرف جواب، قل «مش متأكد — ممكن تتحقق من…».
6. **التركيز**: خارج نطاق النظام، لا تجاوب (بأدب).

لا تتوقع من المستخدم يعرف المصطلحات التقنية. اشرح بلغة سهلة.`

export async function POST(req: Request) {
  // ----- Auth -----
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    return new Response(JSON.stringify({ ok: false, error: 'لم يتم تسجيل الدخول.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }
  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role, full_name')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) {
    return new Response(JSON.stringify({ ok: false, error: 'حسابك غير مرتبط بمستأجر.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }
  const dsbRole = (profile.dsb_role as string | null) ?? null
  const fullName = (profile.full_name as string | null) ?? ''

  // ----- Body -----
  type Msg = { role: 'user' | 'assistant'; content: string }
  let body: { messages?: Msg[] }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'طلب غير صالح.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    })
  }
  const messages = (body.messages ?? []).filter(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
  )
  if (messages.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: 'لا توجد رسائل.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    })
  }
  // Cap conversation history so the context window stays small — Haiku is
  // fine at 20k but we don't need runaway cost on a chat panel that's
  // probably doing a handful of back-and-forths.
  const cappedMessages = messages.slice(-20)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY غير معيّن.' }), {
      status: 500, headers: { 'content-type': 'application/json' },
    })
  }

  // Build system prompt with caller context appended. Claude needs to know
  // the user's role so it can refuse owner-only guidance for a non-owner.
  const roleLabels: Record<string, string> = {
    owner: 'مدير', supervisor: 'مشرف', employee: 'موظف',
    viewer: 'مشاهد', deliverer: 'مُسلِّم', developer: 'مطور',
  }
  const roleLabel = roleLabels[dsbRole ?? ''] ?? (dsbRole ?? 'غير معروف')
  const userContext = `\n\n---\nالمستخدم الحالي: ${fullName || 'بدون اسم'} · الدور: ${roleLabel}`

  const anthropicBody = {
    model: MODEL,
    max_tokens: 1024,
    temperature: 0.4,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text: userContext,
      },
    ],
    messages: cappedMessages,
    stream: true,
  }

  // Forward Claude's SSE stream directly to the client. The client only
  // needs the `content_block_delta` events — it ignores the rest.
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(anthropicBody),
  })
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '')
    return new Response(JSON.stringify({ ok: false, error: `Claude API ${upstream.status}: ${errText.slice(0, 300)}` }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
