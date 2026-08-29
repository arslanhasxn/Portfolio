/** Card flip drag + snap tuning */
export const CARD_PHYSICS = {
  /** Card-widths of drag for a full 180° yaw */
  yawRange: 0.5,
  /** Card-heights of drag for max pitch */
  pitchRange: 0.44,
  pitchMax: 34,
  pitchRubber: 0.28,
  flickY: 280,
} as const

export const flipSnapSpring = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 36,
  mass: 0.88,
}

export const pitchSnapSpring = {
  type: 'spring' as const,
  stiffness: 520,
  damping: 34,
  mass: 0.7,
}

export function normalizeYaw(deg: number) {
  return ((deg % 360) + 360) % 360
}

export function yawSensitivity(cardWpx: number) {
  return 180 / (cardWpx * CARD_PHYSICS.yawRange)
}

export function pitchSensitivity(cardHpx: number) {
  return CARD_PHYSICS.pitchMax / (cardHpx * CARD_PHYSICS.pitchRange)
}

export function rubberbandPitch(value: number) {
  const { pitchMax, pitchRubber } = CARD_PHYSICS
  if (value < -pitchMax) return -pitchMax + (value + pitchMax) * pitchRubber
  if (value > pitchMax) return pitchMax + (value - pitchMax) * pitchRubber
  return value
}

/** Nearest settled face (0 = front, 180 = back) with optional flick */
export function resolveSnapYaw(current: number, velocityX: number): 0 | 180 {
  const norm = normalizeYaw(current)
  let toBack = norm > 90 && norm < 270

  if (Math.abs(velocityX) > CARD_PHYSICS.flickY) {
    if (norm <= 90 || norm >= 270) toBack = velocityX > 0
    else toBack = velocityX < 0
  }

  return toBack ? 180 : 0
}
