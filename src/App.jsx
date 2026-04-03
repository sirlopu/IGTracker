// src/App.jsx
import { useState, useEffect } from 'react'
import logoUrl from './assets/logo.png'
import Sidebar from './components/Sidebar'
import ConnectPage from './pages/ConnectPage'
import DashboardPage from './pages/DashboardPage'
import ScanPage from './pages/ScanPage'
import ComparePage from './pages/ComparePage'
import RelationsPage from './pages/RelationsPage'
import EventsPage from './pages/EventsPage'
import styles from './App.module.css'

export default function App() {
  const [accounts, setAccounts] = useState([])
  const [activeAccount, setActiveAccount] = useState(null)
  const [page, setPage] = useState('connect') // connect | dashboard | scan | compare | relations | events
  const [loading, setLoading] = useState(true)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme(t => t === 'dark' ? 'light' : 'dark')
  }

  useEffect(() => {
    loadAccounts()
  }, [])

  async function loadAccounts() {
    try {
      const accs = await window.api.accounts.list()
      setAccounts(accs)
      if (accs.length > 0) {
        setActiveAccount(accs[0])
        setPage('dashboard')
      }
    } catch (e) {
      console.error('Failed to load accounts:', e)
    } finally {
      setLoading(false)
    }
  }

  async function addAccount(username) {
    const acc = await window.api.accounts.create(username)
    await loadAccounts()
    setActiveAccount(acc)
    setPage('dashboard')
  }

  async function removeAccount(id) {
    await window.api.accounts.delete(id)
    await loadAccounts()
    if (accounts.length <= 1) {
      setActiveAccount(null)
      setPage('connect')
    }
  }

  function switchAccount(acc) {
    setActiveAccount(acc)
    setPage('dashboard')
  }

  if (loading) {
    return (
      <div className={styles.splash}>
        <img src={logoUrl} alt="IGTracker" className={styles.splashLogo} />
      </div>
    )
  }

  const pageProps = { account: activeAccount, onNavigate: setPage }

  return (
    <div className={styles.app}>
      <Sidebar
        accounts={accounts}
        activeAccount={activeAccount}
        activePage={page}
        onNavigate={setPage}
        onAddAccount={() => setPage('connect')}
        onSwitchAccount={switchAccount}
        onRemoveAccount={removeAccount}
        theme={theme}
        onToggleTheme={toggleTheme}
        logoUrl={logoUrl}
      />
      <main className={styles.main}>
        {page === 'connect' && <ConnectPage onAdd={addAccount} />}
        {page === 'dashboard' && activeAccount && <DashboardPage {...pageProps} />}
        {page === 'scan' && activeAccount && <ScanPage {...pageProps} />}
        {page === 'compare' && activeAccount && <ComparePage {...pageProps} />}
        {page === 'relations' && activeAccount && <RelationsPage {...pageProps} />}
        {page === 'events' && activeAccount && <EventsPage {...pageProps} />}
      </main>
    </div>
  )
}

