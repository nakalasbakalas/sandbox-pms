# Command Palette - Sandbox Hotel PMS

## Overview

The Command Palette is a universal, keyboard-first navigation and action system for the Sandbox Hotel PMS. Inspired by modern development tools, it provides instant access to all major PMS functions without leaving the current screen.

## Features

### 🎯 Core Capabilities

- **Instant Access**: Press `⌘K` (Mac) or `Ctrl+K` (Windows/Linux) from anywhere
- **Fuzzy Search**: Type partial commands, descriptions, or keywords to find what you need
- **Keyboard Navigation**: Full keyboard support with arrow keys and Enter
- **Categorized Commands**: Organized by Navigation, Operations, Reservations, Housekeeping, Guests, Reports, and Settings
- **Visual Shortcuts**: See keyboard shortcuts for frequently-used commands
- **Smart Filtering**: Searches across command names, descriptions, and keywords
- **Coming Soon Badges**: Clear indicators for planned features

### 📋 Command Categories

#### Navigation (⌘1-6)
- Go to Room Board - `⌘1`
- Go to Front Desk - `⌘2`
- Go to Reservations - `⌘3`
- Go to Guests - `⌘4`
- Go to Housekeeping - `⌘5`
- Go to Cashier - `⌘6`
- Go to Reports - `⌘R`
- Go to Rates, Channels, Settings

#### Operations
- Search Rooms - `⌘F`
- Check In Guest - `⌘I`
- Check Out Guest - `⌘O`
- Move Guest - `⌘M`
- Add Charge - `⌘⇧C`
- View Today's Arrivals - `⌘A`
- View Today's Departures - `⌘D`
- Refresh Board - `⌘⇧R`

#### Reservations
- New Reservation - `⌘N`

#### Housekeeping
- Mark Room Clean
- Mark Room Dirty
- Mark Room Maintenance

#### Guests
- Search Guests - `⌘⇧F`
- New Guest Profile

#### Reports (Coming Soon)
- Occupancy Report
- Revenue Report

#### Settings (Coming Soon)
- Backup Data

## Technical Implementation

### Architecture

```
src/
├── types/
│   └── command-palette.ts      # TypeScript types and interfaces
├── hooks/
│   └── use-command-palette.ts  # React hook for palette state and keyboard handling
├── components/
│   └── CommandPalette.tsx      # Main palette UI component
└── lib/
    └── pms-commands.ts         # PMS-specific command definitions
```

### Key Files

#### `types/command-palette.ts`
Defines the command structure:
```typescript
interface Command {
  id: string
  label: string
  description?: string
  category: CommandCategory
  keywords?: string[]
  shortcut?: string
  icon?: React.ComponentType
  action: () => void
  disabled?: boolean
}
```

#### `hooks/use-command-palette.ts`
Manages command palette state and keyboard shortcuts:
- `Cmd/Ctrl+K` to toggle palette
- `Escape` to close
- Fuzzy search and filtering logic
- Command grouping by category

#### `components/CommandPalette.tsx`
Renders the command palette dialog with:
- Shadcn `CommandDialog` component
- Keyboard shortcut badges
- Category grouping
- Visual icons from Phosphor Icons
- "Coming Soon" badges for disabled commands

#### `lib/pms-commands.ts`
Defines all PMS commands with:
- Action handlers (currently toast notifications)
- Keyboard shortcuts
- Icons
- Keywords for search
- Disabled state for planned features

### Integration

The command palette is integrated into the Board component:

```typescript
import { CommandPalette } from '@/components/CommandPalette'
import { useCommandPalette } from '@/hooks/use-command-palette'
import { createPMSCommands } from '@/lib/pms-commands'

// In component
const commandPalette = useCommandPalette()
const commands = useMemo(() => createPMSCommands(), [])

// In JSX
<CommandPalette
  open={commandPalette.isOpen}
  onOpenChange={commandPalette.close}
  commands={commands}
/>
```

## Usage

### For Users

1. **Open the Command Palette**:
   - Press `⌘K` (Mac) or `Ctrl+K` (Windows/Linux)
   - Or click the "Commands" button in the top navigation

2. **Search for a Command**:
   - Type to filter commands
   - Use arrow keys to navigate
   - Press Enter to execute

3. **Close the Palette**:
   - Press `Escape`
   - Click outside the dialog
   - Execute a command (auto-closes)

### For Developers

#### Adding New Commands

Edit `src/lib/pms-commands.ts`:

```typescript
{
  id: 'my-new-command',
  label: 'My New Command',
  description: 'What this command does',
  category: 'operations',
  keywords: ['extra', 'search', 'terms'],
  shortcut: 'cmd+shift+n',
  icon: MyIcon,
  action: () => {
    // Your action here
    toast.success('Command executed!')
  },
  disabled: false, // Set to true for coming soon features
}
```

#### Keyboard Shortcut Format

Shortcuts use this format: `cmd+shift+k`

Supported modifiers:
- `cmd` / `ctrl` (auto-maps to platform)
- `shift`
- `alt` / `option`

Supported keys:
- Letters: `a-z`
- Numbers: `0-9`
- Special: `enter`, `escape`, `space`, `tab`, etc.

The system auto-converts to symbols:
- `cmd` → `⌘`
- `ctrl` → `⌃`
- `shift` → `⇧`
- `alt`/`option` → `⌥`
- `enter` → `↵`

#### Customizing the Palette

**Change Categories**: Edit `CommandCategory` type in `types/command-palette.ts`

**Modify Search Logic**: Update `filterCommands()` in `hooks/use-command-palette.ts`

**Adjust Styling**: Edit `components/CommandPalette.tsx` (uses Tailwind classes)

## Design Philosophy

The command palette follows these principles from the PMS PRD:

1. **Zero-Navigation Operations**: Critical tasks happen without leaving the main screen
2. **Speed Over Features**: Optimized for the 200th time someone performs an action
3. **Immediate Clarity**: Clear visual feedback and organization
4. **Keyboard Shortcuts**: Fast room board rendering and instant search
5. **Production-Grade**: Proper TypeScript types, error boundaries, loading states

## Future Enhancements

- [ ] Recent commands history
- [ ] Contextual commands based on current screen
- [ ] Custom keyboard shortcut configuration
- [ ] Search across actual rooms and guests (not just commands)
- [ ] Command palette within command palette (nested actions)
- [ ] Quick calculator/date picker utilities
- [ ] Global notification access
- [ ] Integration with room search (cmd+f focuses board search)

## Browser Support

The command palette works in all modern browsers:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

Keyboard shortcuts are platform-aware (Cmd on Mac, Ctrl on Windows/Linux).

## Accessibility

- Fully keyboard navigable
- ARIA labels for screen readers
- Focus management
- High contrast mode support
- Respects prefers-reduced-motion

---

Built for Sandbox Hotel PMS — a premium boutique hotel operations system.
