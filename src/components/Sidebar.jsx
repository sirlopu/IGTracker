// src/components/Sidebar.jsx
import { useState } from 'react'
import s from './Sidebar.module.css'

const NAV = [
  { id: 'dashboard',  label: 'Dashboard',   icon: GridIcon },
  { id: 'scan',       label: 'Scan',        icon: ScanIcon },
  { id: 'compare',    label: 'Compare',     icon: DiffIcon },
  { id: 'relations',  label: 'Relations',   icon: PeopleIcon },
  { id: 'events',     label: 'Events',      icon: ActivityIcon },
]

export default function Sidebar({ accounts, activeAccount, activePage, onNavigate, onAddAccount, onSwitchAccount, onRemoveAccount, theme, onToggleTheme }) {
  const [showAccMenu, setShowAccMenu] = useState(false)

  return (
    <aside className={s.sidebar}>
      {/* Logo */}
      <div className={s.brand}>
        <img src="/logo.png" alt="IGTracker" className={s.brandMark} />
        <div className={s.brandText}>
          <span className={s.brandName}>IGTracker</span>
          <span className={s.brandTag}>Local · Private</span>
        </div>
      </div>

      {/* Account switcher */}
      <div className={s.accountWrap}>
        <button className={s.accountBtn} onClick={() => setShowAccMenu(v => !v)}>
          <div className={s.accountAvatar}>
            {activeAccount ? activeAccount.username.slice(0, 2).toUpperCase() : '??'}
          </div>
          <div className={s.accountInfo}>
            <span className={s.accountName}>
              {activeAccount ? `@${activeAccount.username}` : 'No account'}
            </span>
            <span className={s.accountSub}>
              {accounts.length} account{accounts.length !== 1 ? 's' : ''}
            </span>
          </div>
          <ChevronIcon className={showAccMenu ? s.rotated : ''} />
        </button>

        {showAccMenu && (
          <div className={s.accMenu}>
            {accounts.map(acc => (
              <div key={acc.id} className={s.accMenuItem}>
                <button
                  className={`${s.accSwitch} ${activeAccount?.id === acc.id ? s.active : ''}`}
                  onClick={() => { onSwitchAccount(acc); setShowAccMenu(false) }}
                >
                  <div className={s.miniAvatar}>{acc.username.slice(0, 2).toUpperCase()}</div>
                  @{acc.username}
                </button>
                <button className={s.accDelete} onClick={() => onRemoveAccount(acc.id)} title="Remove">
                  ×
                </button>
              </div>
            ))}
            <button className={s.addAccBtn} onClick={() => { onAddAccount(); setShowAccMenu(false) }}>
              <span>+</span> Add account
            </button>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className={s.nav}>
        {NAV.map(item => {
          const Icon = item.icon
          const isActive = activePage === item.id
          const disabled = !activeAccount && item.id !== 'dashboard'
          return (
            <button
              key={item.id}
              className={`${s.navItem} ${isActive ? s.navActive : ''} ${disabled ? s.navDisabled : ''}`}
              onClick={() => !disabled && onNavigate(item.id)}
            >
              <Icon />
              <span>{item.label}</span>
              {isActive && <div className={s.navActiveDot} />}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div className={s.footer}>
        <div className={s.footerNote}>
          <LockIcon />
          <span>All data stored locally</span>
        </div>
        <button className={s.themeToggle} onClick={onToggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </aside>
  )
}

// Icons
function IgIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
    </svg>
  )
}
function GridIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> }
function ScanIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9V5a2 2 0 012-2h4M3 15v4a2 2 0 002 2h4M15 3h4a2 2 0 012 2v4M15 21h4a2 2 0 002-2v-4"/><path d="M7 12h10"/></svg> }
function DiffIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="7" cy="12" r="4"/><circle cx="17" cy="12" r="4"/><path d="M11 12h2"/></svg> }
function PeopleIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg> }
function ActivityIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> }
function ChevronIcon({ className }) { return <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg> }
function LockIcon() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg> }
function SunIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> }
function MoonIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg> }
