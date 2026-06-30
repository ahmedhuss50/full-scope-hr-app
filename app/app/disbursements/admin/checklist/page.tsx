import { redirect } from 'next/navigation'

// Old "checklist items" admin page replaced by named templates in migration
// 053. Existing links from the admin landing / sidebar still land here, so
// transparently redirect to the new templates index. The new pages live
// under /admin/checklist-templates.
export default function ChecklistAdminRedirect() {
  redirect('/app/disbursements/admin/checklist-templates')
}
