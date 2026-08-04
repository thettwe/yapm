import type { StoredPmDigestContent } from '@yapm/schema'
import { Badge } from '@yapm/ui/components/badge'
import { cn } from '@yapm/ui/lib/utils'
import { PM_ITEM_KIND_LABEL, pmEvidenceLabels, pmSubjectLine } from '@/pm-digest/model'

// ONE renderer, two audiences. The producing team's review card and the reader's own surface draw
// the same component from the same row, which is what makes "the team is the first reader" true
// rather than approximately true: there is no second render that could show them different text.
export function PmDigestNarrative({
  content,
  headingLevel = 'h3',
}: {
  content: StoredPmDigestContent
  headingLevel?: 'h2' | 'h3'
}) {
  const subject = pmSubjectLine(content)
  const Heading = headingLevel

  return (
    <div className="flex flex-col gap-4" data-testid="pm-digest-narrative">
      {subject !== null ? (
        <Heading
          className="font-heading text-sm font-semibold tracking-tight text-text-1"
          data-testid="pm-digest-subject"
        >
          {subject}
        </Heading>
      ) : null}

      {content.headline.trim().length > 0 ? (
        <p className="text-sm text-text-1" data-testid="pm-digest-headline">
          {content.headline}
        </p>
      ) : null}

      {content.sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
            {section.title}
          </span>
          <ul className="flex flex-col gap-2">
            {section.items.map((item, itemIndex) => {
              const labels = pmEvidenceLabels(item.evidenceRefs, content.evidenceLabels)
              return (
                <li
                  key={`${section.title}-${itemIndex}`}
                  className="flex flex-col gap-1.5 rounded-control bg-bg-sidebar/60 px-3 py-2"
                  data-testid="pm-digest-item"
                >
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="mt-0.5 shrink-0">
                      {PM_ITEM_KIND_LABEL[item.kind]}
                    </Badge>
                    <span className="min-w-0 flex-1 text-[13px] text-text-1">{item.summary}</span>
                    <PmConfidence confidence={item.confidence} />
                  </div>
                  {labels.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pl-1">
                      {labels.map((label) => (
                        <span
                          key={label}
                          className="inline-flex items-center rounded-control bg-bg-hover px-1.5 py-0.5 font-mono text-[11px] text-text-2"
                          data-testid="pm-digest-evidence"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function PmConfidence({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  if (confidence === 'high') return null
  return (
    <span
      className={cn(
        'shrink-0 text-[11px]',
        confidence === 'low' ? 'text-status-urgent' : 'text-text-3',
      )}
    >
      {confidence === 'low' ? 'possible' : 'medium confidence'}
    </span>
  )
}
