import { Button, Layout } from './layout.js'
import type { RenderedMessage } from './message.js'
import { renderMessage } from './render.js'
import { palette } from './theme.js'
import { absoluteUrl } from './url.js'

// A LINK, AND NOTHING ELSE — the load-bearing decision of this template rather than a property
// somebody has to notice was preserved.
//
// A mailed artifact sits outside the kill switch, outside retention and outside the audit log at the
// same time. An admin who sets the kill switch stops every further read in yapm and cannot reach an
// inbox; retention deletes rows in Postgres, not messages in a mail store; the audit log records
// what yapm disclosed and has no way to record what a mail relay forwarded. Each of the three
// governance mechanisms the product promises is defeated by a body that carries the content.
//
// The enforcement is the TYPE, not the markup: `PmDigestReadyInput` has no field capable of carrying
// a summary, a highlight, a risk flag or an evidence label, so this template cannot render one even
// by mistake — the same shape `DisclosureAuditDetail` uses. A reader who is no longer entitled
// follows the link into an absent surface, because the read predicate is evaluated at read time.

export interface PmDigestReadyInput {
  readonly publicUrl: string
  // yapm-computed metadata, both already disclosed by the act of publishing to this reader.
  readonly teamName: string
  readonly cycleName: string
}

const DIGESTS_PATH = '/digests'

export function pmDigestReadySubject(input: {
  readonly teamName: string
  readonly cycleName: string
}): string {
  return `${input.teamName} — ${input.cycleName} cycle digest is ready`
}

export function PmDigestReady({ publicUrl, teamName, cycleName }: PmDigestReadyInput) {
  const digestsUrl = absoluteUrl(publicUrl, DIGESTS_PATH)
  return (
    <Layout
      footer="You are receiving this because a workspace admin named you as a reader of this team's cycle digests. To change what yapm emails you, open yapm and use Appearance settings."
      heading={pmDigestReadySubject({ teamName, cycleName })}
      preview={pmDigestReadySubject({ teamName, cycleName })}
    >
      <p style={{ margin: '0 0 20px', color: palette.text2 }}>
        {teamName} released their digest for {cycleName}. It is readable in yapm — this message
        carries a link only, never the digest itself.
      </p>
      <Button href={digestsUrl} label="Open the digest" />
      <p style={{ margin: '20px 0 0', color: palette.text3, fontSize: '12px' }}>
        Or paste this link into your browser: {digestsUrl}
      </p>
    </Layout>
  )
}

export function renderPmDigestReady(input: PmDigestReadyInput): Promise<RenderedMessage> {
  return renderMessage(pmDigestReadySubject(input), <PmDigestReady {...input} />)
}
