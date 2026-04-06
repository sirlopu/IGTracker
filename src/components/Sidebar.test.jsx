import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Sidebar from './Sidebar'

function renderSidebar(props = {}) {
  const defaultProps = {
    accounts: [
      { id: 1, username: 'alice' },
      { id: 2, username: 'bob' },
    ],
    activeAccount: { id: 1, username: 'alice' },
    activePage: 'dashboard',
    onNavigate: vi.fn(),
    onAddAccount: vi.fn(),
    onSwitchAccount: vi.fn(),
    onRemoveAccount: vi.fn(),
    theme: 'dark',
    onToggleTheme: vi.fn(),
    logoUrl: '/logo.png',
  }

  return render(<Sidebar {...defaultProps} {...props} />)
}

describe('Sidebar', () => {
  it('opens the account menu and switches accounts', async () => {
    const user = userEvent.setup()
    const onSwitchAccount = vi.fn()

    renderSidebar({ onSwitchAccount })

    await user.click(screen.getByRole('button', { name: /@alice/i }))
    await user.click(screen.getByRole('button', { name: /@bob/i }))

    expect(onSwitchAccount).toHaveBeenCalledWith({ id: 2, username: 'bob' })
  })

  it('does not navigate to protected pages when no account is active', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()

    renderSidebar({
      accounts: [],
      activeAccount: null,
      onNavigate,
    })

    await user.click(screen.getByRole('button', { name: /scan/i }))

    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('forwards theme toggle clicks', async () => {
    const user = userEvent.setup()
    const onToggleTheme = vi.fn()

    renderSidebar({ onToggleTheme, theme: 'dark' })

    await user.click(screen.getByTitle('Switch to light mode'))

    expect(onToggleTheme).toHaveBeenCalledTimes(1)
  })
})
