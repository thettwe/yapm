import type { RetroProposalCategory, RetroProposalVerdict } from '@yapm/schema'

// The product's words for the stored enums the AI draft carries. They live apart from the panel
// because the operator's verdict log renders the same values in a different surface, and a stored
// token printed raw (`follow_up`, `unrated`) is a schema detail leaking into copy — twice, in two
// files, drifting apart.

// Plural: these title a GROUP. The panel's four headings and the category chip on a ratified row.
export const RETRO_BUCKET_LABEL: Record<RetroProposalCategory, string> = {
  win: 'Wins',
  loss: 'Losses',
  improvement: 'Improvements',
  follow_up: 'Follow-ups',
}

// Singular: this names ONE proposal's stored category, which is what the verdict log reports.
export const RETRO_CATEGORY_LABEL: Record<RetroProposalCategory, string> = {
  win: 'Win',
  loss: 'Loss',
  improvement: 'Improvement',
  follow_up: 'Follow-up',
}

// `unrated` is the one that must never be printed raw: the team ratified and nobody responded, which
// is a sentence rather than a word.
export const RETRO_VERDICT_LABEL: Record<RetroProposalVerdict, string> = {
  agreed: 'Agreed',
  contested: 'Contested',
  rejected: 'Rejected',
  unrated: 'Nobody responded',
}
