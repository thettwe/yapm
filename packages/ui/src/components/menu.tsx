import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { cn } from '@yapm/ui/lib/utils'

const Menu = MenuPrimitive.Root
const MenuTrigger = MenuPrimitive.Trigger

function MenuContent({ className, children, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner sideOffset={4} className="z-50 outline-none">
        <MenuPrimitive.Popup
          className={cn(
            'bg-popover text-popover-foreground min-w-48 origin-[var(--transform-origin)] rounded-lg border p-1 shadow-md transition-all data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 outline-none',
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      className={cn(
        'data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none',
        className,
      )}
      {...props}
    />
  )
}

// The current page, when it is reached from a menu rather than from a bar: weight plus a 2px accent
// rule down the leading edge, the same pair the deck's active stop uses. The INK stays `--text-1`
// (which the popup already carries) for the reason `deck.tsx` records — `--accent-strong` on this
// surface misses AA in one preset — so the accent is only ever the non-text rule, which answers to
// 3:1 and is measured in `styles/contrast.test.ts`. Marking it for assistive tech alone would draw
// the current destination exactly like the three it sits beside.
//
// A row has TWO grounds, and the marking is drawn on both. Highlighted — hovered or arrowed onto —
// the row's fill IS `--accent`, so an accent rule on it measures 1:1 and the marking disappears at
// exactly the moment the reader is pointing at it, while `--text-1` on that fill measures 2.53–4.08
// and the weight is all that is left. Both step to `--on-accent` there, in a compound variant so the
// cascade decides by specificity rather than by which utility Tailwind happened to emit last. Both
// grounds are measured in `styles/contrast.test.ts`.
function MenuLinkItem({ className, ...props }: MenuPrimitive.LinkItem.Props) {
  return (
    <MenuPrimitive.LinkItem
      className={cn(
        'data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline outline-none select-none',
        'aria-[current=page]:font-semibold aria-[current=page]:text-text-1 aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-1 aria-[current=page]:before:left-0 aria-[current=page]:before:w-0.5 aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-accent',
        'data-highlighted:aria-[current=page]:text-accent-foreground data-highlighted:aria-[current=page]:before:bg-accent-foreground',
        className,
      )}
      {...props}
    />
  )
}

function MenuGroupLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      className={cn('text-muted-foreground px-2 py-1.5 text-xs font-medium', className)}
      {...props}
    />
  )
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator className={cn('bg-border -mx-1 my-1 h-px', className)} {...props} />
  )
}

const MenuGroup = MenuPrimitive.Group

export {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuLinkItem,
  MenuSeparator,
  MenuTrigger,
}
