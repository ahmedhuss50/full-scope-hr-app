import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Folder, FolderOpen } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import {
  fmtBytes, fmtDateTime,
  sensitivityClasses, sensitivityLabel, statusClasses, statusLabel, kindLabel,
  type DmsSensitivity, type DmsStatus,
} from '../../_shared'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type FolderRow = {
  id: string
  parent_id: string | null
  name: string
  kind: string
  description: string | null
}

type DocumentRow = {
  id: string
  folder_id: string
  filename: string
  display_name: string | null
  doc_kind: string | null
  sensitivity: DmsSensitivity
  status: DmsStatus
  version_number: number
  file_size_bytes: number | null
  uploaded_at: string
  uploaded_by: string | null
  uploader: { full_name: string | null } | { full_name: string | null }[] | null
}

export default async function DmsClientDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { folder?: string }
}) {
  const clientId = params.id
  const folderParam = searchParams.folder

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, locale')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return null

  const tenantId = profile.tenant_id as string
  const locale = ((profile.locale as Locale) ?? 'ar')

  const { data: clientData } = await svc
    .from('clients')
    .select('id, name, industry')
    .eq('tenant_id', tenantId)
    .eq('id', clientId)
    .maybeSingle()

  if (!clientData) notFound()

  const [foldersRes, allDocsRes] = await Promise.all([
    svc
      .from('dms_folders')
      .select('id, parent_id, name, kind, description')
      .eq('tenant_id', tenantId)
      .eq('client_id', clientId)
      .order('parent_id', { ascending: true, nullsFirst: true })
      .order('name', { ascending: true }),
    svc
      .from('dms_documents')
      .select(`
        id, folder_id, filename, display_name, doc_kind, sensitivity, status, version_number,
        file_size_bytes, uploaded_at, uploaded_by,
        uploader:users!uploaded_by(full_name)
      `)
      .eq('tenant_id', tenantId)
      .eq('client_id', clientId)
      .order('uploaded_at', { ascending: false }),
  ])

  const folders = (foldersRes.data ?? []) as FolderRow[]
  const docs    = (allDocsRes.data ?? []) as unknown as DocumentRow[]

  // Doc count per folder.
  const docCount = new Map<string, number>()
  for (const d of docs) {
    docCount.set(d.folder_id, (docCount.get(d.folder_id) ?? 0) + 1)
  }

  // Resolve current folder. Default = first sub-folder of the client root,
  // else the root itself.
  const root = folders.find((f) => f.parent_id === null) ?? null
  const subFolders = folders.filter((f) => f.parent_id === root?.id)
  const defaultFolder = subFolders[0] ?? root

  const currentFolderId = folderParam ?? defaultFolder?.id ?? null
  const currentFolder = folders.find((f) => f.id === currentFolderId) ?? null

  const folderDocs = currentFolder
    ? docs.filter((d) => d.folder_id === currentFolder.id)
    : []

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
        <Link href="/app/dms" className="hover:text-slate-700">{tServer('dms.crumb.dms', locale)}</Link>
        <span className="text-slate-300">/</span>
        <Link href="/app/dms/clients" className="hover:text-slate-700">{tServer('dms.crumb.clients', locale)}</Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-semibold">{clientData.name}</span>
      </nav>

      <header className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {clientData.name as string}
          </h1>
          {clientData.industry ? (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200">
              {clientData.industry as string}
            </span>
          ) : null}
        </div>
      </header>

      {/* 2-pane layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Folder tree */}
        <aside className="lg:col-span-1 space-y-3">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-slate-600">
            {tServer('dms.folder_tree.title', locale)}
          </h2>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100">
            {root ? (
              <FolderTreeNode
                folder={root}
                isCurrent={currentFolder?.id === root.id}
                clientId={clientId}
                locale={locale}
                docCount={docCount.get(root.id) ?? 0}
                isRoot
              />
            ) : null}
            {subFolders.map((f) => (
              <FolderTreeNode
                key={f.id}
                folder={f}
                isCurrent={currentFolder?.id === f.id}
                clientId={clientId}
                locale={locale}
                docCount={docCount.get(f.id) ?? 0}
              />
            ))}
            {folders.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">{tServer('dms.section.empty', locale)}</div>
            ) : null}
          </div>
        </aside>

        {/* Document list */}
        <section className="lg:col-span-2 space-y-3">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-slate-600">
            {currentFolder?.name ?? tServer('dms.folder_tree.title', locale)}
          </h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            {!currentFolder ? (
              <div className="p-10 text-center text-slate-500 text-sm">
                {tServer('dms.folder.select_one', locale)}
              </div>
            ) : folderDocs.length === 0 ? (
              <div className="p-10 text-center text-slate-500 text-sm">
                {tServer('dms.folder.empty', locale)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.display_name', locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.doc_kind',     locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.sensitivity', locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.status',      locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.version',     locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.size',        locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.uploaded_by', locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.uploaded_at', locale)}</th>
                      <th className="px-4 py-3 font-semibold text-end">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {folderDocs.map((d) => {
                      const uploader = Array.isArray(d.uploader) ? d.uploader[0] : d.uploader
                      return (
                        <tr key={d.id} className="hover:bg-slate-50/50 transition">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">{d.display_name ?? d.filename}</div>
                            <div className="text-xs text-slate-500 truncate font-mono">{d.filename}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{kindLabel(d.doc_kind, locale)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${sensitivityClasses(d.sensitivity)}`}>
                              {sensitivityLabel(d.sensitivity, locale)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusClasses(d.status)}`}>
                              {statusLabel(d.status, locale)}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-700 text-xs">v{d.version_number}</td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap font-mono text-xs">{fmtBytes(d.file_size_bytes, locale)}</td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{uploader?.full_name ?? '—'}</td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDateTime(d.uploaded_at, locale)}</td>
                          <td className="px-4 py-3 text-end whitespace-nowrap">
                            <a
                              href="#"
                              title={tServer('dms.actions.preview_not_available', locale)}
                              className="text-xs font-semibold text-teal-600 hover:text-teal-700 cursor-not-allowed opacity-80"
                            >
                              {tServer('dms.actions.view', locale)}
                            </a>
                            <span className="text-slate-300 mx-1.5">·</span>
                            <a
                              href="#"
                              title={tServer('dms.actions.preview_not_available', locale)}
                              className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-not-allowed opacity-80"
                            >
                              {tServer('dms.actions.download', locale)}
                            </a>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function FolderTreeNode({
  folder, isCurrent, clientId, locale, docCount, isRoot,
}: {
  folder: FolderRow
  isCurrent: boolean
  clientId: string
  locale: Locale
  docCount: number
  isRoot?: boolean
}) {
  const Icon = isCurrent ? FolderOpen : Folder
  return (
    <Link
      href={`/app/dms/clients/${clientId}?folder=${folder.id}`}
      aria-current={isCurrent ? 'page' : undefined}
      className={`flex items-center gap-3 px-4 py-3 transition ${
        isCurrent ? 'bg-teal-50' : 'hover:bg-slate-50'
      } ${isRoot ? 'font-semibold' : ''}`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${isCurrent ? 'text-teal-600' : 'text-slate-500'}`} aria-hidden="true" />
      <span className={`flex-1 truncate text-sm ${isCurrent ? 'text-teal-700' : 'text-slate-800'}`}>
        {folder.name}
      </span>
      <span className="text-xs text-slate-500 font-mono shrink-0">
        {tFn('dms.folder_tree.docs_n', locale, { n: docCount })}
      </span>
    </Link>
  )
}
