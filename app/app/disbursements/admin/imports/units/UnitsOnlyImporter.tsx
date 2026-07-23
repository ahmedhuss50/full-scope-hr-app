'use client'

import { BaseImporter, type BaseImporterProps } from '../_shared/BaseImporter'
import {
  toNumOrNull,
  toStr,
  toUnitType,
  UNIT_SPEC_FIELDS,
  type MappingField,
  type ProjectLite,
} from '../_shared/shared-mapping'
import {
  bulkImportUnitsOnly,
  type BulkImportUnitOnlyRow,
} from '../../units/actions'

// Payload the server action expects. `project_id` is filled by BaseImporter
// right before submission from the row's selectedProjectId.
type Payload = Omit<BulkImportUnitOnlyRow, 'project_id'> & { project_id: string }

const PREVIEW_COLUMNS = [
  { key: 'block', label: 'البلوك' },
  { key: 'zone', label: 'المنطقة' },
  { key: 'type', label: 'النوع' },
  { key: 'area', label: 'المساحة' },
  { key: 'district', label: 'الحي' },
] as const

export function UnitsOnlyImporter({ projects }: { projects: ProjectLite[] }) {
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

    const zone_number = toStr(at(columns.zone_number)) || null
    const block_number = toStr(at(columns.block_number)) || null
    const unit_type = toUnitType(at(columns.unit_type))
    const area_m2 = toNumOrNull(at(columns.area_m2))
    const district = toStr(at(columns.district)) || null
    const city = toStr(at(columns.city)) || null
    const region = toStr(at(columns.region)) || null

    return {
      sheetName,
      rowNumber,
      projectRaw,
      unit_number,
      previewCells: {
        block: block_number ?? '—',
        zone: zone_number ?? '—',
        type: unit_type ?? '—',
        area: area_m2 !== null ? String(area_m2) : '—',
        district: district ?? '—',
      },
      payload: {
        project_id: '',   // resolved from selectedProjectId at submit time
        unit_number,
        zone_number,
        block_number,
        unit_type,
        area_m2,
        district,
        city,
        region,
      },
    }
  }

  return (
    <BaseImporter<Payload>
      title="ملف Excel: قائمة الوحدات"
      subtitle="ارفع ملف يحتوي على أعمدة مواصفات الوحدات (رقم الوحدة، البلوك، المنطقة، المساحة، الحي، المدينة، المنطقة، نوع الوحدة، اسم المشروع). سيتم قراءة الأعمدة تلقائيًا ومطابقة اسم المشروع مع القائمة."
      projects={projects}
      relevantFields={UNIT_SPEC_FIELDS as readonly MappingField[]}
      previewColumns={PREVIEW_COLUMNS}
      parseRow={parseRow}
      attachProjectId={(payload, projectId) => ({ ...payload, project_id: projectId })}
      // No checkExisting: units-only can create new units, so "unit missing"
      // isn't a warning here.
      onSubmit={async (payloads) => {
        const res = await bulkImportUnitsOnly({ rows: payloads })
        if (!res.ok) return { ok: false, message: res.error }
        return {
          ok: true,
          message: (
            <>
              حُدِّثت <span className="font-mono font-bold">{res.upsertedUnits}</span> وحدة.
              {res.skippedRows > 0 && (
                <>
                  {' '}تم تجاهل{' '}
                  <span className="font-mono font-bold">{res.skippedRows}</span>{' '}
                  صف (لا يحتوي على رقم وحدة).
                </>
              )}
            </>
          ),
        }
      }}
    />
  )
}
