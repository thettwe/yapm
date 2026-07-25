import { afterEach, describe, expect, it } from 'vitest'
import { ownsKeyboard } from '@/lib/keyboard'

// The attribute names are Base UI's, read out of @base-ui/react 1.6: a popup carries `data-open`
// while it is open and `data-closed` + `data-ending-style` for the whole exit transition, during
// which it is still mounted and still holds focus.
function popup(state: 'open' | 'closing', role = 'dialog'): HTMLElement {
  const element = document.createElement('div')
  element.setAttribute('role', role)
  if (state === 'open') element.setAttribute('data-open', '')
  else {
    element.setAttribute('data-closed', '')
    element.setAttribute('data-ending-style', '')
  }
  document.body.append(element)
  return element
}

function inputIn(parent: HTMLElement): HTMLInputElement {
  const input = document.createElement('input')
  parent.append(input)
  return input
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('ownsKeyboard', () => {
  it('gives the keyboard to a field, a textarea, a select and a contenteditable', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const editable = document.createElement('div')
    // jsdom does not implement `isContentEditable`, so the browser's own answer is stubbed rather
    // than the branch going untested.
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    document.body.append(input, textarea, select, editable)

    expect(ownsKeyboard(input)).toBe(true)
    expect(ownsKeyboard(textarea)).toBe(true)
    expect(ownsKeyboard(select)).toBe(true)
    expect(ownsKeyboard(editable)).toBe(true)
  })

  it('gives the keyboard to an open dialog, listbox and combobox', () => {
    for (const role of ['dialog', 'listbox', 'combobox']) {
      const open = popup('open', role)
      expect(ownsKeyboard(open)).toBe(true)
      expect(ownsKeyboard(inputIn(open))).toBe(true)
    }
  })

  it('releases the keyboard for a popup that is animating out, input and all', () => {
    const closing = popup('closing')
    expect(ownsKeyboard(closing)).toBe(false)
    expect(ownsKeyboard(inputIn(closing))).toBe(false)
  })

  // cmdk gives the palette's input `role="combobox"` and its list `role="listbox"`, neither of which
  // carries any Base UI state — so the innermost popup ancestor cannot be the one that decides.
  it('releases the keyboard for the palette’s own combobox inside a closing dialog', () => {
    const closing = popup('closing')
    const list = document.createElement('div')
    list.setAttribute('role', 'listbox')
    const combobox = document.createElement('input')
    combobox.setAttribute('role', 'combobox')
    closing.append(list, combobox)

    expect(ownsKeyboard(combobox)).toBe(false)
    expect(ownsKeyboard(list)).toBe(false)
  })

  it('keeps an outer dialog in charge when a popup inside it is animating out', () => {
    const dialog = popup('open')
    const closing = document.createElement('div')
    closing.setAttribute('role', 'listbox')
    closing.setAttribute('data-closed', '')
    dialog.append(closing)

    expect(ownsKeyboard(inputIn(closing))).toBe(true)
  })

  it('treats a popup that signals no state at all as owning the keyboard', () => {
    const plain = document.createElement('div')
    plain.setAttribute('role', 'dialog')
    document.body.append(plain)

    expect(ownsKeyboard(inputIn(plain))).toBe(true)
  })

  it('leaves ordinary elements and a null target alone', () => {
    const button = document.createElement('button')
    document.body.append(button)

    expect(ownsKeyboard(button)).toBe(false)
    expect(ownsKeyboard(null)).toBe(false)
  })
})
