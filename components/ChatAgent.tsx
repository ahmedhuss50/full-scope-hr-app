'use client'

/**
 * ChatAgent — floating chat bubble in the bottom-left corner (RTL) that opens
 * a side panel with a Claude-powered help assistant. MVP scope: conversation
 * only — no DB tool-use yet.
 *
 * UX notes:
 *   - Uses localStorage to keep the message list across reloads on the same
 *     browser. Clears with the «مسح» button.
 *   - SSE streaming from /api/dsb-chat; we parse only the deltas.
 *   - Panel is 360px wide, fixed to the viewport corner. The toggle button
 *     floats on top so clicking it works whether the panel is open or not.
 *   - Role: hidden in the developer portal and on auth pages via the Mount
 *     check in app/app/layout.tsx (added separately).
 */
import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X, Send, Sparkles, Trash2, Loader2 } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string }

const STORAGE_KEY = 'fs:dsb-chat-history:v1'
const WELCOME: Msg = {
  role: 'assistant',
  content:
    'هلا! أنا مساعدك داخل النظام. اسألني عن أي شي — طريقة رفع وثيقة صرف، وش معنى حساب الضمان، وين ألقى تقرير محدد، أو كيف أربط دفعة بعقد. وش تحتاج؟',
}

export function ChatAgent() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([WELCOME])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Restore history on mount. We silently drop malformed localStorage —
  // better to start fresh than crash the panel.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Msg[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        setMessages(parsed)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)) } catch { /* ignore */ }
    // Auto-scroll to the newest message after every append.
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    if (open) textareaRef.current?.focus()
  }, [open])

  function clearHistory() {
    setMessages([WELCOME])
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setErr(null)
    const nextMessages: Msg[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setInput('')
    setBusy(true)

    // Start with an empty assistant placeholder we'll fill as deltas arrive.
    // Index so we can mutate just the last message efficiently.
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    try {
      const resp = await fetch('/api/dsb-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      })
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
        throw new Error(j.error ?? `HTTP ${resp.status}`)
      }
      if (!resp.body) throw new Error('لا يوجد تدفق استجابة.')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let acc = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // SSE frames end with a blank line. Parse one by one.
        let sepIdx = buffer.indexOf('\n\n')
        while (sepIdx !== -1) {
          const frame = buffer.slice(0, sepIdx)
          buffer = buffer.slice(sepIdx + 2)
          const lines = frame.split('\n')
          // Each frame may have `event: X` + `data: Y`. We only care about
          // content_block_delta events with text_delta inside.
          const dataLine = lines.find((l) => l.startsWith('data:'))
          if (dataLine) {
            const json = dataLine.slice(5).trim()
            if (json && json !== '[DONE]') {
              try {
                const parsed = JSON.parse(json)
                if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                  acc += parsed.delta.text ?? ''
                  setMessages((prev) => {
                    const copy = [...prev]
                    copy[copy.length - 1] = { role: 'assistant', content: acc }
                    return copy
                  })
                }
              } catch { /* skip malformed frames */ }
            }
          }
          sepIdx = buffer.indexOf('\n\n')
        }
      }
      if (acc.length === 0) {
        // Empty reply — drop the placeholder and surface a friendly error.
        setMessages((prev) => prev.slice(0, -1))
        setErr('لم أستلم رداً. جرّب مرة ثانية.')
      }
    } catch (e) {
      setMessages((prev) => prev.slice(0, -1))
      setErr(e instanceof Error ? e.message : 'خطأ غير متوقع.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'إغلاق المساعد' : 'فتح المساعد'}
        className="fixed z-40 bottom-5 left-5 w-12 h-12 rounded-full bg-teal-600 text-white shadow-lg hover:bg-teal-700 transition flex items-center justify-center"
        style={{ direction: 'ltr' }}
      >
        {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
      </button>

      {open && (
        <div
          dir="rtl"
          className="fixed z-40 bottom-20 left-5 w-[min(360px,calc(100vw-2rem))] h-[min(560px,calc(100vh-7rem))] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-gradient-to-l from-teal-50 to-white">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-teal-600 text-white flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              </div>
              <div className="text-sm font-bold text-slate-900">المساعد</div>
            </div>
            <button
              type="button"
              onClick={clearHistory}
              title="مسح المحادثة"
              className="text-slate-400 hover:text-red-600 transition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50/50">
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === 'user' ? 'flex justify-start' : 'flex justify-end'}
              >
                <div
                  className={
                    'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ' +
                    (m.role === 'user'
                      ? 'bg-teal-600 text-white rounded-br-sm'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm')
                  }
                >
                  {m.content || (busy && i === messages.length - 1 ? '…' : '')}
                </div>
              </div>
            ))}
            {err && (
              <div role="alert" className="text-xs text-red-700 font-semibold text-center">{err}</div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-slate-200 p-2 bg-white">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                disabled={busy}
                placeholder="اكتب سؤالك هنا…"
                className="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50 max-h-32"
                style={{ fieldSizing: 'content' } as React.CSSProperties}
              />
              <button
                type="button"
                onClick={send}
                disabled={busy || !input.trim()}
                className="shrink-0 w-10 h-10 rounded-xl bg-teal-600 text-white flex items-center justify-center shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
