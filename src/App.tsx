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
            <a
              href="https://app.notion.com/p/arslanhasan/1e18f8ed024980a98a0ecea2da666b41?v=1e18f8ed02498190a750000c9b4c249b&source=copy_link"
              target="_blank"
              rel="noreferrer"
              aria-label="Open Notion"
              className="face-link"
            >
              <img src={faceUrl} alt="" className="face-icon" />
            </a>
          </div>

          <header className="cell cell-brand">
            <h1 className="brand">ARSLAN HASAN</h1>
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
