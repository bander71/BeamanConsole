import { useToast } from './toast-context.ts'

/** A label and value row in a detail panel. Hidden when there's no value. */
export function Field({ label, value, copy }: { label: string; value: string | null | undefined; copy?: boolean }) {
  const toast = useToast()
  if (!value) return null
  return (
    <div className="kv">
      <span className="k">{label}</span>
      <span className="v">
        {value}
        {copy && (
          <>
            {' '}
            <button className="btn quiet sm" aria-label={`Copy ${label}`}
              onClick={() => navigator.clipboard.writeText(value).then(() => toast('Copied ' + value), () => toast(value))}>
              Copy
            </button>
          </>
        )}
      </span>
    </div>
  )
}
