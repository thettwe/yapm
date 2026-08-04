import { useQuery } from '@rocicorp/zero/react'
import { queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { useCallback, useEffect, useId, useState } from 'react'
import { type PmDisclosurePatch, type PmDisclosurePolicy, updatePmDisclosure } from '@/settings/ai'
import { useSyncControl } from '@/zero/provider'

interface MemberData {
  id: string
  userId: string
  user?: { name?: string; email?: string } | undefined
}

function displayName(member: MemberData): string {
  return member.user?.name ?? member.user?.email ?? member.userId
}

const OFF_TEAM = { pmVisible: false, audience: [] as string[] }

// THE FOUR SWITCHES, all off until an admin turns them on, and the only place in the product where
// somebody chooses who reads another team's work. Two of them are workspace-wide and two are per
// team; all four have to agree before anything is readable, so any one of them is a complete stop.
export function PmDisclosureSection({
  policy,
  onChanged,
}: {
  policy: PmDisclosurePolicy
  onChanged: () => Promise<void>
}) {
  const headingId = useId()
  const { refresh } = useSyncControl()
  const [teams] = useQuery(queries.teams.all())
  const [members] = useQuery(queries.members.all())
  const [draft, setDraft] = useState(policy)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [announcement, setAnnouncement] = useState('')

  // The server owns this state; the draft only exists so a click lands instantly instead of after a
  // round trip. Every reload re-seeds it, so a rejected write reverts to what was actually stored.
  useEffect(() => setDraft(policy), [policy])

  const write = useCallback(
    async (patch: PmDisclosurePatch, next: PmDisclosurePolicy, message: string) => {
      setDraft(next)
      setBusy(true)
      setError(undefined)
      try {
        await updatePmDisclosure(patch)
        await onChanged()
        // The caller's OWN credential carries the audience the server baked into it, so an admin who
        // just named themselves needs it re-minted before the reader surface exists for them. The
        // provider documents this path for exactly this case.
        refresh()
        setAnnouncement(message)
      } catch {
        setError('Could not update product sharing.')
        setAnnouncement('')
        await onChanged()
      } finally {
        setBusy(false)
      }
    },
    [onChanged, refresh],
  )

  const teamPolicy = (teamId: string) => draft.teams[teamId] ?? OFF_TEAM

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-card border border-border p-4"
      data-testid="pm-disclosure-settings"
      data-enabled={draft.enabled ? 'true' : 'false'}
      data-killed={draft.killed ? 'true' : 'false'}
    >
      <header className="flex flex-col gap-1">
        <h2 id={headingId} className="font-heading text-base font-semibold text-text-1">
          Product digests
        </h2>
        <p className="text-sm text-text-2">
          Off for every team until you turn it on here. When a team has this on, closing one of its
          cycles asks the model for a second, product-facing summary of the same work — outcomes and
          product areas, no engineering internals, and no file paths or code. The team reads it
          first and shares it themselves; nobody outside the team can read it before they do.
          Nothing you set here can un-read something already read.
        </p>
      </header>

      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid="pm-disclosure-announcement"
      >
        {announcement}
      </p>

      {error !== undefined ? (
        <p className="text-sm text-status-urgent" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-control border border-border p-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-text-1">
            Product digests for this workspace
          </span>
          <span className="text-xs text-text-2">{draft.enabled ? 'On' : 'Off'}</span>
        </div>
        <Button
          size="sm"
          variant={draft.enabled ? 'outline' : 'default'}
          disabled={busy}
          data-testid="pm-disclosure-enabled"
          data-enabled={draft.enabled ? 'true' : 'false'}
          aria-label={`${draft.enabled ? 'Turn off' : 'Turn on'} product digests for this workspace, currently ${draft.enabled ? 'on' : 'off'}`}
          onClick={() =>
            void write(
              { enabled: !draft.enabled },
              { ...draft, enabled: !draft.enabled },
              `Product digests ${draft.enabled ? 'turned off' : 'turned on'} for this workspace.`,
            )
          }
        >
          {draft.enabled ? 'Turn off' : 'Turn on'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-control border border-border p-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-text-1">Stop all sharing</span>
          <span className="text-xs text-text-2">
            {draft.killed
              ? 'On — nobody outside a team can read anything, whatever else is set.'
              : 'Off'}
          </span>
          <span className="mt-1 text-xs text-text-3">
            This stops further reads. It does not un-read anything that has already been read.
          </span>
        </div>
        <Button
          size="sm"
          variant={draft.killed ? 'default' : 'outline'}
          disabled={busy}
          data-testid="pm-disclosure-killed"
          data-killed={draft.killed ? 'true' : 'false'}
          aria-label={`${draft.killed ? 'Allow sharing again' : 'Stop all sharing'}, currently ${draft.killed ? 'stopped' : 'allowed'}`}
          onClick={() =>
            void write(
              { killed: !draft.killed },
              { ...draft, killed: !draft.killed },
              draft.killed
                ? 'Sharing allowed again.'
                : 'All sharing stopped. Further reads are blocked.',
            )
          }
        >
          {draft.killed ? 'Allow sharing' : 'Stop sharing'}
        </Button>
      </div>

      {teams.length === 0 ? (
        <p className="text-[12.5px] text-text-2" data-testid="pm-disclosure-empty">
          No teams yet. Create a team to choose whether its cycle summaries are shared and who reads
          them.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {teams.map((team) => (
            <PmDisclosureTeamRow
              key={team.id}
              teamId={team.id}
              name={team.name}
              teamKey={team.key}
              policy={teamPolicy(team.id)}
              members={members as readonly MemberData[]}
              busy={busy}
              onWrite={(patch, nextTeam, message) =>
                write(patch, { ...draft, teams: { ...draft.teams, [team.id]: nextTeam } }, message)
              }
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function PmDisclosureTeamRow({
  teamId,
  name,
  teamKey,
  policy,
  members,
  busy,
  onWrite,
}: {
  teamId: string
  name: string
  teamKey: string
  policy: { pmVisible: boolean; audience: string[] }
  members: readonly MemberData[]
  busy: boolean
  onWrite: (
    patch: PmDisclosurePatch,
    nextTeam: { pmVisible: boolean; audience: string[] },
    message: string,
  ) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const readersId = useId()
  const audience = policy.audience

  function toggleVisible() {
    const pmVisible = !policy.pmVisible
    void onWrite(
      { teams: { [teamId]: { pmVisible } } },
      { ...policy, pmVisible },
      `Product digests ${pmVisible ? 'turned on' : 'turned off'} for ${name}.`,
    )
  }

  function toggleReader(userId: string, reads: boolean) {
    const next = reads ? [...audience, userId] : audience.filter((id) => id !== userId)
    void onWrite(
      { teams: { [teamId]: { audience: next } } },
      { ...policy, audience: next },
      `${next.length} ${next.length === 1 ? 'reader' : 'readers'} for ${name}.`,
    )
  }

  return (
    <li
      className="flex flex-col gap-2 rounded-control border border-border p-3"
      data-testid="pm-disclosure-team-row"
      data-team-key={teamKey}
      data-visible={policy.pmVisible ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-text-1">{name}</span>
          <span className="text-xs text-text-2">
            {policy.pmVisible ? 'On' : 'Off'} ·{' '}
            {audience.length === 1 ? '1 reader' : `${audience.length} readers`}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          aria-controls={readersId}
          data-testid="pm-disclosure-readers-toggle"
          onClick={() => setOpen((current) => !current)}
        >
          {open ? 'Hide readers' : 'Choose readers'}
        </Button>
        <Button
          size="sm"
          variant={policy.pmVisible ? 'outline' : 'default'}
          disabled={busy}
          data-testid="pm-disclosure-team-toggle"
          data-enabled={policy.pmVisible ? 'true' : 'false'}
          aria-label={`${policy.pmVisible ? 'Turn off' : 'Turn on'} product digests for ${name}, currently ${policy.pmVisible ? 'on' : 'off'}`}
          onClick={toggleVisible}
        >
          {policy.pmVisible ? 'Turn off' : 'Turn on'}
        </Button>
      </div>

      {open ? (
        <fieldset id={readersId} className="flex flex-col gap-1 border-none p-0">
          <legend className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            Who reads {name}'s product digests
          </legend>
          {members.length === 0 ? (
            <p className="text-xs text-text-2">No workspace members to choose from.</p>
          ) : (
            members.map((member) => {
              const reads = audience.includes(member.userId)
              return (
                <label
                  key={member.id}
                  className="flex items-center gap-2 rounded-control px-2 py-1 text-sm text-text-2 hover:bg-bg-hover"
                >
                  <input
                    type="checkbox"
                    checked={reads}
                    disabled={busy}
                    className="size-4 accent-accent outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    data-testid="pm-disclosure-reader"
                    data-user-id={member.userId}
                    onChange={(event) => toggleReader(member.userId, event.target.checked)}
                  />
                  <span className="min-w-0 truncate">{displayName(member)}</span>
                </label>
              )
            })
          )}
        </fieldset>
      ) : null}
    </li>
  )
}
