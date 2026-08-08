import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
import { ADMIN, ensureAccount, stop } from './support'

// ONE spec, for the two things no other tier can see.
//
// PROCESS §3's big-feature rule puts this change at 2 of 4 — a shared mutator (`sanitizeRichText`
// gained the stamp and the image-attribute hardening) and signature UI (the editor) — so all three
// tiers apply. The unit tier owns the truth tables; the integration tier owns the search projection.
// What is left here is what needs a REAL browser:
//
//   * ProseMirror's key pipeline. `prosemirror-view` prevents the default of every Escape whether or
//     not anything handled it, and Base UI's dismissal layer reads neither the prevented flag nor
//     the event's origin. jsdom has neither, so only this tier can say whether Escape on an open
//     insert menu dismisses the menu and nothing else. `mentions.spec.ts` found two real defects at
//     exactly this seam; a second suggestion plugin is the thing that could regress it.
//   * `Tab` inside a table. `goToNextCell` competes with the browser's own focus traversal, and
//     which wins is a fact about a real event loop.
//   * The upload pipe end to end: the platform file chooser the insert menu opens, a real multipart
//     body over HTTP, `sharp` decoding real bytes, and the node the editor then writes carrying an
//     OPAQUE id whose path the renderer computes.
//
// What this does NOT cover, said plainly rather than implied (`attachments` §I10): the runtime
// Docker image, its named `files` volume and its uid-1001 user. This harness runs the server on the
// host under `tsx`. The image is the compose smoke job's ground.

const ISSUE_ROW = '[data-testid="issue-row"]'
const DESCRIPTION = '[role="textbox"][aria-label="Issue description"]'

const DRAFT = 'the reconnect backoff needs an owner'

// A real 1x1 PNG, so `sharp` genuinely decodes it and the thumbnail leg means something. The
// filename is load-bearing: the editor derives the alt text from it, which is what makes the image
// findable in search and announceable to a screen reader.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const FILENAME = 'crash-on-login.png'
const EXPECTED_ALT = 'crash on login'

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function randomKey(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let key = ''
  for (let i = 0; i < 4; i += 1) key += letters[Math.floor(Math.random() * letters.length)]
  return key
}

async function enterApp(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
}

async function openTeamIssues(page: Page): Promise<void> {
  const teamName = unique('Rich Content')
  await page.getByTestId('create-team').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(teamName)
  await dialog.getByLabel('Key').fill(randomKey())
  await dialog.getByRole('button', { name: 'Create team' }).click()
  const teamLink = page.getByRole('link', { name: new RegExp(teamName) })
  await expect(teamLink).toBeVisible({ timeout: 20_000 })
  await teamLink.click()
  await stop(page, 'Issues').click()
  await expect(page.getByRole('button', { name: 'New issue' })).toBeVisible({ timeout: 20_000 })
}

async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New issue' }).click()
  const input = page.getByLabel('New issue title')
  await expect(input).toBeFocused()
  await input.fill(title)
  await page.keyboard.press('Enter')
  const row = page.locator(ISSUE_ROW).filter({ hasText: title })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).not.toHaveAttribute('data-pending', '', { timeout: 20_000 })
}

async function openIssueDetail(page: Page, title: string) {
  const row = page.locator(ISSUE_ROW).filter({ hasText: title })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('dialog', { name: 'Issue detail' })
  await expect(panel).toBeVisible({ timeout: 20_000 })
  return panel
}

test.describe('rich content', () => {
  test('the insert menu, a table and Escape are all operable from the keyboard', async ({
    page,
  }) => {
    test.slow()
    await enterApp(page)
    await openTeamIssues(page)
    const title = unique('Insert menu')
    await createIssue(page, title)
    const panel = await openIssueDetail(page, title)

    // The one pointer event in the test, and only to place the caret. Everything after this is
    // keys — which is the claim.
    const description = panel.locator(DESCRIPTION)
    await description.click()
    await page.keyboard.type(`${DRAFT} `)

    // 1. `/` opens the menu, in the editor, with the full command list.
    await page.keyboard.type('/')
    const menu = page.getByRole('listbox', { name: 'Insert a block' })
    await expect(menu).toBeVisible({ timeout: 20_000 })
    await expect(description).toHaveAttribute('aria-expanded', 'true')
    await expect(menu.getByRole('option')).toHaveCount(9)

    // 2. THE ESCAPE CONTRACT. The menu goes; the draft, the trigger text and the panel all stay.
    // This is the assertion a second suggestion plugin could regress — the wrapper stands down on
    // the IDENTITY of the event it consumed, never on `defaultPrevented`, because ProseMirror
    // prevents the default of every Escape on its way past.
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden({ timeout: 10_000 })
    await expect(description).toContainText(DRAFT)
    await expect(panel).toBeVisible()
    await expect(description).toHaveAttribute('aria-expanded', 'false')

    // 3. Filter and insert. A dismissed suggestion stays dismissed for its own range, so this types
    // a fresh trigger rather than reviving the one Escape just closed.
    await page.keyboard.type(' /tabl')
    await expect(menu).toBeVisible({ timeout: 20_000 })
    const options = menu.getByRole('option')
    await expect(options).toHaveCount(1)
    await expect(options.first()).toHaveText(/Table/)
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden({ timeout: 10_000 })

    const table = description.locator('table')
    await expect(table).toBeVisible({ timeout: 10_000 })
    // A header row and three columns, from the one command — and the trigger text is gone, deleted
    // in the same transaction that inserted the table.
    await expect(table.locator('th')).toHaveCount(3)
    await expect(description).not.toContainText('/tabl')

    // 4. Tab moves between cells rather than out of the editor. `goToNextCell` has to beat the
    // browser's own focus traversal, which is the part jsdom cannot arbitrate.
    await page.keyboard.type('alpha')
    await page.keyboard.press('Tab')
    await page.keyboard.type('beta')
    await expect(table.locator('th').nth(0)).toHaveText('alpha')
    await expect(table.locator('th').nth(1)).toHaveText('beta')
    // Focus never left the editable — a Tab that escaped would have moved it to the next control.
    await expect(description).toBeFocused()

    // 5. It survived the write. The description autosaves through the same `issue.update` mutator
    // that now stamps a schema version, so a reload proves the table reached Postgres AND parses
    // back out of it — which is the whole point of the stamp existing. The wait is the 500 ms
    // autosave debounce plus the push: a reload before it fires would be testing the timer.
    await page.waitForTimeout(1500)
    await page.reload()
    // The panel is a search param (`?open=<id>`), so the reload lands straight back in it.
    const reopened = page.getByRole('dialog', { name: 'Issue detail' })
    await expect(reopened).toBeVisible({ timeout: 20_000 })
    await expect(reopened.locator(DESCRIPTION).locator('table th').nth(0)).toHaveText('alpha', {
      timeout: 20_000,
    })
    await expect(reopened.locator(DESCRIPTION)).toContainText(DRAFT)
  })

  // BOTH popups in ONE surface, which is the pairing no unit test reaches: `mentions.spec.ts` proves
  // the `@` contract and `slash-menu.test.tsx` proves the `/` one, and neither can say what happens
  // when the same editor owns two suggestion plugins with two plugin keys. The comment composer is
  // the right surface for it because it has no cancel of its own — so the third leg, Escape with
  // nothing open, is genuinely destructive, and that is what makes the first two non-vacuous.
  test('Escape dismisses only the popup that is open, whichever of the two it is', async ({
    page,
  }) => {
    test.slow()
    await enterApp(page)
    await openTeamIssues(page)
    const title = unique('Two popups')
    await createIssue(page, title)
    const panel = await openIssueDetail(page, title)

    const composer = panel.getByRole('textbox', { name: 'Add a comment' })
    await composer.click()
    await page.keyboard.type(`${DRAFT} `)

    // The mention list opens even with nobody to offer — the author is never in their own list, so
    // this workspace of one has an empty roster — and that is enough, because what is under test is
    // the key rather than the roster. It is read through `aria-expanded` and the empty-state copy,
    // NOT through the listbox: with zero options the `<ul>` has no box and Playwright rightly calls
    // it hidden. `mentions.spec.ts` owns the populated case.
    //
    // `exact: true` is load-bearing: the popup's copy also reaches the editor's persistent polite
    // status region, which appends a full stop. Without it the locator matches both and Playwright
    // refuses in strict mode.
    const emptyRoster = page.getByText('No teammates to mention', { exact: true })
    await page.keyboard.type('@')
    await expect(composer).toHaveAttribute('aria-expanded', 'true', { timeout: 20_000 })
    await expect(emptyRoster).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await expect(composer).toHaveAttribute('aria-expanded', 'false', { timeout: 10_000 })
    await expect(emptyRoster).toHaveCount(0)
    await expect(composer).toContainText(DRAFT)
    await expect(panel).toBeVisible()

    await page.keyboard.type(' /')
    const blocks = page.getByRole('listbox', { name: 'Insert a block' })
    await expect(blocks).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('Escape')
    await expect(blocks).toBeHidden({ timeout: 10_000 })
    await expect(composer).toContainText(DRAFT)
    await expect(panel).toBeVisible()

    // THE CONTROL. With no popup open the very same key reaches the surface holding the composer and
    // dismisses it. Without this, both assertions above could hold against an Escape that does
    // nothing anywhere.
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden({ timeout: 10_000 })
  })

  test('an image uploaded from the insert menu lands in the document and in the Files section', async ({
    page,
  }) => {
    test.slow()
    await enterApp(page)
    await openTeamIssues(page)
    const title = unique('Image upload')
    await createIssue(page, title)
    const panel = await openIssueDetail(page, title)

    await expect(panel.getByText('No files yet.')).toBeVisible({ timeout: 20_000 })

    const description = panel.locator(DESCRIPTION)
    await description.click()
    await page.keyboard.type('/imag')
    const menu = page.getByRole('listbox', { name: 'Insert a block' })
    await expect(menu).toBeVisible({ timeout: 20_000 })
    await expect(menu.getByRole('option').first()).toHaveText(/Image/)

    // Enter on the Image row opens the platform file chooser. Nothing enters the document while the
    // bytes are in flight — the placeholder is a decoration — so the node appearing at all is proof
    // the POST succeeded.
    const chooserPromise = page.waitForEvent('filechooser')
    const uploadPromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/api/v1/files'),
    )
    await page.keyboard.press('Enter')
    const chooser = await chooserPromise
    await chooser.setFiles({ name: FILENAME, mimeType: 'image/png', buffer: PNG })
    expect((await uploadPromise).status()).toBe(201)

    // The node, with its alt text derived from the filename — the only words this image contributes
    // to the search index and the only thing a screen reader can announce about it.
    const image = description.locator('[data-testid="rich-text-image"]')
    await expect(image).toBeVisible({ timeout: 20_000 })
    await expect(image).toHaveAttribute('aria-label', `Image: ${EXPECTED_ALT}`)

    // THE ASSERTION THE WHOLE STORAGE DESIGN IS ABOUT. The rendered `src` is a path this client
    // COMPUTED from an opaque id; nothing fetchable was stored in the document. A signed URL, an
    // absolute origin or a `blob:` here would be a bearer capability replicated into every
    // teammate's IndexedDB.
    const src = await image.locator('img').getAttribute('src')
    expect(src).toMatch(/^\/api\/v1\/files\/[^/?#]+$/)
    const bytes = await page.request.get(src ?? '')
    expect(bytes.status()).toBe(200)
    expect(Buffer.compare(await bytes.body(), PNG)).toBe(0)

    // The same upload is a row in the Files section, because a file is a DATABASE ROW and the image
    // node only names it. The operator's GC sweep and the backup story both assume this list is
    // everything, so an editor upload the section could not see would break both.
    await expect(panel.getByText('No files yet.')).toHaveCount(0, { timeout: 20_000 })
    const download = panel.getByRole('link', { name: `Download ${FILENAME}` })
    await expect(download).toBeVisible({ timeout: 20_000 })
    await expect(download).toHaveAttribute('href', src ?? '')
  })
})
