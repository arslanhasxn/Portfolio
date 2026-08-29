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

export const flipSnapTween = {
  type: 'tween' as const,
  duration: 0.38,
  ease: [0.65, 0, 0.35, 1] as const,
}

export const pitchSnapTween = {
  type: 'tween' as const,
  duration: 0.28,
  ease: [0.22, 1, 0.36, 1] as const,
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

/** Which face is currently showing from an arbitrary yaw angle */
export function nearestSettledYaw(current: number): 0 | 180 {
  const norm = normalizeYaw(current)
  return norm > 90 && norm < 270 ? 180 : 0
}

/**
 * Shortest arc on the yaw circle (e.g. 350° → 0° is +10°, not −350°).
 */
export function shortestYawDelta(current: number, target: 0 | 180): number {
  return ((target - current + 540) % 360) - 180
}

/**
 * Pick an equivalent yaw (±360°) closest to `current` for continuity while dragging.
 */
export function continuityYaw(current: number, next: number): number {
  let best = next
  let bestDist = Infinity
  for (let k = -2; k <= 2; k++) {
    const candidate = next + k * 360
    const dist = Math.abs(candidate - current)
    if (dist < bestDist) {
      bestDist = dist
      best = candidate
    }
  }
  return best
}

/**
 * @deprecated Use shortestYawDelta — kept for any external refs
 */
export function snapStartYaw(current: number, target: 0 | 180): number {
  return current + shortestYawDelta(current, target)
}
