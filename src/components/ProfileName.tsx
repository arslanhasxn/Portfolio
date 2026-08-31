import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import profilePicture from '../assets/profile-picture.webp'
import './ProfileName.css'

const CURSOR_OFFSET = 24

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(hover: none), (pointer: coarse)')
    const update = () => setCoarse(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return coarse
}

export function ProfileName() {
  const coarse = useCoarsePointer()
  const [hovering, setHovering] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const nameRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const img = new Image()
    img.src = profilePicture
  }, [])

  const showFloat = !coarse && hovering

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY })
  }, [])

  const onNameClick = useCallback(() => {
    if (coarse) setMobileOpen((open) => !open)
  }, [coarse])

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  return (
    <>
      <h1
        ref={nameRef}
        className="brand brand--interactive"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onMouseMove={onMouseMove}
        onClick={onNameClick}
        role={coarse ? 'button' : undefined}
        tabIndex={coarse ? 0 : undefined}
        onKeyDown={
          coarse
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setMobileOpen((open) => !open)
                }
              }
            : undefined
        }
        aria-expanded={coarse ? mobileOpen : undefined}
        aria-label={coarse ? 'Show profile picture' : undefined}
      >
        <span className="brand-shimmer">ARSLAN HASAN</span>
      </h1>

      {showFloat &&
        createPortal(
          <div
            className="profile-float"
            style={{
              left: pos.x + CURSOR_OFFSET,
              top: pos.y + CURSOR_OFFSET,
            }}
            aria-hidden
          >
            <img src={profilePicture} alt="" draggable={false} />
          </div>,
          document.body,
        )}

      {mobileOpen &&
        createPortal(
          <div
            className="profile-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Profile picture"
            onClick={() => setMobileOpen(false)}
          >
            <div
              className="profile-overlay__stack"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                className="profile-overlay__img"
                src={profilePicture}
                alt="Arslan Hasan"
                draggable={false}
              />
              <button
                type="button"
                className="profile-overlay__close"
                onClick={() => setMobileOpen(false)}
              >
                CLOSE
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
