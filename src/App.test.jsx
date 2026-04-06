import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./pages/ConnectPage', () => ({
  default: ({ onAdd, dbError }) => (
    <div>
      <div>Connect page</div>
      <div>dbError:{String(dbError)}</div>
      <button onClick={() => onAdd('new_user')}>submit connect</button>
    </div>
  ),
}))

vi.mock('./pages/DashboardPage', () => ({
  default: ({ account }) => <div>Dashboard page for @{account.username}</div>,
}))

vi.mock('./pages/ScanPage', () => ({
  default: () => <div>Scan page</div>,
}))

vi.mock('./pages/ComparePage', () => ({
  default: () => <div>Compare page</div>,
}))

vi.mock('./pages/RelationsPage', () => ({
  default: () => <div>Relations page</div>,
}))

vi.mock('./pages/EventsPage', () => ({
  default: () => <div>Events page</div>,
}))

vi.mock('./components/Sidebar', () => ({
  default: ({
    accounts,
    activeAccount,
    activePage,
    onAddAccount,
    onToggleTheme,
  }) => (
    <div>
      <div>Sidebar account count: {accounts.length}</div>
      <div>Sidebar active account: {activeAccount ? activeAccount.username : 'none'}</div>
      <div>Sidebar active page: {activePage}</div>
      <button onClick={onAddAccount}>open connect</button>
      <button onClick={onToggleTheme}>toggle theme</button>
    </div>
  ),
}))

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    window.api = {
      accounts: {
        list: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loads the first account and opens the dashboard', async () => {
    window.api.accounts.list.mockResolvedValue([{ id: 1, username: 'alice' }])

    render(<App />)

    expect(await screen.findByText('Dashboard page for @alice')).toBeInTheDocument()
    expect(screen.getByText('Sidebar account count: 1')).toBeInTheDocument()
    expect(screen.getByText('Sidebar active page: dashboard')).toBeInTheDocument()
  })

  it('surfaces database load failures on the connect page', async () => {
    window.api.accounts.list.mockRejectedValue(new Error('db unavailable'))

    render(<App />)

    expect(await screen.findByText('Connect page')).toBeInTheDocument()
    expect(screen.getByText('dbError:true')).toBeInTheDocument()
  })

  it('adds an account and persists theme changes', async () => {
    const user = userEvent.setup()
    window.api.accounts.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 3, username: 'new_user' }])
    window.api.accounts.create.mockResolvedValue({ id: 3, username: 'new_user' })

    render(<App />)

    expect(await screen.findByText('Connect page')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'submit connect' }))

    expect(await screen.findByText('Dashboard page for @new_user')).toBeInTheDocument()
    expect(window.api.accounts.create).toHaveBeenCalledWith('new_user')

    await user.click(screen.getByRole('button', { name: 'toggle theme' }))

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    })
    expect(localStorage.getItem('theme')).toBe('light')
  })
})
