// SettingsModal must not let a failed or pending settings read overwrite the
// stored path. basePath falls back to the query, so before the read lands it is
// still '' -- guarding Save on the SAVE mutation being in flight alone leaves
// that window open.
import { useLayoutEffect } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SettingsModal from '../apps/spec-builder/components/SettingsModal'
import { specApi } from '../apps/spec-builder/api'

function renderModal() {
  // retry:false so an isError state is reached immediately rather than after the
  // default retry schedule.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const setErr = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <SettingsModal onClose={() => {}} setErr={setErr} />
    </QueryClientProvider>,
  )
  return { setErr }
}

const saveButton = () => screen.getByRole('button', { name: /save/i })

describe('SettingsModal save guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('disables Save while the settings read is still pending', () => {
    // A promise that never settles: the read is in flight for the whole test.
    vi.spyOn(specApi, 'getSettings').mockReturnValue(new Promise(() => {}) as never)
    renderModal()
    expect(saveButton()).toBeDisabled()
  })

  it('keeps Save disabled after the settings read fails, and reports why', async () => {
    vi.spyOn(specApi, 'getSettings').mockRejectedValue(new Error('settings unavailable'))
    const saveSpy = vi.spyOn(specApi, 'saveSettings')
    const { setErr } = renderModal()

    await waitFor(() => expect(saveButton()).toBeDisabled())
    // The failure is surfaced, so the disabled control is not unexplained.
    await waitFor(() => expect(setErr).toHaveBeenCalledWith('settings unavailable'))
    // And the destructive write never becomes reachable.
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('enables Save once the read lands, with the stored path seeded', async () => {
    vi.spyOn(specApi, 'getSettings').mockResolvedValue({ base_path: '/srv/specs' })
    renderModal()

    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(screen.getByDisplayValue('/srv/specs')).toBeInTheDocument()
  })

  it('enables Save and shows the stored path in the SAME commit', () => {
    // The two have to land together, not one commit apart. A buffer seeded by a
    // passive effect trails the read by a commit: the commit that delivers the
    // data un-disables Save while the field is still '', so a click inside that
    // window writes '' over the configured path -- the overwrite the guard above
    // exists to prevent. It is also what makes the assertion above order-
    // dependent, since whether the seeding commit beats testing-library's drain
    // turn is up to the event loop. A layout effect reads the first commit,
    // ahead of any passive effect that would paper over the gap.
    vi.spyOn(specApi, 'getSettings').mockResolvedValue({ base_path: '/srv/specs' })
    // Seeded cache: the real path in, e.g., reopening the modal after a save.
    // staleTime keeps the read from refetching, so the FIRST commit is the only
    // one under test.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    qc.setQueryData(['spec-builder', 'settings'], { base_path: '/srv/specs' })

    let firstCommit: { value: string; saveEnabled: boolean } | undefined
    function CommitProbe() {
      useLayoutEffect(() => {
        const field = document.getElementById('sb-base-path') as HTMLInputElement
        firstCommit = { value: field.value, saveEnabled: !(saveButton() as HTMLButtonElement).disabled }
      }, [])
      return null
    }
    render(
      <QueryClientProvider client={qc}>
        <SettingsModal onClose={() => {}} setErr={vi.fn()} />
        <CommitProbe />
      </QueryClientProvider>,
    )

    expect(firstCommit).toEqual({ value: '/srv/specs', saveEnabled: true })
  })
})
