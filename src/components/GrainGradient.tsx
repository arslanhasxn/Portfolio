import type { CSSProperties, ReactNode } from 'react'

export type GrainGradientVariant =
  | 'default'
  | 'card-front'
  | 'card-back'
  | 'sample'

type GrainGradientProps = {
  className?: string
  variant?: GrainGradientVariant
  /** Override --grain-gradient-bg */
  gradient?: string
  /** Override --grain-opacity (0.05–0.15 typical) */
  grainOpacity?: number
  /** Override --grain-blend-mode */
  blendMode?: CSSProperties['mixBlendMode']
  children?: ReactNode
}

export function GrainGradient({
  className = '',
  variant = 'default',
  gradient,
  grainOpacity,
  blendMode,
  children,
}: GrainGradientProps) {
  const variantClass =
    variant === 'default' ? '' : `grain-gradient--${variant}`

  const style = {
    ...(gradient !== undefined && { '--grain-gradient-bg': gradient }),
    ...(grainOpacity !== undefined && {
      '--grain-opacity': String(grainOpacity),
    }),
    ...(blendMode !== undefined && { '--grain-blend-mode': blendMode }),
  } as CSSProperties

  return (
    <div
      className={`grain-gradient ${variantClass} ${className}`.trim()}
      style={style}
    >
      {children}
    </div>
  )
}
