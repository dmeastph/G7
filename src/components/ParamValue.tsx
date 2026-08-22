// isSet === false must render as "not set", never a fallback number — this
// is the one place that rule is enforced so no screen can get it wrong
// (docs/03-M0-FOUNDATION.md §6).
import { useParam } from '@/lib/params'
import { formatParamValue } from '@/lib/format'

export function ParamValue({ paramKey }: { paramKey: string }) {
  const p = useParam(paramKey)

  if (p.loading) return <span className="param-value param-value--loading">…</span>

  if (!p.isSet) {
    return (
      <span className="param-value param-value--unset" title="See the Operations Manual for the authoritative value">
        not set
      </span>
    )
  }

  return <span className="param-value">{formatParamValue(p)}</span>
}
