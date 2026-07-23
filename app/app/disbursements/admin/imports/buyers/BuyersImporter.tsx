'use client'

import { BaseImporter, type BaseImporterProps } from '../_shared/BaseImporter'
import {
  BUYER_FIELDS,
  toIdType,
  toNumOrNull,
  toStr,
  type MappingField,
  type ProjectLite,
} from '../_shared/shared-mapping'
import {
  bulkImportBuyersFromRows,
  checkExistingUnits,
  type BulkImportBuyerRow,
} from '../../units/actions'

type Payload = BulkImportBuyerRow

const PREVIEW_COLUMNS = [
  { key: 'buyer', label: 'اسم المشتري' },
  { key: 'id_type', label: 'نوع الهوية' },
  { key: 'id_number', label: 'رقم الهوية' },
  { key: 'phone', label: 'الجوال' },
  { key: 'nationality', label: 'الجنسية' },
] as const

export function BuyersImporter({ projects }: { projects: ProjectLite[] }) {
  const parseRow: BaseImporterProps<Payload>['parseRow'] = ({
    rowValues,
    columns,
    sheetName,
    rowNumber,
    projectRaw,
  }) => {
    const at = (idx: number | null): unknown =>
      idx === null || idx < 0 ? '' : rowValues[idx]

    const unit_number = toStr(at(columns.unit_number))
    if (!unit_number) return null

    const buyer_name_ar = toStr(at(columns.buyer_name)) || null
    const buyer_id_type = toIdType(at(columns.buyer_id_type))
    const buyer_id_number = toStr(at(columns.buyer_id_number)) || null
    const buyer_nationality = toStr(at(columns.buyer_nationality)) || null
    const buyer_phone = toStr(at(columns.buyer_phone)) || null
    const sale_count = toNumOrNull(at(columns.sale_count))

    return {
      sheetName,
      rowNumber,
      projectRaw,
      unit_number,
      previewCells: {
        buyer: buyer_name_ar ?? '—',
        id_type: buyer_id_type ?? '—',
        id_number: buyer_id_number ?? '—',
        phone: buyer_phone ?? '—',
        nationality: buyer_nationality ?? '—',
      },
      payload: {
        project_id: '',
        unit_number,
        buyer_name_ar,
        buyer_id_type,
        buyer_id_number,
        buyer_nationality,
        // No dedicated AI mapping for residency subtype today — the legacy
        // sheet layout kept it in its own column; new layouts merge it into
        // id_type. Left null.
        buyer_residency_type: null,
        buyer_phone,
        sale_count,
      },
    }
  }

  return (
    <BaseImporter<Payload>
      title="ملف Excel: قائمة المشترين"
      subtitle="ارفع ملف يحتوي على (رقم الوحدة، اسم المشتري، الهوية، الجنسية، الجوال، اسم المشروع). سيبحث النظام عن الوحدة داخل المشروع ويحدّث سجل البيع النشط."
      projects={projects}
      relevantFields={BUYER_FIELDS as readonly MappingField[]}
      previewColumns={PREVIEW_COLUMNS}
      parseRow={parseRow}
      attachProjectId={(payload, projectId) => ({ ...payload, project_id: projectId })}
      checkExisting={async (pairs) => {
        const res = await checkExistingUnits({ pairs })
        const set = new Set<string>()
        if (res.ok) {
          for (const p of res.existing) set.add(`${p.project_id}::${p.unit_number}`)
        }
        return set
      }}
      onSubmit={async (payloads) => {
        const res = await bulkImportBuyersFromRows({ rows: payloads })
        if (!res.ok) return { ok: false, message: res.error }
        return {
          ok: true,
          message: (
            <>
              حُدِّث <span className="font-mono font-bold">{res.updatedSales}</span> سجل بيع
              نشط وأُضيف <span className="font-mono font-bold">{res.insertedSales}</span> سجل
              جديد.
              {res.skippedRows > 0 && (
                <>
                  {' '}تم تجاهل{' '}
                  <span className="font-mono font-bold">{res.skippedRows}</span> صف (لا
                  يحتوي على رقم وحدة).
                </>
              )}
            </>
          ),
          extra:
            res.unmatched.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                <div className="font-semibold mb-1">
                  {res.unmatched.length} وحدة لم يتم العثور عليها (تم تجاهلها):
                </div>
                <ul className="list-disc ms-5 space-y-0.5 max-h-40 overflow-y-auto">
                  {res.unmatched.slice(0, 20).map((u, i) => (
                    <li key={i} className="font-mono">
                      {u.unit_number}
                    </li>
                  ))}
                  {res.unmatched.length > 20 && (
                    <li>… (+{res.unmatched.length - 20} أخرى)</li>
                  )}
                </ul>
                <div className="mt-1">
                  أنشئ هذه الوحدات أولًا من «قائمة الوحدات (المواصفات)».
                </div>
              </div>
            ) : undefined,
        }
      }}
    />
  )
}
