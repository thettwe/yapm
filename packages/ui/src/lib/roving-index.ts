/**
 * The movement half of a typeahead's keyboard contract, kept pure so a popup's owner can call it
 * from a ProseMirror `handleKeyDown` — which must answer synchronously — and so a test can assert it
 * without a DOM. Returns `null` for a key the list does not own, which the caller reads as "not
 * ours, let the editor have it".
 *
 * THE ONLY THING THE MENTION LIST AND THE INSERT MENU SHARE. Everything else about them differs:
 * the mention list carries eligibility, rejection counts and "why not" copy that a command list has
 * no use for, and merging the two components would turn all of it into `undefined`-guarded
 * branches. Extracting the index arithmetic and nothing else is the whole of the sharing.
 */
export function nextRovingIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowUp':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
