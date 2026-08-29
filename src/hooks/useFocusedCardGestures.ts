import { useGesture, type UserDragConfig } from '@use-gesture/react'
import { useMemo, useRef, type RefObject } from 'react'

export type CardGestureMode = 'none' | 'rotate' | 'dock'

/** Top portion of the card where swipe-down docks instead of rotating */
const DOCK_ZONE_OY_MAX = 0.35
const DOCK_MIN_PULL = 10

function isTopDockZone(oy: number) {
  return oy < DOCK_ZONE_OY_MAX || oy < 0
}

function wantsDockDown(mx: number, my: number, oy: number) {
  return (
    isTopDockZone(oy) &&
    my > DOCK_MIN_PULL &&
    my > Math.abs(mx) * 0.85
  )
}

type Options = {
  enabled: boolean
  targetRef: RefObject<HTMLElement | null>
  footprintRef: RefObject<HTMLElement | null>
  onPressStart: (coords: {
    x: number
    y: number
    ox: number
    oy: number
  }) => void
  onPressEnd: () => void
  onRotateStart: () => void
  onRotateDrag: (movementX: number, movementY: number) => void
  onRotateEnd: (velocityX: number) => void
  onDockStart: () => void
  onDockMove: (clientY: number) => void
  onDockEnd: (clientY: number) => void
}

/**
 * Focused card: free 2-axis 3D rotation. Swipe-down from the top docks.
 */
export function useFocusedCardGestures({
  enabled,
  targetRef,
  footprintRef,
  onPressStart,
  onPressEnd,
  onRotateStart,
  onRotateDrag,
  onRotateEnd,
  onDockStart,
  onDockMove,
  onDockEnd,
}: Options) {
  const mode = useRef<CardGestureMode>('none')
  const startOy = useRef(0.5)

  const dragConfig = useMemo<UserDragConfig>(
    () => ({
      filterTaps: true,
      threshold: 6,
      pointer: { touch: true },
    }),
    [],
  )

  useGesture(
    {
      onDragStart: ({ event }) => {
        if (!enabled) return
        mode.current = 'none'

        const card = footprintRef.current?.getBoundingClientRect()
        const e = event as PointerEvent
        const ox = card
          ? (e.clientX - card.left) / Math.max(card.width, 1)
          : 0.5
        startOy.current = card
          ? (e.clientY - card.top) / Math.max(card.height, 1)
          : 0.5
        onPressStart({
          x: e.clientX,
          y: e.clientY,
          ox,
          oy: startOy.current,
        })
      },
      onDrag: ({
        movement: [mx, my],
        event,
        active,
        intentional,
      }) => {
        if (!enabled || !active || !intentional) return

        const clientY = (event as PointerEvent).clientY
        const oy = startOy.current

        if (mode.current === 'none') {
          if (wantsDockDown(mx, my, oy)) {
            mode.current = 'dock'
            onDockStart()
            onDockMove(clientY)
            return
          }

          // Pulling down from the top edge — wait for dock, don't lock rotate yet
          if (isTopDockZone(oy) && my > 0 && my >= Math.abs(mx) * 0.7) {
            return
          }

          mode.current = 'rotate'
          onRotateStart()
          onRotateDrag(mx, my)
          return
        }

        if (mode.current === 'dock') {
          onDockMove(clientY)
        } else if (mode.current === 'rotate') {
          if (wantsDockDown(mx, my, oy)) {
            mode.current = 'dock'
            onDockStart()
            onDockMove(clientY)
            return
          }
          onRotateDrag(mx, my)
        }
      },
      onDragEnd: ({ event, velocity: [vx] }) => {
        const clientY = (event as PointerEvent).clientY

        if (mode.current === 'dock') {
          onDockEnd(clientY)
        } else if (mode.current === 'rotate') {
          onRotateEnd(vx * 1000)
        }

        mode.current = 'none'
        onPressEnd()
      },
    },
    {
      target: targetRef,
      drag: { ...dragConfig, enabled },
      eventOptions: { passive: false },
    },
  )
}
