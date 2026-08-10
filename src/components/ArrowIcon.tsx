import arrowUrl from '../assets/arrow.png'

/** Exact arrow asset provided by design */
export function ArrowIcon({ className }: { className?: string }) {
  return (
    <span
      className={className ? `arrow-icon ${className}` : 'arrow-icon'}
      style={{
        WebkitMaskImage: `url(${arrowUrl})`,
        maskImage: `url(${arrowUrl})`,
      }}
      aria-hidden="true"
    />
  )
}
