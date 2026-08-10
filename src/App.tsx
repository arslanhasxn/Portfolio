import { ArrowIcon } from './components/ArrowIcon'
import { BusinessCard } from './components/BusinessCard'
import faceUrl from './assets/face.png'

const PROJECTS = [
  { label: 'AURA.AWIROS.COM', href: 'https://aura.awiros.com' },
  { label: 'COMPONENT LIBRARY', href: 'https://aura.awiros.com' },
] as const

export default function App() {
  return (
    <div className="app-shell">
      <div className="app-frame">
        <div className="app-grid">
          <div className="cell cell-face">
            <img src={faceUrl} alt="" className="face-icon" />
          </div>

          <header className="cell cell-brand">
            <h1 className="brand">
              ARSLAN
              <br />
              HASAN
            </h1>
          </header>

          <nav className="cell cell-projects" aria-label="Projects">
            {PROJECTS.map((project) => (
              <a
                key={project.label}
                className="project-link"
                href={project.href}
                target="_blank"
                rel="noreferrer"
              >
                <span>{project.label}</span>
                <ArrowIcon />
              </a>
            ))}
          </nav>
        </div>

        <BusinessCard />
      </div>
    </div>
  )
}
