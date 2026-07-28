import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const zero = vi.hoisted(() => ({
  rows: [] as unknown[],
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: () => [zero.rows, { type: 'complete' }],
}))

import { FilesSection, formatBytes } from './files-section'

const NAMES = new Map([['ada', 'Ada Lovelace']])

const ROW = {
  id: '019702c7-0000-7000-8000-000000000001',
  filename: 'stalled-sync.png',
  contentType: 'image/png',
  byteSize: 240_100,
  uploaderId: 'ada',
  createdAt: Date.now() - 90_000,
}

beforeEach(() => {
  zero.rows = [ROW]
})

test('sizes read the way a file manager writes them', () => {
  expect(formatBytes(0)).toBe('0 B')
  expect(formatBytes(999)).toBe('999 B')
  expect(formatBytes(1_500)).toBe('1.5 kB')
  expect(formatBytes(240_100)).toBe('240 kB')
  expect(formatBytes(3_400_000)).toBe('3.4 MB')
})

// Every control is named by the FILE it acts on. Nine rows of "Download" and "Remove" is a list a
// screen reader user cannot navigate, and the destructive one is the one that has to be unambiguous.
test('names the download and the remove control after the file itself', () => {
  render(<FilesSection issueId="i1" teamId="t1" canWrite userNames={NAMES} />)

  const download = screen.getByRole('link', { name: 'Download stalled-sync.png' })
  expect(download).toHaveAttribute('href', '/api/v1/files/019702c7-0000-7000-8000-000000000001')
  expect(download).toHaveAttribute('download', 'stalled-sync.png')
  expect(screen.getByRole('button', { name: 'Remove stalled-sync.png' })).toBeInTheDocument()
  expect(screen.getByText(/240 kB · Ada Lovelace/)).toBeInTheDocument()
})

// A viewer reads everything and writes nothing — here as everywhere else. The download stays,
// because reading is what a viewer is for.
test('a viewer gets the download and no remove affordance', () => {
  render(<FilesSection issueId="i1" teamId="t1" canWrite={false} userNames={NAMES} />)

  expect(screen.getByRole('link', { name: 'Download stalled-sync.png' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull()
})

// A non-member's `attachments.byIssue` is an empty result — the scoping itself is proven by
// `queries.attachments.pg.test.ts` against real Postgres, so this asserts only what the UI does
// with the empty answer: says so quietly rather than showing a broken list.
test('an empty result is a quiet line, with an upload control only for a writer', () => {
  zero.rows = []
  const { rerender } = render(
    <FilesSection issueId="i1" teamId="t1" canWrite={false} userNames={NAMES} />,
  )
  expect(screen.getByText('No files yet.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull()

  rerender(<FilesSection issueId="i1" teamId="t1" canWrite userNames={NAMES} />)
  expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument()
})
