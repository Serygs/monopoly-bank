import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type CSSProperties } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

function DialogHarness({
  closeDisabled = false,
  onClose = () => {},
}: {
  closeDisabled?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Dialog
          title="Finish game"
          closeLabel="Close Finish game"
          closeDisabled={closeDisabled}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <input aria-label="Winner" />
          <button type="button">Confirm</button>
        </Dialog>
      )}
    </>
  );
}

async function openHarness(props: Parameters<typeof DialogHarness>[0] = {}) {
  const user = userEvent.setup();
  render(<DialogHarness {...props} />);
  const trigger = screen.getByRole('button', { name: 'Open' });
  await user.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'Finish game' });
  const close = screen.getByRole('button', { name: 'Close Finish game' });
  await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  return { user, trigger, dialog, close };
}

describe('Dialog', () => {
  it('opens as a labelled modal dialog and focuses its first control', async () => {
    const { dialog, close } = await openHarness();
    await waitFor(() => expect(close).toHaveFocus());
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveClass('dialog-backdrop', 'dialog-backdrop--modal');
    const panel = dialog.querySelector('section.dialog');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('header h2')).toHaveTextContent('Finish game');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const onClose = vi.fn();
    const { user, trigger } = await openHarness({ onClose });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes from the close button and on an outside click', async () => {
    const onClose = vi.fn();
    const { user, trigger, close } = await openHarness({ onClose });
    await user.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    await user.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    const { user, close } = await openHarness();
    await waitFor(() => expect(close).toHaveFocus());
    const winner = screen.getByRole('textbox', { name: 'Winner' });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    await user.tab();
    expect(winner).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    // Past the last control the trailing focus guard wraps focus back to the first one.
    await user.tab();
    await waitFor(() => expect(close).toHaveFocus());
    await user.tab();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Open' })).not.toHaveFocus();
  });

  it('blocks every close path while closeDisabled is set', async () => {
    const onClose = vi.fn();
    const { user, dialog, close } = await openHarness({ closeDisabled: true, onClose });
    expect(close).toBeDisabled();
    expect(close).not.toHaveFocus();

    const winner = screen.getByRole('textbox', { name: 'Winner' });
    await user.click(winner);
    await user.keyboard('{Escape}');
    expect(winner).toHaveFocus();

    await user.click(dialog);
    await user.click(close);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('positions the popover presentation and keeps the settings id on the dialog', async () => {
    const style = { '--settings-popover-top': '64px' } as CSSProperties;
    render(
      <Dialog
        title="Settings"
        closeLabel="Close Settings"
        className="settings-panel"
        presentation="popover"
        popoverStyle={style}
        onClose={() => {}}
      >
        <p>Body</p>
      </Dialog>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    expect(dialog).toHaveAttribute('id', 'settings-panel');
    expect(dialog).toHaveClass('dialog-backdrop--popover');
    const panel = dialog.querySelector<HTMLElement>('section.dialog.settings-panel');
    expect(panel?.style.getPropertyValue('--settings-popover-top')).toBe('64px');
  });

  it('gives each visual style its own centred entrance, one sheet slide below md, and gates all motion on reduced motion', async () => {
    const { dialog } = await openHarness();
    const panel = dialog.querySelector('section.dialog');
    const panelClasses = Array.from(panel?.classList ?? []);
    const backdropClasses = Array.from(dialog.classList);
    expect(panelClasses).toContain('classic:md:motion-safe:data-closed:translate-y-[4px]');
    expect(panelClasses).toContain('glass:md:motion-safe:data-closed:translate-y-[5px]');
    // Below `md` both styles share the bottom-sheet slide; no style-specific compact travel.
    expect(panelClasses).toContain('max-md:motion-safe:data-closed:translate-y-full');
    expect(
      panelClasses.filter((name) => /^(classic|glass):max-md:.*data-closed/.test(name)),
    ).toEqual([]);
    // The sheet reads the shared safe-area tokens, never raw `env()`.
    expect(panelClasses.some((name) => name.includes('env('))).toBe(false);
    expect(backdropClasses.some((name) => name.includes('env('))).toBe(false);
    for (const classes of [panelClasses, backdropClasses]) {
      expect(classes).toContain('motion-reduce:transition-none');
      const motion = classes.filter((name) => /transition|duration|ease|data-closed/.test(name));
      expect(motion.length).toBeGreaterThan(0);
      expect(motion.every((name) => /motion-(safe|reduce):/.test(name))).toBe(true);
    }
  });
});
