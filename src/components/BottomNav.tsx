// Bottom nav for phone-width viewports — thumb reach on a device held in
// one hand (M9's own-phone self-service is the real phone use case). Above
// the 768px breakpoint in index.css, SideRail replaces this for the station
// tablet, which is reached with a whole arm, not a thumb. Kept to the
// handful of screens used every shift; everything else (equipment,
// templates, quarantine, tickets, the small logs) lives under "More"
// (docs/07-M2-CHECKLISTS.md) rather than crowding a 10+ item bottom bar.
import { NavLink } from 'react-router-dom'

const linkClass = ({ isActive }: { isActive: boolean }) => `bottom-nav__item ${isActive ? 'bottom-nav__item--active' : ''}`

export function BottomNav() {
  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={linkClass}>
        Home
      </NavLink>
      <NavLink to="/time/clock" className={linkClass}>
        Clock
      </NavLink>
      <NavLink to="/coldchain/readings" className={linkClass}>
        Readings
      </NavLink>
      <NavLink to="/checklists" className={linkClass}>
        Checklists
      </NavLink>
      <NavLink to="/coldchain" className={linkClass}>
        Status
      </NavLink>
      <NavLink to="/exceptions" className={linkClass}>
        Exceptions
      </NavLink>
      <NavLink to="/more" className={linkClass}>
        More
      </NavLink>
    </nav>
  )
}
