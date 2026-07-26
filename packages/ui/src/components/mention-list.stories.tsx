import type { MentionCandidate } from '@yapm/ui/lib/mention-match'
import { MentionList } from './mention-list'
import { PresetGrid } from './story-presets'

export default {
  title: 'Mention list',
}

const TEAM: MentionCandidate[] = [
  { id: 'ada', name: 'Ada Lovelace', email: 'ada@yapm.dev', eligible: true },
  { id: 'bo', name: 'Bo Nguyen', email: 'bo@yapm.dev', eligible: true },
  { id: 'zoe', name: 'Zoë Chen', email: 'zoe@yapm.dev', eligible: true },
]

const WITH_UNAVAILABLE: MentionCandidate[] = [
  ...TEAM.slice(0, 1),
  {
    id: 'casey',
    name: 'Casey Stone',
    email: 'casey@yapm.dev',
    eligible: false,
    reason: "Not on this team — can't be mentioned here",
  },
]

function noop() {}

export function Default() {
  return (
    <PresetGrid>
      <MentionList id="story-default" items={TEAM} query="" activeIndex={0} onSelect={noop} />
    </PresetGrid>
  )
}

export function ActiveRowMovedDown() {
  return (
    <PresetGrid>
      <MentionList id="story-active" items={TEAM} query="o" activeIndex={1} onSelect={noop} />
    </PresetGrid>
  )
}

export function UnavailableName() {
  return (
    <PresetGrid>
      <MentionList
        id="story-unavailable"
        items={WITH_UNAVAILABLE}
        query="a"
        activeIndex={1}
        onSelect={noop}
      />
    </PresetGrid>
  )
}

export function NoMatch() {
  return (
    <PresetGrid>
      <MentionList id="story-empty" items={[]} query="dana" activeIndex={0} onSelect={noop} />
    </PresetGrid>
  )
}
