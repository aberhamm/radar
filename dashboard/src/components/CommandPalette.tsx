'use client';

import { useEffect, useCallback } from 'react';
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command';

interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const handleSelect = useCallback((commandId: string) => {
    const cmd = commands.find(c => c.id === commandId);
    if (cmd) {
      cmd.action();
      onClose();
    }
  }, [commands, onClose]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      title="Command Palette"
      description="Search for a command to run..."
      className="bg-[var(--color-surface)] border border-[var(--color-separator)] shadow-[var(--shadow-float)] sm:max-w-lg"
    >
      <Command
        className="bg-[var(--color-surface)] text-[var(--color-label)]"
        loop
      >
        <CommandInput
          placeholder="Type a command..."
          className="text-[var(--color-label)] placeholder:text-[var(--color-quaternary-label)]"
        />
        <CommandList className="max-h-[300px]">
          <CommandEmpty className="text-[var(--color-tertiary-label)]">
            No matching commands
          </CommandEmpty>
          <CommandGroup>
            {commands.map((cmd) => (
              <CommandItem
                key={cmd.id}
                value={cmd.id}
                keywords={[cmd.label]}
                onSelect={handleSelect}
                className="px-4 py-2.5 text-[var(--color-label)] data-selected:bg-[var(--color-tint)] data-selected:text-white rounded-md cursor-pointer"
              >
                <span className="text-sm font-medium">{cmd.label}</span>
                {cmd.shortcut && (
                  <CommandShortcut className="text-[10px] font-mono data-selected:text-white/80">
                    {cmd.shortcut}
                  </CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
