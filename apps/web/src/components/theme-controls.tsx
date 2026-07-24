import { isParseableColor, THEME_PRESETS } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { Input } from '@yapm/ui/components/input'
import { Label } from '@yapm/ui/components/label'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@yapm/ui/components/popover'
import { Select } from '@yapm/ui/components/select'
import { PaletteIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTheme } from '@/theme/provider'
import type { Preset } from '@/theme/theme'

const PRESET_LABELS: Record<Preset, string> = {
  warm: 'Warm',
  focused: 'Focused',
  editorial: 'Editorial',
}

const HEX_FALLBACK = '#c15a38'

function isHex(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.test(value.trim())
}

export function ThemeControls() {
  const { theme, mode, accent, setTheme, setAccent, toggleMode } = useTheme()
  const [draft, setDraft] = useState(accent ?? '')

  useEffect(() => {
    setDraft(accent ?? '')
  }, [accent])

  function applyDraft() {
    const value = draft.trim()
    if (value === '') {
      setAccent(null)
      return
    }
    if (isParseableColor(value)) setAccent(value)
  }

  const draftInvalid = draft.trim() !== '' && !isParseableColor(draft.trim())

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Appearance settings">
            <PaletteIcon />
          </Button>
        }
      />
      <PopoverContent className="w-72">
        <PopoverTitle>Appearance</PopoverTitle>

        <div className="mt-3 flex flex-col gap-3">
          <Label className="flex-col items-start gap-1.5 text-xs text-text-2">
            Theme
            <Select
              value={theme}
              onChange={(event) => setTheme(event.currentTarget.value as Preset)}
            >
              {THEME_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {PRESET_LABELS[preset]}
                </option>
              ))}
            </Select>
          </Label>

          <div className="flex items-center justify-between">
            <span className="text-xs text-text-2">Mode</span>
            <Button variant="outline" size="sm" aria-pressed={mode === 'dark'} onClick={toggleMode}>
              {mode === 'dark' ? 'Dark' : 'Light'}
            </Button>
          </div>

          <Label className="flex-col items-start gap-1.5 text-xs text-text-2">
            Accent color
            <div className="flex w-full items-center gap-2">
              <input
                type="color"
                aria-label="Pick accent color"
                value={isHex(draft) ? draft : accent && isHex(accent) ? accent : HEX_FALLBACK}
                onChange={(event) => setAccent(event.currentTarget.value)}
                className="size-8 shrink-0 cursor-pointer rounded-control border border-border bg-transparent"
              />
              <Input
                value={draft}
                aria-label="Accent color value"
                placeholder="#c15a38"
                aria-invalid={draftInvalid}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    applyDraft()
                  }
                }}
              />
              <Button size="sm" onClick={applyDraft} disabled={draftInvalid}>
                Apply
              </Button>
            </div>
          </Label>

          {accent ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAccent(null)}
              className="self-start"
            >
              Reset to preset accent
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
