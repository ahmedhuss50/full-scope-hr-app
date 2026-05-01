import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-xl text-center">
        <div className="inline-flex items-center gap-2 mb-6">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-ink text-white font-black">M</span>
          <span className="serif text-2xl font-bold">Full Scope HR</span>
        </div>
        <h1 className="serif font-black text-4xl md:text-5xl tracking-tight leading-tight">
          Professional services HR, automated.
        </h1>
        <p className="mt-4 text-ink/70 text-lg">
          The hiring pipeline for accounting and BD firms across the GCC.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <Link href="/login" className="btn-primary">HR sign in</Link>
          <Link href="/apply/fullscope" className="btn-ghost">See the public application</Link>
        </div>
        <div className="mt-16 text-xs text-ink/40">
          Run the SQL migrations in <code className="font-mono bg-ink/5 px-1.5 py-0.5 rounded">supabase/migrations/</code> against your project, then seed with <code className="font-mono bg-ink/5 px-1.5 py-0.5 rounded">supabase/seed.sql</code>.
        </div>
      </div>
    </main>
  )
}
