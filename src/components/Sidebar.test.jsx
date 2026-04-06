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

  it('keeps the remove button usable for long usernames', async () => {
    const user = userEvent.setup()
    const onRemoveAccount = vi.fn()

    renderSidebar({
      accounts: [
        { id: 1, username: 'codeninjaschinohills' },
        { id: 2, username: 'gabesbestlife' },
      ],
      activeAccount: { id: 1, username: 'codeninjaschinohills' },
      onRemoveAccount,
    })

    await user.click(screen.getByRole('button', { name: /@codeninjaschinohills/i }))
    await user.click(screen.getAllByTitle('Remove')[0])

    expect(onRemoveAccount).toHaveBeenCalledWith(1)
  })

  it('shows the full username as a tooltip when it is truncated', async () => {
    const user = userEvent.setup()

    renderSidebar({
      accounts: [{ id: 1, username: 'codeninjaschinohills' }],
      activeAccount: { id: 1, username: 'codeninjaschinohills' },
    })

    expect(screen.getByText('@codeninjaschinohills')).toHaveAttribute('title', '@codeninjaschinohills')

    await user.click(screen.getByRole('button', { name: /@codeninjaschinohills/i }))

    expect(screen.getAllByTitle('@codeninjaschinohills')).toHaveLength(2)
  })
})
