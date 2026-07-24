import { Avatar, AvatarFallback, AvatarImage } from './avatar'
import { PresetGrid } from './story-presets'

export default {
  title: 'Avatar',
}

export function AllPresets() {
  return (
    <PresetGrid>
      <div className="flex items-center gap-3">
        <Avatar size="xs">
          <AvatarFallback aria-label="Ada Lovelace">AL</AvatarFallback>
        </Avatar>
        <Avatar size="sm">
          <AvatarFallback aria-label="Grace Hopper">GH</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback aria-label="Alan Turing">AT</AvatarFallback>
        </Avatar>
        <Avatar size="lg">
          <AvatarImage src="https://avatars.githubusercontent.com/u/9919?s=80" alt="Octocat" />
          <AvatarFallback aria-label="Octocat">OC</AvatarFallback>
        </Avatar>
      </div>
    </PresetGrid>
  )
}
