// Who owns the keyboard right now. Every view-level shortcut handler asks this before acting, so a
// single-letter key never hijacks a field, a native select, or an open dialog/listbox/combobox.
//
// The subtlety is the CLOSING popup. `CommandDialog` renders the palette as a Base UI
// `Dialog.Popup` with an exit transition, so for the ~150ms it animates out the popup is still in
// the DOM and still holds focus in its own input. Base UI marks exactly that window: the popup
// carries `data-ending-style` while it animates out (`TransitionStatusDataAttributes.endingStyle`,
// @base-ui/react 1.6) and its `data-open` has already flipped to `data-closed`
// (`popupStateMapping`). A dying popup must not swallow the next keystroke — a fast operator who
// runs a command and immediately presses the next key would silently lose it.
//
// A popup that signals neither is not a Base UI popup at all (cmdk's own combobox input and listbox
// are exactly that, nested inside the dialog), and carries no state of its own — so the decision is
// made by the OUTERMOST closing popup in the chain: everything inside one is out of the picture,
// while a popup further out that is still open (a listbox dying inside an open dialog) keeps the
// keyboard. With nothing closing anywhere, the nearest popup owns it, which is the safe default.
const POPUP_SELECTOR = '[role="dialog"], [role="listbox"], [role="combobox"]'
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isClosing(popup: Element): boolean {
  return popup.hasAttribute('data-ending-style') || popup.hasAttribute('data-closed')
}

export function ownsKeyboard(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null
  if (element === null) return false

  const chain: Element[] = []
  for (
    let popup = element.closest(POPUP_SELECTOR);
    popup !== null;
    popup = popup.parentElement?.closest(POPUP_SELECTOR) ?? null
  ) {
    chain.push(popup)
  }

  if (chain.length > 0) {
    let outermostClosing = -1
    for (const [index, popup] of chain.entries()) {
      if (isClosing(popup)) outermostClosing = index
    }
    // Anything further out than the outermost closing popup is, by construction, still open.
    return chain.length > outermostClosing + 1
  }

  if (element instanceof HTMLElement && element.isContentEditable) return true
  return EDITABLE_TAGS.has(element.tagName)
}
