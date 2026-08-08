import type { RestPhrase } from '@yapm/schema'
import { ProvenanceMark } from '@yapm/ui/components/provenance-mark'
import { cn } from '@yapm/ui/lib/utils'

// The drawn half of the shared phrase dictionary. Whether a phrase speaks, whether it is urgent
// and whether it carries a provider's mark are all decided by the ENTRY — this renders that
// decision and makes none of its own, so two surfaces cannot disagree about the same fact.
//
// Returns null for a silent entry: a row with nothing true to say renders a genuinely empty slot.
export function RestPhraseText({
  phrase,
  className,
}: {
  phrase: RestPhrase | null | undefined
  className?: string
}) {
  if (!phrase || phrase.text === null) return null
  return (
    <span
      data-slot="rest-phrase"
      data-phrase-key={phrase.key}
      className={cn(
        'inline-flex items-center gap-1.5 truncate',
        phrase.urgent ? 'font-semibold text-status-urgent-ink' : 'text-text-2',
        className,
      )}
    >
      {phrase.text}
      {phrase.source === null ? null : (
        // A source suffix, after the fact it sourced, at 12px — never replacing a status arc or a
        // track node. It names itself ("GitHub"), because no phrase in either register names the
        // provider, and it keeps its own neutral `text-text-2`: an urgent phrase carries urgency in
        // its weight and ink, and a brand mark that took the urgent ink would be stating the fact
        // twice in a colour the brand does not own.
        <ProvenanceMark provider={phrase.source} size={12} />
      )}
    </span>
  )
}
