// One walker and one list, so the blamelessness guarantee cannot be proven at one entry point and
// quietly lost at another. CLAUDE.md #8 is team-level metrics ONLY, and `review.author` is a real
// GitHub login sitting in a synced table — a builder that passed a row through unchanged would leak
// it. This asserts the absence STRUCTURALLY, against the built object rather than the rendered
// string, so the guarantee survives a caption rewrite.
//
// The list only ever grows. `*Id` variants are here because an id is an identity dimension even when
// no name is attached: a UI could join it back to a person.
export const FORBIDDEN_IDENTITY_KEYS: readonly string[] = [
  'assignee',
  'assigneeId',
  'author',
  'authorId',
  'reviewer',
  'reviewerId',
  'creator',
  'creatorId',
  'voter',
  'voterId',
  'facilitator',
  'facilitatorId',
  'user',
  'userId',
  'user_id',
  'member',
  'login',
  'githubLogin',
  'email',
  'handle',
  'avatar',
  'image',
]

// Recursively collect every object key present in a value.
export function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key)
      collectKeys(child, keys)
    }
  }
  return keys
}
