import { SNIPPET_STOP_DELIMITER as E, SNIPPET_START_DELIMITER as S } from '@yapm/schema/search'
import { SearchResultRow } from './search-result-row'
import { SnippetText } from './snippet-text'
import { PresetGrid } from './story-presets'

export default {
  title: 'Search result row',
}

const SNIPPET = `…the ${S}replica${E} resync is the cost nobody wants, so the ${S}replica${E} stays untouched…`

// The delimiters are control characters; a snippet whose text also contains angle brackets proves
// the renderer treats its input as text rather than as markup.
const MARKUP_SNIPPET = `<script>alert('x')</script> and a ${S}match${E} after it`

export function Default() {
  return (
    <PresetGrid>
      <div className="flex flex-col rounded-card border border-border bg-bg-elevated py-1">
        <SearchResultRow kind="issue" issueKey="ENG-142" title="Replica resync on upgrade" />
        <SearchResultRow kind="project" title="Self-hosting hardening" />
        <SearchResultRow kind="team" title="Platform" />
      </div>
    </PresetGrid>
  )
}

export function ActiveRow() {
  return (
    <PresetGrid>
      <div className="flex flex-col rounded-card border border-border bg-bg-elevated py-1">
        <SearchResultRow kind="issue" issueKey="ENG-142" title="Replica resync on upgrade" />
        <SearchResultRow kind="cycle" title="Cycle 12" active />
        <SearchResultRow kind="label" title="infrastructure" />
      </div>
    </PresetGrid>
  )
}

export function WithSnippet() {
  return (
    <PresetGrid>
      <div className="flex flex-col rounded-card border border-border bg-bg-elevated py-1">
        <SearchResultRow
          kind="comment"
          issueKey="ENG-142"
          title="Replica resync on upgrade"
          snippet={SNIPPET}
        />
        <SearchResultRow
          kind="comment"
          issueKey="ENG-143"
          title="Publication changes force a resync"
          snippet={SNIPPET}
          active
        />
      </div>
    </PresetGrid>
  )
}

export function StateLabelled() {
  return (
    <PresetGrid>
      <div className="flex flex-col rounded-card border border-border bg-bg-elevated py-1">
        <SearchResultRow
          kind="issue"
          issueKey="ENG-201"
          title="Incoming from the connector"
          states={['triage']}
        />
        <SearchResultRow
          kind="issue"
          issueKey="ENG-88"
          title="Drop the pg_trgm extension"
          states={['canceled']}
        />
        <SearchResultRow
          kind="issue"
          issueKey="ENG-89"
          title="Both at once, on the active row"
          snippet={SNIPPET}
          states={['triage', 'canceled']}
          active
        />
      </div>
    </PresetGrid>
  )
}

export function SnippetSafety() {
  return (
    <PresetGrid>
      <div className="flex flex-col gap-2 rounded-card border border-border bg-bg-elevated p-3">
        <SnippetText text={MARKUP_SNIPPET} />
        <SnippetText text="No delimiters at all — plain prose renders unchanged." />
        <SnippetText text={`Unbalanced ${S}start with no stop degrades to plain text.`} />
      </div>
    </PresetGrid>
  )
}
