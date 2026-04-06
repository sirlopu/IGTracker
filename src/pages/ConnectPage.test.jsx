import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ConnectPage from './ConnectPage'

describe('ConnectPage', () => {
  it('validates blank usernames before calling onAdd', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()

    render(<ConnectPage onAdd={onAdd} dbError={false} />)

    await user.click(screen.getByRole('button', { name: /add account/i }))

    expect(screen.getByText('Enter your Instagram username.')).toBeInTheDocument()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('trims whitespace and strips a leading @ before submitting', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn().mockResolvedValue(undefined)

    render(<ConnectPage onAdd={onAdd} dbError={false} />)

    await user.type(screen.getByRole('textbox'), '  @demo_user  ')
    await user.click(screen.getByRole('button', { name: /add account/i }))

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('demo_user')
    })
  })

  it('shows the thrown error message when add fails', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn().mockRejectedValue(new Error('Username not found'))

    render(<ConnectPage onAdd={onAdd} dbError={false} />)

    await user.type(screen.getByRole('textbox'), 'demo_user')
    await user.click(screen.getByRole('button', { name: /add account/i }))

    expect(await screen.findByText('Username not found')).toBeInTheDocument()
  })
})
