import { ArrowIcon } from './components/ArrowIcon'
import { BusinessCard } from './components/BusinessCard'
import facesUrl from './assets/faces.png'

const SOCIALS = [
  { label: 'BEHANCE', href: 'https://www.behance.net/arslanhasan' },
  { label: 'TWITTER', href: 'https://x.com/arslanhasxn' },
  { label: 'LINKEDIN', href: 'https://www.linkedin.com/in/arslanhasxn/' },
] as const

const PROJECTS = [
  { label: 'AURA.AWIROS.COM', href: 'https://aura.awiros.com' },
  {
    label: 'COMPONENT LIBRARY',
    href: 'https://www.figma.com/design/oAT7cm8cnkCKCKjI4S105V/Component-Library?node-id=0-1&t=PEem2Vp4DsZWzCfP-1',
  },
] as const

export default function App() {
  return (
    <div className="app-shell">
      <div className="app-frame">
        <div className="app-grid">
          <a
            className="cell cell-faces face-link"
            href="https://app.notion.com/p/arslanhasan/1e18f8ed024980a98a0ecea2da666b41?v=1e18f8ed02498190a750000c9b4c249b&source=copy_link"
            target="_blank"
            rel="noreferrer"
            aria-label="Open Notion"
          >
            <img src={facesUrl} alt="" className="face-icon" />
          </a>

          <header className="cell cell-brand">
            <h1 className="brand">ARSLAN HASAN</h1>
            <nav className="socials" aria-label="Social">
              {SOCIALS.map((social) => (
                <a
                  key={social.label}
                  className="social-link"
                  href={social.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {social.label}
                </a>
              ))}
              <a className="social-link" href="mailto:arslanhasxn@gmail.com">
                ARSLANHASXN
                <span className="email-domain">
                  <span className="at-mark">@</span>GMAIL.COM
                </span>
              </a>
            </nav>
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
