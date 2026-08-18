import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react'
import cardFront from '../assets/card-front.png'
import cardBack from '../assets/card-back.png'
import './BusinessCard.css'

type CardMode = 'peek' | 'focus'
type FocusPhase = 'scrubbing' | 'opening' | 'ready' | 'closing'

const PEEK_PX = 28
const PEEK_HOVER_EXTRA = 14
const TILT_MAX = 12
const AXIS_LOCK = 10
const DRAG_FLIP_MIN = 36
const PULL_COMMIT = 0.28
const PULL_VELOCITY = 650

const BACK_RATIO = 579 / 1024
const FRONT_RATIO = 1024 / 579

/**
 * Dock flight — slight overshoot past the rest pose, then ease back.
 * Keep bounce low so it reads as smooth, not bouncy.
 */
const dockSpring = {
  type: 'spring' as const,
  visualDuration: 0.5,
  bounce: 0.12,
}

/** Non-overshooting channels (width / backdrop) — clean ease alongside the spring */
const dockFade = {
  type: 'tween' as const,
  duration: 0.4,
  ease: [0.22, 1, 0.36, 1] as const,
}

const tiltSpring = {
  type: 'spring' as const,
  visualDuration: 0.18,
  bounce: 0.04,
}

/** Wait after docking before the first invite */
const INVITE_INITIAL_DELAY_MS = 2000
/** Rest between peek invite nudge pairs */
const INVITE_REST_MS = 3200
const INVITE_LIFT = -12
/** Idle swivel: cursor circling the card rim (degrees) */
const IDLE_TILT = 2.65
const IDLE_ORBIT_MS = 2800
/**
 * Dock-down if press started above this (normalized Y on the *visual* card).
 * Values < 0 = started in the hit padding above the card.
 * Bottom band stays flip-friendly.
 */
const DOCK_START_OY_MAX = 0.75
/** Gap just under COMPONENT LIBRARY before pull-up begins */
const OPEN_GAP_BELOW_PROJECTS = 8

/** Y below which a swipe-up can open the card (just under last project link) */
function openSwipeMinY() {
  const links = document.querySelectorAll('.cell-projects .project-link')
  const last = links[links.length - 1] as HTMLElement | undefined
  if (last) {
    return last.getBoundingClientRect().bottom + OPEN_GAP_BELOW_PROJECTS
  }
  const projects = document.querySelector('.cell-projects')
  if (projects) {
    return projects.getBoundingClientRect().bottom + OPEN_GAP_BELOW_PROJECTS
  }
  const { h } = viewSize()
  return h * 0.45
}

const flipTween = {
  type: 'tween' as const,
  duration: 0.62,
  ease: [0.65, 0, 0.35, 1] as const,
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function clamp01(t: number) {
  return Math.min(1, Math.max(0, t))
}

function viewSize() {
  const vv = window.visualViewport
  return {
    w: vv?.width ?? window.innerWidth,
    h: vv?.height ?? window.innerHeight,
  }
}

function frontWidth() {
  const { w } = viewSize()
  return Math.min(w * 0.86, 36 * 16)
}

/** Visual width of the docked peek strip (portrait slot). */
function peekSlotWidth() {
  const frame = document.querySelector('.app-frame')
  if (!frame) return frontWidth()
  const fr = frame.getBoundingClientRect()
  const padL = parseFloat(getComputedStyle(frame).paddingLeft) || 32
  const padR = parseFloat(getComputedStyle(frame).paddingRight) || 32
  return Math.max(fr.width - padL - padR, 120)
}

/** Portrait back — same physical card as front, nudged a bit larger. */
function backWidth() {
  return (frontWidth() / FRONT_RATIO) * 1.12
}

type DockPose = {
  x: number
  y: number
  riseW: number
  finalW: number
  rotate: number
  /** Scale at dock so the face matches the peek strip */
  dockScale: number
  /** Width/height ratio for the active face */
  ratio: number
}

export function BusinessCard() {
  const [mode, setMode] = useState<CardMode>('peek')
  const [flipped, setFlipped] = useState(false)
  const [phase, setPhase] = useState<FocusPhase>('ready')
  const [peekHover, setPeekHover] = useState(false)
  const [flipping, setFlipping] = useState(false)
  /** After first open this session, stop peek invite (resets on refresh) */
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false)
  const reduceMotion = useReducedMotion()
  const cardRef = useRef<HTMLButtonElement>(null)
  const peekFootprintRef = useRef<HTMLDivElement>(null)
  const focusFootprintRef = useRef<HTMLDivElement>(null)

  const pointerStart = useRef<{
    x: number
    y: number
    ox: number
    oy: number
    t: number
  } | null>(null)
  const didMove = useRef(false)
  const didDragFlip = useRef(false)
  const didPull = useRef(false)
  const axisLock = useRef<'h' | 'v' | null>(null)
  const pullKind = useRef<'open' | 'close' | null>(null)
  const dockPose = useRef<DockPose | null>(null)
  const timers = useRef<number[]>([])
  const pressing = useRef(false)
  const flyAnimRef = useRef<{ stop: () => void } | null>(null)
  /** Mirrors phase for gesture handlers (avoids stale-closure misses on mobile) */
  const phaseRef = useRef<FocusPhase>(phase)
  phaseRef.current = phase
  const flippingRef = useRef(flipping)
  flippingRef.current = flipping

  const flipY = useMotionValue(0)
  const flipX = useMotionValue(0)
  const flipAnimRef = useRef<{ stop: () => void } | null>(null)
  const flipTransform = useMotionTemplate`rotateX(${flipX}deg) rotateY(${flipY}deg)`

  const flyX = useMotionValue(0)
  const flyY = useMotionValue(0)
  const flyRotate = useMotionValue(0)
  const flyScale = useMotionValue(1)
  const cardW = useMotionValue(frontWidth())
  /** Explicit height — keeps face ratio stable (no Safari aspect-ratio drop) */
  const cardRatio = useMotionValue(FRONT_RATIO)
  const cardH = useTransform(
    [cardW, cardRatio],
    ([w, r]) => (w as number) / (r as number),
  )
  const backdropOp = useMotionValue(0)
  /** Peek swipe-up invite bob */
  const peekBobY = useMotionValue(0)
  /** Focused card idle pivot (hint: interactive) */
  const idleRX = useMotionValue(0)
  const idleRY = useMotionValue(0)

  const focused = mode === 'focus'
  const closing = phase === 'closing'
  const opening = phase === 'opening'
  const scrubbing = phase === 'scrubbing'
  const interactive = focused && phase === 'ready' && !flipping
  const peekOccluded = focused

  const rotateXRaw = useMotionValue(0)
  const rotateYRaw = useMotionValue(0)
  const rotateX = useSpring(rotateXRaw, tiltSpring)
  const rotateY = useSpring(rotateYRaw, tiltSpring)
  const totalRX = useTransform(
    [rotateX, idleRX],
    ([a, b]) => (a as number) + (b as number),
  )
  const totalRY = useTransform(
    [rotateY, idleRY],
    ([a, b]) => (a as number) + (b as number),
  )
  const tiltTransform = useMotionTemplate`perspective(1100px) rotateX(${totalRX}deg) rotateY(${totalRY}deg)`

  const peekLift = peekHover && !focused ? PEEK_PX + PEEK_HOVER_EXTRA : PEEK_PX

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }

  const resetTilt = useCallback(() => {
    rotateXRaw.set(0)
    rotateYRaw.set(0)
  }, [rotateXRaw, rotateYRaw])

  useEffect(() => {
    return () => {
      clearTimers()
    }
  }, [])

  // Peek: quick pull-pull, then rest — swipe-up prompt (once per page load)
  useEffect(() => {
    if (focused || reduceMotion || peekHover || hasOpenedOnce) {
      peekBobY.set(0)
      return
    }
    let cancelled = false
    let restTimer = 0

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        restTimer = window.setTimeout(resolve, ms)
      })

    const run = async () => {
      // Let the dock settle before prompting
      await sleep(INVITE_INITIAL_DELAY_MS)
      while (!cancelled) {
        // Single keyframed pull-pull — no dead settle between tugs
        await animate(
          peekBobY,
          [0, INVITE_LIFT, INVITE_LIFT * 0.4, INVITE_LIFT, 0],
          {
            duration: 0.84,
            times: [0, 0.24, 0.42, 0.64, 1],
            ease: ['easeOut', 'easeInOut', 'easeOut', 'easeInOut'],
          },
        )
        if (cancelled) break
        await sleep(INVITE_REST_MS)
      }
    }
    void run()
    return () => {
      cancelled = true
      window.clearTimeout(restTimer)
      peekBobY.set(0)
    }
  }, [focused, reduceMotion, peekHover, hasOpenedOnce, peekBobY])

  // Focused: tilt follows a cursor circling the card edge
  // Delay start so it doesn't feel like a settle after dock-up lands
  useEffect(() => {
    if (!interactive || reduceMotion) {
      idleRX.set(0)
      idleRY.set(0)
      return
    }
    let cancelled = false
    let raf = 0
    let t0 = 0

    const startTimer = window.setTimeout(() => {
      if (cancelled) return
      t0 = performance.now()
      const frame = (now: number) => {
        if (cancelled) return
        if (pressing.current) {
          idleRX.set(0)
          idleRY.set(0)
          raf = requestAnimationFrame(frame)
          return
        }
        const t = ((now - t0) / IDLE_ORBIT_MS) * Math.PI * 2
        idleRX.set(Math.sin(t) * IDLE_TILT)
        idleRY.set(Math.cos(t) * IDLE_TILT)
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
    }, 420)

    return () => {
      cancelled = true
      window.clearTimeout(startTimer)
      cancelAnimationFrame(raf)
      idleRX.set(0)
      idleRY.set(0)
    }
  }, [interactive, reduceMotion, idleRX, idleRY])

  const finishClose = useCallback(() => {
    flyAnimRef.current?.stop()
    flyAnimRef.current = null
    // Snap exact dock pose, then reveal peek (avoids a settle pop on handoff)
    const pose = dockPose.current
    if (pose) {
      flyX.set(pose.x)
      flyY.set(pose.y)
      flyRotate.set(pose.rotate)
      flyScale.set(pose.dockScale)
      cardW.set(pose.riseW)
      cardRatio.set(pose.ratio)
    }
    backdropOp.set(0)
    flipX.set(0)
    idleRX.set(0)
    idleRY.set(0)
    resetTilt()
    setPeekHover(false)
    peekBobY.set(0)
    setMode('peek')
    setPhase('ready')
    pullKind.current = null
    dockPose.current = null
  }, [
    backdropOp,
    flyX,
    flyY,
    flyRotate,
    flyScale,
    cardW,
    cardRatio,
    flipX,
    idleRX,
    idleRY,
    peekBobY,
    resetTilt,
  ])

  const measureDockPose = useCallback((): DockPose => {
    const focusW = flipped ? backWidth() : frontWidth()
    const ratio = flipped ? BACK_RATIO : FRONT_RATIO
    const rotate = flipped ? 0 : 90
    const peek = peekFootprintRef.current?.getBoundingClientRect()
    if (peek && peek.width > 1 && peek.height > 1) {
      // Keep natural face width; match peek with scale (+ rotate for front).
      // Animating width to peek size was squishing faces after dock/reopen.
      const visualW = flipped
        ? focusW
        : focusW / FRONT_RATIO /* landscape height → visual width when rotated */
      const dockScale = peek.width / Math.max(visualW, 1)
      return {
        x: peek.left + peek.width / 2 - window.innerWidth / 2,
        y: peek.top + peek.height / 2 - window.innerHeight / 2,
        riseW: focusW,
        finalW: focusW,
        rotate,
        dockScale,
        ratio,
      }
    }

    const frame = document.querySelector('.app-frame')
    if (!frame) {
      const { h } = viewSize()
      return {
        x: 0,
        y: h * 0.35,
        riseW: focusW,
        finalW: focusW,
        rotate,
        dockScale: 1,
        ratio,
      }
    }
    const fr = frame.getBoundingClientRect()
    const peekW = peekSlotWidth()
    const peekH = peekW / BACK_RATIO
    const top = fr.bottom - PEEK_PX
    const visualW = flipped ? focusW : focusW / FRONT_RATIO
    const dockScale = peekW / Math.max(visualW, 1)
    return {
      x: fr.left + fr.width / 2 - window.innerWidth / 2,
      y: top + peekH / 2 - window.innerHeight / 2,
      riseW: focusW,
      finalW: focusW,
      rotate,
      dockScale,
      ratio,
    }
  }, [flipped])

  const applyPose = useCallback(
    (pose: DockPose, t: number) => {
      flyX.set(lerp(pose.x, 0, t))
      flyY.set(lerp(pose.y, 0, t))
      flyRotate.set(lerp(pose.rotate, 0, t))
      flyScale.set(lerp(pose.dockScale, 1, t))
      cardW.set(lerp(pose.riseW, pose.finalW, t))
      cardRatio.set(pose.ratio)
      backdropOp.set(t)
    },
    [flyX, flyY, flyRotate, flyScale, cardW, cardRatio, backdropOp],
  )

  const animateToPose = useCallback(
    async (pose: DockPose, t: number, onDone?: () => void) => {
      flyAnimRef.current?.stop()
      cardRatio.set(pose.ratio)
      const spring = reduceMotion ? { duration: 0 } : dockSpring
      const fade = reduceMotion ? { duration: 0 } : dockFade
      const endX = lerp(pose.x, 0, t)
      const endY = lerp(pose.y, 0, t)
      const endR = lerp(pose.rotate, 0, t)
      const endS = lerp(pose.dockScale, 1, t)
      const endW = lerp(pose.riseW, pose.finalW, t)
      // Spring overshoot on motion; width/opacity stay clean
      const ctrls = [
        animate(flyX, endX, spring),
        animate(flyY, endY, spring),
        animate(flyRotate, endR, { ...spring, bounce: 0.08 }),
        animate(flyScale, endS, { ...spring, bounce: 0.09 }),
        animate(cardW, endW, fade),
        animate(backdropOp, t, fade),
      ]
      flyAnimRef.current = {
        stop: () => ctrls.forEach((c) => c.stop()),
      }
      await Promise.all(ctrls)
      flyX.set(endX)
      flyY.set(endY)
      flyRotate.set(endR)
      flyScale.set(endS)
      cardW.set(endW)
      backdropOp.set(t)
      flyAnimRef.current = null
      onDone?.()
    },
    [
      flyX,
      flyY,
      flyRotate,
      flyScale,
      cardW,
      cardRatio,
      backdropOp,
      reduceMotion,
    ],
  )

  const dismiss = useCallback(() => {
    if (!focused || closing || scrubbing) return
    clearTimers()
    flipAnimRef.current?.stop()
    flipAnimRef.current = null
    setFlipping(false)
    setPeekHover(false)
    flipX.set(0)
    resetTilt()

    if (reduceMotion) {
      finishClose()
      return
    }

    const pose = measureDockPose()
    dockPose.current = pose
    setPhase('closing')
    void animateToPose(pose, 0, finishClose)
  }, [
    focused,
    closing,
    scrubbing,
    reduceMotion,
    resetTilt,
    finishClose,
    measureDockPose,
    animateToPose,
    flipX,
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

  const updateOpenScrub = useCallback(
    (clientY: number) => {
      const start = pointerStart.current
      const pose = dockPose.current
      if (!start || !pose) return
      const travel = Math.max(120, Math.abs(pose.y) * 0.85)
      applyPose(pose, clamp01((start.y - clientY) / travel))
    },
    [applyPose],
  )

  const updateCloseScrub = useCallback(
    (clientY: number) => {
      const start = pointerStart.current
      const pose = dockPose.current
      if (!start || !pose) return
      const travel = Math.max(120, Math.abs(pose.y) * 0.85)
      applyPose(pose, clamp01(1 - (clientY - start.y) / travel))
    },
    [applyPose],
  )

  const finishOpenScrub = useCallback(
    (clientY: number) => {
      if (pullKind.current !== 'open') return
      pullKind.current = null

      const start = pointerStart.current
      const pose = dockPose.current
      if (!pose) {
        finishClose()
        return
      }
      const dt = Math.max(1, performance.now() - (start?.t ?? performance.now()))
      const dy = (start?.y ?? clientY) - clientY
      const velocity = (dy / dt) * 1000
      const t = backdropOp.get()
      const commit = t >= PULL_COMMIT || velocity > PULL_VELOCITY

      if (commit) {
        setPhase('opening')
        void animateToPose(pose, 1, () => {
          setPhase('ready')
        })
      } else {
        setPhase('closing')
        void animateToPose(pose, 0, finishClose)
      }
    },
    [animateToPose, backdropOp, finishClose],
  )

  const finishCloseScrub = useCallback(
    (clientY: number) => {
      // Idempotent — card pointerup and window listener may both fire
      if (pullKind.current !== 'close') return
      pullKind.current = null

      const start = pointerStart.current
      const pose = dockPose.current
      if (!pose) {
        setPhase('ready')
        return
      }
      const dt = Math.max(1, performance.now() - (start?.t ?? performance.now()))
      const dy = clientY - (start?.y ?? clientY)
      const velocity = (dy / dt) * 1000
      const t = backdropOp.get()
      const commit = t <= 1 - PULL_COMMIT || velocity > PULL_VELOCITY

      if (commit) {
        setPhase('closing')
        void animateToPose(pose, 0, finishClose)
      } else {
        setPhase('opening')
        void animateToPose(pose, 1, () => {
          setPhase('ready')
        })
      }
    },
    [animateToPose, backdropOp, finishClose],
  )

  const beginOpenScrub = useCallback(
    (clientX: number, clientY: number) => {
      if (mode === 'focus' || pullKind.current === 'open') return
      const pose = measureDockPose()
      dockPose.current = pose
      pullKind.current = 'open'
      didPull.current = true
      flipY.set(flipped ? 180 : 0)
      flipX.set(0)
      cardRatio.set(pose.ratio)
      applyPose(pose, 0)
      setPeekHover(false)
      setHasOpenedOnce(true)
      setPhase('scrubbing')
      setMode('focus')
      pointerStart.current = {
        x: clientX,
        y: clientY,
        ox: 0.5,
        oy: 0.5,
        t: performance.now(),
      }
    },
    [mode, measureDockPose, applyPose, flipped, flipY, flipX, cardRatio],
  )

  const beginCloseScrub = useCallback(() => {
    if (pullKind.current) return
    if (phaseRef.current !== 'ready' || flippingRef.current) return
    const pose = measureDockPose()
    dockPose.current = pose
    pullKind.current = 'close'
    didPull.current = true
    resetTilt()
    setPhase('scrubbing')
  }, [measureDockPose, resetTilt])

  // Just below COMPONENT LIBRARY → swipe up to pull open (full width)
  useEffect(() => {
    if (focused || reduceMotion) return

    let tracking = false
    let startX = 0
    let startY = 0

    const onDown = (e: PointerEvent) => {
      if (pullKind.current) return
      const target = e.target as Element | null
      // Keep links + face tappable; everything else below the text can pull up
      if (target?.closest('a, .face-link')) return
      if (e.clientY < openSwipeMinY()) return
      tracking = true
      startX = e.clientX
      startY = e.clientY
    }

    const onMove = (e: PointerEvent) => {
      if (!tracking) return
      if (pullKind.current === 'open') {
        updateOpenScrub(e.clientY)
        e.preventDefault()
        return
      }
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (dy < -AXIS_LOCK && Math.abs(dy) > Math.abs(dx)) {
        tracking = false
        beginOpenScrub(startX, startY)
        updateOpenScrub(e.clientY)
        e.preventDefault()
      }
    }

    const onUp = (e: PointerEvent) => {
      tracking = false
      // Finish even if React hasn't committed `scrubbing` yet
      if (pullKind.current === 'open') {
        finishOpenScrub(e.clientY)
        pointerStart.current = null
        pressing.current = false
        axisLock.current = null
      }
    }

    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [
    focused,
    reduceMotion,
    beginOpenScrub,
    updateOpenScrub,
    finishOpenScrub,
  ])

  // Focused: empty space above or below the card (full width) → swipe down to dock
  useEffect(() => {
    if (!focused || reduceMotion) return

    let tracking = false
    let startX = 0
    let startY = 0
    let startedBelow = false

    const cardRect = () => focusFootprintRef.current?.getBoundingClientRect()

    const onDown = (e: PointerEvent) => {
      if (pullKind.current) return
      if (phaseRef.current !== 'ready' || flippingRef.current) return
      const target = e.target as Element | null
      if (target?.closest('a, .face-link')) return
      const rect = cardRect()
      const top = rect?.top ?? Infinity
      const bottom = rect?.bottom ?? -Infinity
      const above = e.clientY < top
      const below = e.clientY > bottom
      if (!above && !below) return

      tracking = true
      startedBelow = below
      startX = e.clientX
      startY = e.clientY
    }

    const onMove = (e: PointerEvent) => {
      if (pullKind.current === 'close') {
        updateCloseScrub(e.clientY)
        e.preventDefault()
        return
      }
      if (!tracking) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (dy > AXIS_LOCK && Math.abs(dy) > Math.abs(dx) * 0.85) {
        tracking = false
        pointerStart.current = {
          x: startX,
          y: startY,
          ox: 0.5,
          oy: startedBelow ? 1.35 : -0.35,
          t: performance.now(),
        }
        pressing.current = true
        didPull.current = true
        axisLock.current = 'v'
        beginCloseScrub()
        updateCloseScrub(e.clientY)
        e.preventDefault()
      }
    }

    const onUp = (e: PointerEvent) => {
      tracking = false
      if (pullKind.current === 'close') {
        finishCloseScrub(e.clientY)
        pressing.current = false
        pointerStart.current = null
        axisLock.current = null
      }
    }

    const opts = { capture: true } as const
    window.addEventListener('pointerdown', onDown, { ...opts, passive: true })
    window.addEventListener('pointermove', onMove, { ...opts, passive: false })
    window.addEventListener('pointerup', onUp, opts)
    window.addEventListener('pointercancel', onUp, opts)
    return () => {
      window.removeEventListener('pointerdown', onDown, opts)
      window.removeEventListener('pointermove', onMove, opts)
      window.removeEventListener('pointerup', onUp, opts)
      window.removeEventListener('pointercancel', onUp, opts)
    }
  }, [
    focused,
    reduceMotion,
    beginCloseScrub,
    updateCloseScrub,
    finishCloseScrub,
  ])

  // Scrub move/up while pulling
  useEffect(() => {
    if (!scrubbing) return

    const onMove = (e: PointerEvent) => {
      if (pullKind.current === 'open') updateOpenScrub(e.clientY)
      else if (pullKind.current === 'close') updateCloseScrub(e.clientY)
    }
    const onUp = (e: PointerEvent) => {
      if (pullKind.current === 'open') finishOpenScrub(e.clientY)
      else if (pullKind.current === 'close') finishCloseScrub(e.clientY)
      pointerStart.current = null
      pressing.current = false
      axisLock.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [
    scrubbing,
    updateOpenScrub,
    updateCloseScrub,
    finishOpenScrub,
    finishCloseScrub,
  ])

  const openFromPeek = useCallback(() => {
    clearTimers()
    const pose = measureDockPose()
    dockPose.current = pose
    cardRatio.set(pose.ratio)
    applyPose(pose, 0)
    setPeekHover(false)
    flipY.set(flipped ? 180 : 0)
    flipX.set(0)
    setHasOpenedOnce(true)
    setPhase('opening')
    setMode('focus')
    void animateToPose(pose, 1, () => setPhase('ready'))
  }, [
    measureDockPose,
    applyPose,
    flipped,
    flipY,
    flipX,
    cardRatio,
    animateToPose,
  ])

  const onPeekPointerDown = (e: ReactPointerEvent) => {
    if (focused) return
    pointerStart.current = {
      x: e.clientX,
      y: e.clientY,
      ox: 0.5,
      oy: 0.5,
      t: performance.now(),
    }
    pressing.current = true
    didPull.current = false
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPeekPointerMove = (e: ReactPointerEvent) => {
    if (!pressing.current || focused || !pointerStart.current) return
    if (pullKind.current === 'open') {
      updateOpenScrub(e.clientY)
      return
    }
    const dx = e.clientX - pointerStart.current.x
    const dy = e.clientY - pointerStart.current.y
    if (dy < -AXIS_LOCK && Math.abs(dy) > Math.abs(dx)) {
      beginOpenScrub(pointerStart.current.x, pointerStart.current.y)
      updateOpenScrub(e.clientY)
    }
  }

  const onPeekPointerUp = (e: ReactPointerEvent) => {
    pressing.current = false
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ok */
    }

    // Finish pull-open here so a fast flick isn't lost waiting on React state
    if (pullKind.current === 'open') {
      finishOpenScrub(e.clientY)
      pointerStart.current = null
      axisLock.current = null
      return
    }

    if (
      !focused &&
      !didPull.current &&
      pointerStart.current &&
      Math.hypot(
        e.clientX - pointerStart.current.x,
        e.clientY - pointerStart.current.y,
      ) < AXIS_LOCK
    ) {
      openFromPeek()
    }
    pointerStart.current = null
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!interactive) return
    pressing.current = true
    didMove.current = false
    didDragFlip.current = false
    didPull.current = false
    axisLock.current = null
    idleRX.set(0)
    idleRY.set(0)
    // Normalize against the visible card, not the padded hit box —
    // presses in the top padding get oy < 0 → dock zone.
    const card = focusFootprintRef.current?.getBoundingClientRect()
    const ox = card
      ? (e.clientX - card.left) / Math.max(card.width, 1)
      : 0.5
    const oy = card
      ? (e.clientY - card.top) / Math.max(card.height, 1)
      : 0.5
    pointerStart.current = {
      x: e.clientX,
      y: e.clientY,
      ox,
      oy,
      t: performance.now(),
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    applyTilt(e.clientX, e.clientY)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pressing.current || !pointerStart.current) return

    // Prefer pullKind ref — React `scrubbing` may lag one frame on mobile
    if (pullKind.current === 'close') {
      updateCloseScrub(e.clientY)
      return
    }

    if (phaseRef.current !== 'ready' || flippingRef.current) return

    const dx = e.clientX - pointerStart.current.x
    const dy = e.clientY - pointerStart.current.y
    const dist = Math.hypot(dx, dy)

    if (!axisLock.current && dist > AXIS_LOCK) {
      const vertical = Math.abs(dy) > Math.abs(dx) * 0.9
      const oy = pointerStart.current.oy
      // Top of card (and padding above): prefer dock even with mild diagonal
      const fromTop = oy < 0.45
      const fromDockZone = oy < DOCK_START_OY_MAX
      // Empty space / hit padding below the visual card → dock, not flip
      const fromBelow = oy > 1
      if (
        dy > 0 &&
        ((fromTop && dy > Math.abs(dx) * 0.75) ||
          (vertical && fromDockZone) ||
          (vertical && fromBelow))
      ) {
        axisLock.current = 'v'
        beginCloseScrub()
        updateCloseScrub(e.clientY)
        return
      }
      // Bottom edge (or sideways) → flip territory
      axisLock.current = 'h'
    }

    if (dist > AXIS_LOCK) didMove.current = true
    if (axisLock.current !== 'v') applyTilt(e.clientX, e.clientY)
  }

  const runFlip = async (ox: number, oy: number) => {
    const goingToBack = !flipped

    if (reduceMotion) {
      setFlipped(goingToBack)
      flipY.set(goingToBack ? 180 : 0)
      flipX.set(0)
      const endW = goingToBack ? backWidth() : frontWidth()
      cardW.set(endW)
      cardRatio.set(goingToBack ? BACK_RATIO : FRONT_RATIO)
      return
    }

    setFlipping(true)
    resetTilt()
    flipX.set(0)

    const cx = Math.min(1, Math.max(-1, (ox - 0.5) * 2))
    const cy = Math.min(1, Math.max(-1, (oy - 0.5) * 2))
    const yDir: 1 | -1 = cx >= 0 ? 1 : -1
    const xPeak = -cy * 64

    const startY = flipY.get()
    const endY = startY + yDir * 180
    const endW = goingToBack ? backWidth() : frontWidth()
    const endRatio = goingToBack ? BACK_RATIO : FRONT_RATIO
    let swapped = false

    const yAnim = animate(flipY, endY, {
      ...flipTween,
      onUpdate: (latest) => {
        const t = (latest - startY) / (endY - startY)
        if (!swapped && t >= 0.5) {
          swapped = true
          setFlipped(goingToBack)
          cardRatio.set(endRatio)
        }
      },
    })
    const xAnim = animate(flipX, [0, xPeak, 0], {
      ...flipTween,
      times: [0, 0.5, 1],
    })
    const wAnim = animate(cardW, endW, flipTween)

    flipAnimRef.current = {
      stop: () => {
        yAnim.stop()
        xAnim.stop()
        wAnim.stop()
      },
    }

    await Promise.all([yAnim, xAnim, wAnim])
    flipAnimRef.current = null
    flipY.set(goingToBack ? yDir * 180 : 0)
    flipX.set(0)
    cardW.set(endW)
    cardRatio.set(endRatio)
    setFlipping(false)
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    const start = pointerStart.current
    pressing.current = false
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ok */
    }

    // Finish dock scrub here so a fast flick isn't lost waiting on React state
    if (pullKind.current === 'close') {
      finishCloseScrub(e.clientY)
      pointerStart.current = null
      axisLock.current = null
      return
    }

    if (start && focused && phaseRef.current === 'ready' && !flippingRef.current) {
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      const dist = Math.hypot(dx, dy)
      const cardWpx = cardRef.current?.getBoundingClientRect().width ?? 320
      const threshold = Math.max(DRAG_FLIP_MIN, cardWpx * 0.14)

      if (axisLock.current !== 'v' && dist >= threshold) {
        didMove.current = true
        didDragFlip.current = true
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
    axisLock.current = null
  }

  const onPointerLeave = () => {
    if (!pressing.current) resetTilt()
  }

  const onCardClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (!focused) return
    if (
      !interactive ||
      didMove.current ||
      didDragFlip.current ||
      didPull.current
    )
      return

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

  const flying = opening || closing || scrubbing

  return (
    <>
      {focused && (
        <motion.button
          type="button"
          className="card-backdrop"
          aria-label="Dismiss business card"
          style={{ opacity: backdropOp }}
          transition={{ duration: 0 }}
          onPointerDown={(e) => {
            if (phaseRef.current !== 'ready' || flippingRef.current) return
            if (pullKind.current) return
            const card = focusFootprintRef.current?.getBoundingClientRect()
            const aboveCard = !!card && e.clientY < card.top
            const belowCard = !!card && e.clientY > card.bottom
            pointerStart.current = {
              x: e.clientX,
              y: e.clientY,
              ox: 0.5,
              oy: aboveCard ? -0.35 : belowCard ? 1.35 : 0.5,
              t: performance.now(),
            }
            pressing.current = true
            didPull.current = false
            axisLock.current = null
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!pressing.current || !pointerStart.current) return
            if (pullKind.current === 'close') {
              updateCloseScrub(e.clientY)
              return
            }
            if (phaseRef.current !== 'ready') return
            // Pull-to-dock when the gesture began in empty space above or below the card
            const offCard =
              pointerStart.current.oy < 0 || pointerStart.current.oy > 1
            if (!offCard) return
            const dx = e.clientX - pointerStart.current.x
            const dy = e.clientY - pointerStart.current.y
            if (dy > AXIS_LOCK && Math.abs(dy) > Math.abs(dx) * 0.85) {
              axisLock.current = 'v'
              didPull.current = true
              beginCloseScrub()
              updateCloseScrub(e.clientY)
            }
          }}
          onPointerUp={(e) => {
            try {
              ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
            } catch {
              /* ok */
            }
            if (pullKind.current === 'close') {
              finishCloseScrub(e.clientY)
              pressing.current = false
              pointerStart.current = null
              axisLock.current = null
              return
            }
            const start = pointerStart.current
            pressing.current = false
            pointerStart.current = null
            axisLock.current = null
            // Tap on backdrop (no pull) → dismiss
            if (
              start &&
              !didPull.current &&
              Math.hypot(e.clientX - start.x, e.clientY - start.y) < AXIS_LOCK
            ) {
              dismiss()
            }
          }}
          onPointerCancel={(e) => {
            try {
              ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
            } catch {
              /* ok */
            }
            if (pullKind.current === 'close') {
              finishCloseScrub(e.clientY)
            }
            pressing.current = false
            pointerStart.current = null
            axisLock.current = null
          }}
        />
      )}

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
          onPointerDown={onPeekPointerDown}
          onPointerMove={onPeekPointerMove}
          onPointerUp={onPeekPointerUp}
          onPointerCancel={onPeekPointerUp}
        >
          <motion.div
            className="card-tilt"
            style={{ width: '100%', y: peekBobY }}
          >
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
          </motion.div>
        </button>
      </div>

      {focused && (
        <div className="card-slot is-focus">
          <motion.div
            className="card-fly"
            style={{
              x: flyX,
              y: flyY,
              rotate: flyRotate,
              scale: flyScale,
            }}
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
                  style={{
                    width: cardW,
                    height: cardH,
                  }}
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
