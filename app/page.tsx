import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-xl text-center">
        <div className="inline-flex items-center gap-2 mb-6">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-ink text-white font-black">F</span>
          <span className="serif text-2xl font-bold">Full Scope app</span>
        </div>
        <h1 className="serif font-black text-4xl md:text-5xl tracking-tight leading-tight">
          إدارة صرفيات ومستندات المشاريع العقارية.
        </h1>
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <Link href="/login" className="btn-primary">تسجيل الدخول</Link>
        </div>
      </div>
    </main>
  )
}
