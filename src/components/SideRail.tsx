// Tablet-width companion to BottomNav (docs/01-ARCHITECTURE.md — the tablet
// is mid-range Android; a portrait tablet is comfortably wider than a phone,
// so a fixed side rail replaces the bottom bar above the 768px breakpoint
// in index.css). Same destinations as BottomNav, same "everything else
// lives under More" rule (docs/07-M2-CHECKLISTS.md) — this is a second
// presentation of one nav model, not a second information architecture.
import { NavLink } from 'react-router-dom'

const linkClass = ({ isActive }: { isActive: boolean }) => `side-rail__item ${isActive ? 'side-rail__item--active' : ''}`

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </svg>
  )
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  )
}
function ThermometerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13.5V4a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0Z" />
    </svg>
  )
}
function ChecklistIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 9l2 2 4-4M8 16h6" />
    </svg>
  )
}
function GaugeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19a8 8 0 1 1 16 0" />
      <path d="M12 12l3-4" />
    </svg>
  )
}
function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.3 3.9L2.7 18a1.8 1.8 0 0 0 1.5 2.7h15.6a1.8 1.8 0 0 0 1.5-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  )
}
function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  )
}

export function SideRail() {
  return (
    <nav className="side-rail" aria-label="Main">
      <div className="side-rail__mark" aria-hidden="true" />
      <NavLink to="/" end className={linkClass}>
        <HomeIcon />
        Home
      </NavLink>
      <NavLink to="/time/clock" className={linkClass}>
        <ClockIcon />
        Clock
      </NavLink>
      <NavLink to="/coldchain/readings" className={linkClass}>
        <ThermometerIcon />
        Readings
      </NavLink>
      <NavLink to="/checklists" className={linkClass}>
        <ChecklistIcon />
        Checklists
      </NavLink>
      <NavLink to="/coldchain" className={linkClass}>
        <GaugeIcon />
        Status
      </NavLink>
      <NavLink to="/exceptions" className={linkClass}>
        <AlertIcon />
        Exceptions
      </NavLink>
      <NavLink to="/more" className={linkClass}>
        <MoreIcon />
        More
      </NavLink>
    </nav>
  )
}
