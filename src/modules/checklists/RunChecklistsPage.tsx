// Same shape as M1's "take readings" — due/overdue/missed tiles, one tap
// in (docs/07-M2-CHECKLISTS.md §2).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { onSnapshot, query, where } from 'firebase/firestore'
import { businessDaysCol, checklistRunsCol, checklistTemplatesCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useCurrentBusinessDayId } from '@/lib/businessDay'
import { useParam } from '@/lib/params'
import { ensureChecklistRuns, computeRunStatus, pickCurrentRun, useChecklistActions, CHECKLIST_GRACE_PARAM_KEY } from './actions'
import type { BusinessDay, ChecklistRun, ChecklistTemplate } from '@/lib/types'

type RunRow = ChecklistRun & { id: string }

const INTERVAL_PARAM_BY_CATEGORY: Record<string, string> = {
  ramyeon_station: 'clean.ramyeon_station_interval_minutes',
  dining: 'clean.dining_check_interval_minutes',
  general: 'clean.general_check_interval_minutes',
}

export function RunChecklistsPage() {
  const navigate = useNavigate()
  const activeBranch = useActiveBranch()
  const businessDayId = useCurrentBusinessDayId()
  const { raiseMissedRunException } = useChecklistActions()

  const ramyeonInterval = useParam(INTERVAL_PARAM_BY_CATEGORY.ramyeon_station)
  const diningInterval = useParam(INTERVAL_PARAM_BY_CATEGORY.dining)
  const generalInterval = useParam(INTERVAL_PARAM_BY_CATEGORY.general)
  const graceParam = useParam(CHECKLIST_GRACE_PARAM_KEY)

  const [businessDay, setBusinessDay] = useState<BusinessDay | null>(null)
  const [templates, setTemplates] = useState<(ChecklistTemplate & { id: string })[]>([])
  const [runs, setRuns] = useState<RunRow[]>([])
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!businessDayId) return
    return onSnapshot(query(businessDaysCol, where('__name__', '==', businessDayId)), (snap) => {
      setBusinessDay(snap.docs[0]?.data() ?? null)
    })
  }, [businessDayId])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(checklistTemplatesCol, where('branchId', '==', activeBranch.branchId), where('active', '==', true))
    return onSnapshot(q, (snap) => setTemplates(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch || !businessDayId) return
    const q = query(checklistRunsCol, where('branchId', '==', activeBranch.branchId), where('businessDayId', '==', businessDayId))
    return onSnapshot(q, (snap) => setRuns(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch, businessDayId])

  const graceMinutes = graceParam.isSet && typeof graceParam.value === 'number' ? graceParam.value : 45
  const intervalByCategory: Record<string, number | null> = {
    ramyeon_station: ramyeonInterval.isSet && typeof ramyeonInterval.value === 'number' ? ramyeonInterval.value : null,
    dining: diningInterval.isSet && typeof diningInterval.value === 'number' ? diningInterval.value : null,
    general: generalInterval.isSet && typeof generalInterval.value === 'number' ? generalInterval.value : null,
  }

  useEffect(() => {
    if (!activeBranch || !businessDayId || !businessDay || templates.length === 0) return
    ensureChecklistRuns(
      activeBranch.branchId,
      businessDayId,
      businessDay.opensAt.toDate(),
      businessDay.closesAt.toDate(),
      templates,
      intervalByCategory,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, businessDayId, businessDay, templates])

  // One tile per template — ensureChecklistRuns creates every slot for the
  // whole day, but only the current one (earliest not-done, else most
  // recent) is worth showing, same reasoning as M1's per-equipment tiles.
  const currentRunByTemplate = useMemo(() => {
    const byTemplate = new Map<string, RunRow[]>()
    for (const run of runs) {
      const list = byTemplate.get(run.templateId) ?? []
      list.push(run)
      byTemplate.set(run.templateId, list)
    }
    return Array.from(byTemplate.values())
      .map((list) => pickCurrentRun(list, now))
      .filter((r): r is RunRow => r !== null)
  }, [runs, now])

  // Periodic categories are missed once the next slot starts (their own
  // interval); opening/closing have no "next slot" — the business day
  // closing is the natural boundary instead.
  function windowMinutesFor(run: RunRow): number {
    const interval = intervalByCategory[run.category]
    if (interval) return interval
    if (businessDay) return Math.max(1, (businessDay.closesAt.toMillis() - run.dueAt.toMillis()) / 60_000)
    return graceMinutes
  }

  const rows = useMemo(
    () =>
      currentRunByTemplate.map((run) => ({
        run,
        status: computeRunStatus(
          run.dueAt.toDate(),
          now,
          graceMinutes,
          windowMinutesFor(run),
          run.status === 'in_progress',
          run.status === 'completed',
        ),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRunByTemplate, now, graceMinutes, businessDay, intervalByCategory],
  )

  useEffect(() => {
    let cancelled = false
    async function raiseMissed() {
      for (const { run, status } of rows) {
        if (status !== 'missed') continue
        if (cancelled) return
        await raiseMissedRunException({ id: run.id, templateName: run.templateName, category: run.category, branchId: run.branchId })
      }
    }
    raiseMissed()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  return (
    <div className="checklists-page">
      <h2>Checklists</h2>
      {rows.length === 0 && <p className="empty-state">Nothing scheduled yet today.</p>}
      <div className="readings-grid">
        {rows.map(({ run, status }) => (
          <button
            key={run.id}
            type="button"
            className={`reading-tile reading-tile--${status}`}
            onClick={() => navigate(`/checklists/runs/${run.id}`)}
          >
            <span className="reading-tile__asset">{run.templateName}</span>
            <span className="reading-tile__zone">{run.category}{run.scheduledSlot ? ` · ${run.scheduledSlot}` : ''}</span>
            <span className="reading-tile__status">{status}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
