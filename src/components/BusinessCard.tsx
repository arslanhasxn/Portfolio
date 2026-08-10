import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import {
  AnimatePresence,
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'motion/react'
import cardFront from '../assets/card-front.png'
import cardBack from '../assets/card-back.png'
import './BusinessCard.css'

type CardMode = 'peek' | 'focus'
type FocusPhase = 'opening' | 'ready' | 'closing'

const PEEK_PX = 28
const PEEK_HOVER_EXTRA = 14
const TILT_MAX = 12
const MOVE_FLIP_CANCEL = 12
/** Drag at least this far (or ~14% of card width) to flip */
const DRAG_FLIP_MIN = 36

const FRONT_RATIO = 1024 / 579
const BACK_RATIO = 579 / 1024

const snappy = {
  type: 'spring' as const,
  visualDuration: 0.28,
  bounce: 0.05,
}

/** Dock ↔ focus flight — no bounce so it doesn’t pop into the peek */
const dockSpring = {
  type: 'spring' as const,
  visualDuration: 0.42,
  bounce: 0,
}

const tiltSpring = {
  type: 'spring' as const,
  visualDuration: 0.18,
  bounce: 0.04,
}

/**
 * Face turn — ease-in-out so the mid transition (edge-on / face swap)
 * is the fastest part; soft ease into and out of the motion.
 */
const flipTween = {
  type: 'tween' as const,
  duration: 0.62,
  ease: [0.65, 0, 0.35, 1] as const,
}

function frontWidth() {
  return Math.min(
    typeof window !== 'undefined' ? window.innerWidth * 0.86 : 520,
    36 * 16,
  )
}

function backWidth() {
  return Math.min(
    typeof window !== 'undefined' ? window.innerWidth * 0.78 : 340,
    22 * 16,
  )
}

export function BusinessCard() {
  const [mode, setMode] = useState<CardMode>('peek')
  const [flipped, setFlipped] = useState(false)
  const [phase, setPhase] = useState<FocusPhase>('ready')
  const [peekHover, setPeekHover] = useState(false)
  const [flipping, setFlipping] = useState(false)
  const [flyFrom, setFlyFrom] = useState({ x: 0, y: 0 })
  const [riseWidthPx, setRiseWidthPx] = useState(520)
  const reduceMotion = useReducedMotion()
  const cardRef = useRef<HTMLButtonElement>(null)
  const peekFootprintRef = useRef<HTMLDivElement>(null)
  const focusFootprintRef = useRef<HTMLDivElement>(null)
  const pointerStart = useRef<{
    x: number
    y: number
    ox: number
    oy: number
  } | null>(null)
  const didMove = useRef(false)
  const didDragFlip = useRef(false)
  const timers = useRef<number[]>([])
  const pressing = useRef(false)
  const phaseGate = useRef(false)
  /** Primary face flip (ends at 0 or ±180) */
  const flipY = useMotionValue(0)
  /** Lead axis — arcs so the pressed corner goes back first (center hinge) */
  const flipX = useMotionValue(0)
  const flipAnimRef = useRef<{ stop: () => void } | null>(null)
  const flipTransform = useMotionTemplate`rotateX(${flipX}deg) rotateY(${flipY}deg)`

  const focused = mode === 'focus'
  const closing = phase === 'closing'
  const opening = phase === 'opening'
  const interactive = focused && phase === 'ready' && !flipping
  // Hide peek for the whole focus life — one continuous card, no dock crossfade
  const peekOccluded = focused

  const rotateXRaw = useMotionValue(0)
  const rotateYRaw = useMotionValue(0)
  const rotateX = useSpring(rotateXRaw, tiltSpring)
  const rotateY = useSpring(rotateYRaw, tiltSpring)
  const tiltTransform = useMotionTemplate`perspective(1100px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`

  const motionSpring = reduceMotion ? { duration: 0 } : snappy
  const flySpring = reduceMotion ? { duration: 0 } : dockSpring
  const peekLift = peekHover && !focused ? PEEK_PX + PEEK_HOVER_EXTRA : PEEK_PX

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timers.current.push(id)
  }

  const resetTilt = useCallback(() => {
    rotateXRaw.set(0)
    rotateYRaw.set(0)
  }, [rotateXRaw, rotateYRaw])

  useEffect(() => () => clearTimers(), [])

  const finishClose = useCallback(() => {
    setPeekHover(false)
    setMode('peek')
    setPhase('ready')
    phaseGate.current = false
  }, [])

  const measureDockTarget = useCallback(() => {
    const peek = peekFootprintRef.current?.getBoundingClientRect()
    if (peek && peek.width > 1 && peek.height > 1) {
      return {
        flyFrom: {
          x: peek.left + peek.width / 2 - window.innerWidth / 2,
          y: peek.top + peek.height / 2 - window.innerHeight / 2,
        },
        riseWidthPx: peek.width * FRONT_RATIO,
      }
    }

    const frame = document.querySelector('.app-frame')
    if (!frame) {
      return {
        flyFrom: { x: 0, y: window.innerHeight * 0.35 },
        riseWidthPx: Math.min(window.innerWidth * 1.15, 640),
      }
    }
    const fr = frame.getBoundingClientRect()
    const padL = parseFloat(getComputedStyle(frame).paddingLeft) || 32
    const padR = parseFloat(getComputedStyle(frame).paddingRight) || 32
    const peekW = Math.max(fr.width - padL - padR, 1)
    const peekH = peekW / BACK_RATIO
    const top = fr.bottom - PEEK_PX
    return {
      flyFrom: {
        x: fr.left + fr.width / 2 - window.innerWidth / 2,
        y: top + peekH / 2 - window.innerHeight / 2,
      },
      riseWidthPx: peekW * FRONT_RATIO,
    }
  }, [])

  const dismiss = useCallback(() => {
    if (!focused || closing) return
    clearTimers()
    flipAnimRef.current?.stop()
    flipAnimRef.current = null
    setFlipping(false)
    setPeekHover(false)
    flipX.set(0)
    resetTilt()
    phaseGate.current = false

    if (reduceMotion) {
      finishClose()
      return
    }

    const dock = measureDockTarget()
    setFlyFrom(dock.flyFrom)
    setRiseWidthPx(dock.riseWidthPx)
    setPhase('closing')
  }, [
    focused,
    closing,
    reduceMotion,
    resetTilt,
    finishClose,
    measureDockTarget,
  ])

  useEffect(() => {
    if (!focused) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, dismiss])

  const applyTilt = (clientX: number, clientY: number) => {
    const el = cardRef.current
    if (!el || reduceMotion || !interactive) return
    const rect = el.getBoundingClientRect()
    if (rect.width < 8 || rect.height < 8) return
    const px = (clientX - rect.left) / rect.width - 0.5
    const py = (clientY - rect.top) / rect.height - 0.5
    rotateYRaw.set(px * 2 * TILT_MAX)
    rotateXRaw.set(-py * 2 * TILT_MAX)
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!interactive) return
    pressing.current = true
    didMove.current = false
    didDragFlip.current = false
    const el = cardRef.current
    const rect = el?.getBoundingClientRect()
    const ox = rect
      ? (e.clientX - rect.left) / Math.max(rect.width, 1)
      : 0.5
    const oy = rect
      ? (e.clientY - rect.top) / Math.max(rect.height, 1)
      : 0.5
    pointerStart.current = { x: e.clientX, y: e.clientY, ox, oy }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    applyTilt(e.clientX, e.clientY)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!interactive || !pressing.current) return
    if (pointerStart.current) {
      const dx = e.clientX - pointerStart.current.x
      const dy = e.clientY - pointerStart.current.y
      if (Math.hypot(dx, dy) > MOVE_FLIP_CANCEL) didMove.current = true
    }
    applyTilt(e.clientX, e.clientY)
  }

  const onPointerUp = (e: PointerEvent) => {
    const start = pointerStart.current
    pressing.current = false
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ok */
    }

    if (start && focused && phase === 'ready' && !flipping) {
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      const dist = Math.hypot(dx, dy)
      const cardW = cardRef.current?.getBoundingClientRect().width ?? 320
      const threshold = Math.max(DRAG_FLIP_MIN, cardW * 0.14)

      if (dist >= threshold) {
        didMove.current = true
        didDragFlip.current = true
        // Opposite of press-to-flip: swipe direction sends that side back
        // (drag left → left back; drag right → right back)
        const ox =
          Math.abs(dx) >= Math.abs(dy) * 0.45
            ? dx < 0
              ? 0.22
              : 0.78
            : 1 - start.ox
        const oy =
          Math.abs(dy) >= Math.abs(dx) * 0.45
            ? dy < 0
              ? 0.22
              : 0.78
            : 1 - start.oy
        void runFlip(ox, oy)
      }
    }

    resetTilt()
    pointerStart.current = null
  }

  const onPointerLeave = () => {
    if (!pressing.current) resetTilt()
  }

  const openFromPeek = () => {
    clearTimers()
    phaseGate.current = false
    // Measure dock while peek is still visible (incl. hover lift), then take over
    const rect = peekFootprintRef.current?.getBoundingClientRect()
    if (rect) {
      setFlyFrom({
        x: rect.left + rect.width / 2 - window.innerWidth / 2,
        y: rect.top + rect.height / 2 - window.innerHeight / 2,
      })
      setRiseWidthPx(Math.max(rect.width * FRONT_RATIO, rect.height))
    } else {
      setFlyFrom({ x: 0, y: window.innerHeight * 0.35 })
      setRiseWidthPx(Math.min(window.innerWidth * 1.15, 640))
    }
    setPeekHover(false)
    flipY.set(flipped ? 180 : 0)
    flipX.set(0)
    setPhase('opening')
    setMode('focus')
  }

  /**
   * Center hinge: pressed corner goes into depth, opposite corner comes up.
   * rotateY does the face change; rotateX arcs so the click leads the turn.
   */
  const runFlip = async (ox: number, oy: number) => {
    const goingToBack = !flipped

    if (reduceMotion) {
      setFlipped(goingToBack)
      flipY.set(goingToBack ? 180 : 0)
      flipX.set(0)
      return
    }

    setFlipping(true)
    resetTilt()
    flipX.set(0)

    // Click offset from center, -1..1
    const cx = Math.min(1, Math.max(-1, (ox - 0.5) * 2))
    const cy = Math.min(1, Math.max(-1, (oy - 0.5) * 2))

    // +rotateY → right goes back; -rotateY → left goes back
    const yDir: 1 | -1 = cx >= 0 ? 1 : -1
    // CSS Y is down: +rotateX sends the TOP back (bottom comes up).
    // Top click (cy < 0) → positive peak; bottom click → negative.
    const xPeak = -cy * 64

    const startY = flipY.get()
    // Always turn in the push direction (including back → front)
    const endY = startY + yDir * 180
    let swapped = false

    const yAnim = animate(flipY, endY, {
      ...flipTween,
      onUpdate: (latest) => {
        const t = (latest - startY) / (endY - startY)
        if (!swapped && t >= 0.5) {
          swapped = true
          setFlipped(goingToBack)
        }
      },
    })
    const xAnim = animate(flipX, [0, xPeak, 0], {
      ...flipTween,
      times: [0, 0.5, 1],
    })

    flipAnimRef.current = {
      stop: () => {
        yAnim.stop()
        xAnim.stop()
      },
    }

    await Promise.all([yAnim, xAnim])
    flipAnimRef.current = null
    // Settle on a clean facing so the next flip stays stable
    flipY.set(goingToBack ? yDir * 180 : 0)
    flipX.set(0)
    setFlipping(false)
  }

  const onCardClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (!focused) {
      openFromPeek()
      return
    }
    if (!interactive || didMove.current || didDragFlip.current) return

    const el = cardRef.current
    let ox = 0.5
    let oy = 0.5
    if (el) {
      const rect = el.getBoundingClientRect()
      ox = (e.clientX - rect.left) / Math.max(rect.width, 1)
      oy = (e.clientY - rect.top) / Math.max(rect.height, 1)
    }

    void runFlip(ox, oy)
  }

  const onFlyComplete = () => {
    if (phaseGate.current) return
    if (phase === 'opening') {
      phaseGate.current = true
      setPhase('ready')
      later(() => {
        phaseGate.current = false
      }, 50)
    } else if (phase === 'closing') {
      phaseGate.current = true
      finishClose()
    }
  }

  const riseW = flipped
    ? Math.min(
        riseWidthPx / FRONT_RATIO,
        typeof window !== 'undefined' ? window.innerHeight * 0.85 : 600,
      )
    : riseWidthPx

  const finalWpx = flipped ? backWidth() : frontWidth()
  const footprintRatio = flipped ? BACK_RATIO : FRONT_RATIO

  const flyTarget = closing
    ? { x: flyFrom.x, y: flyFrom.y, rotate: flipped ? 0 : 90 }
    : { x: 0, y: 0, rotate: 0 }

  const widthTarget = closing ? riseW : finalWpx
  const flying = opening || closing

  return (
    <>
      <AnimatePresence>
        {focused && (
          <motion.button
            type="button"
            className="card-backdrop"
            aria-label="Dismiss business card"
            initial={{ opacity: 0 }}
            animate={{ opacity: closing ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={motionSpring}
            onClick={dismiss}
          />
        )}
      </AnimatePresence>

      <div className="card-label-wrap">
        <p className="card-label">(VERY SERIOUS) BUSINESS CARD</p>
      </div>

      <div
        className={`card-slot is-peek${peekOccluded ? ' is-occluded' : ''}`}
        style={{
          transform: `translateY(calc(100% - ${peekLift}px))`,
        }}
        onMouseEnter={() => {
          if (!focused) setPeekHover(true)
        }}
        onMouseLeave={() => setPeekHover(false)}
      >
        <button
          type="button"
          className="card-hit"
          aria-label="Open business card"
          aria-expanded={focused}
          tabIndex={focused ? -1 : 0}
          onClick={onCardClick}
        >
          <div className="card-tilt" style={{ width: '100%' }}>
            <div
              ref={peekFootprintRef}
              className="card-footprint card-footprint--peek"
            >
              <div className="card-stage">
                <div className="card-flip">
                  {flipped ? (
                    <div className="card-face card-face--peek-back">
                      <img src={cardBack} alt="" draggable={false} />
                    </div>
                  ) : (
                    <div className="card-face card-face--front card-face--docked">
                      <img src={cardFront} alt="" draggable={false} />
                      {!reduceMotion && (
                        <span className="card-wave" aria-hidden="true" />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </button>
      </div>

      {focused && (
        <div className="card-slot is-focus">
          <motion.div
            className="card-fly"
            initial={
              reduceMotion
                ? false
                : {
                    x: flyFrom.x,
                    y: flyFrom.y,
                    rotate: flipped ? 0 : 90,
                  }
            }
            animate={flyTarget}
            transition={flySpring}
            onAnimationComplete={onFlyComplete}
          >
            <motion.button
              ref={cardRef}
              type="button"
              className="card-hit"
              aria-label={
                flipped
                  ? 'Flip business card to front'
                  : 'Flip business card to back'
              }
              aria-expanded
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerLeave}
              onClick={onCardClick}
            >
              <motion.div
                className="card-tilt"
                style={
                  interactive && !reduceMotion
                    ? { transform: tiltTransform }
                    : undefined
                }
              >
                <motion.div
                  ref={focusFootprintRef}
                  className={`card-footprint${flying ? ' is-flying' : ''}`}
                  initial={
                    reduceMotion
                      ? false
                      : { width: riseW, aspectRatio: footprintRatio }
                  }
                  animate={{
                    width: widthTarget,
                    aspectRatio: footprintRatio,
                  }}
                  transition={flipping ? { duration: 0 } : flySpring}
                >
                  <div className="card-stage is-live">
                    <motion.div
                      className="card-flip"
                      style={{ transform: flipTransform }}
                    >
                      <div className="card-face card-face--front">
                        <img src={cardFront} alt="" draggable={false} />
                        {!flipped && !flipping && !reduceMotion && (
                          <span
                            className="card-wave card-wave--soft"
                            aria-hidden="true"
                          />
                        )}
                      </div>

                      <div className="card-face card-face--back">
                        <img src={cardBack} alt="" draggable={false} />
                      </div>
                    </motion.div>
                  </div>
                </motion.div>
              </motion.div>
            </motion.button>
          </motion.div>
        </div>
      )}
    </>
  )
}
