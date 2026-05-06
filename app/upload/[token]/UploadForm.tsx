'use client'
import { useRef, useState, useTransition } from 'react'
import { Upload, FileText, CheckCircle2 } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleContext'
import { submitUploadFormAction } from './actions'

type UploadKind = 'contract' | 'bill' | 'proof_of_fund' | 'bank_statement'

const KINDS: UploadKind[] = ['contract', 'bill', 'proof_of_fund', 'bank_statement']

export function UploadForm({ token }: { token: string }) {
  const { t } = useLocale()
  const [files, setFiles] = useState<Partial<Record<UploadKind, File>>>({})
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function onPick(kind: UploadKind, e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFiles((prev) => ({ ...prev, [kind]: f }))
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formRef.current) return
    const fd = new FormData(formRef.current)
    fd.set('token', token)
    startTransition(() => submitUploadFormAction(fd))
  }

  const allFour = KINDS.every((k) => Boolean(files[k]))

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div className="space-y-3">
        {KINDS.map((kind) => (
          <UploadSlot
            key={kind}
            kind={kind}
            file={files[kind] ?? null}
            onPick={(e) => onPick(kind, e)}
            label={t(`disbursement.upload.kind.${kind}`)}
            chooseFileLabel={t('disbursement.upload.choose_file')}
            noFileLabel={t('disbursement.upload.no_file')}
          />
        ))}
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={pending || !allFour}
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-teal-600 text-white text-base font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="w-4 h-4" />
          {pending ? t('disbursement.upload.uploading') : t('disbursement.upload.submit')}
        </button>
      </div>
    </form>
  )
}

function UploadSlot({
  kind,
  file,
  onPick,
  label,
  chooseFileLabel,
  noFileLabel,
}: {
  kind: UploadKind
  file: File | null
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void
  label: string
  chooseFileLabel: string
  noFileLabel: string
}) {
  const inputId = `file_${kind}_input`
  return (
    <div
      className={`p-4 rounded-xl border ${file ? 'border-green-200 bg-green-50/30' : 'border-slate-200 bg-white'} flex items-center gap-3`}
    >
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
          file ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {file ? <CheckCircle2 className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        <div className="text-xs text-slate-500 truncate">
          {file ? file.name : noFileLabel}
        </div>
      </div>
      <label
        htmlFor={inputId}
        className="cursor-pointer inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
      >
        {chooseFileLabel}
      </label>
      <input
        id={inputId}
        name={`file_${kind}`}
        type="file"
        accept="application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={onPick}
        className="hidden"
      />
    </div>
  )
}
