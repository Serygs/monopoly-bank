import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OverflowMenu } from './OverflowMenu';

function renderMenu() {
  const duplicate = vi.fn();
  const archive = vi.fn();
  const remove = vi.fn();
  render(
    <>
      <OverflowMenu
        label="Game actions"
        items={[
          { label: 'Duplicate', onSelect: duplicate },
          { label: 'Archive', onSelect: archive, disabled: true },
          { label: 'Remove game', onSelect: remove, tone: 'danger' },
        ]}
      />
      <button type="button">Outside</button>
    </>,
  );
  const trigger = screen.getByRole('button', { name: 'Game actions' });
  return { user: userEvent.setup(), trigger, duplicate, archive, remove };
}

/** Headless UI keeps focus on the menu and points `aria-activedescendant` at the active item. */
function activeItem(): HTMLElement | null {
  const id = screen.getByRole('menu').getAttribute('aria-activedescendant');
  return id === null ? null : document.getElementById(id);
}

describe('OverflowMenu', () => {
  it('opens a labelled menu from the trigger', async () => {
    const { user, trigger } = renderMenu();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Game actions' });
    expect(menu).toHaveClass('overflow-menu-panel');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Duplicate',
      'Archive',
      'Remove game',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Remove game' })).toHaveClass(
      'overflow-menu-item',
      'overflow-menu-item-danger',
    );
  });

  it('moves between enabled items with the arrow, Home and End keys', async () => {
    const { user, trigger } = renderMenu();
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toHaveFocus();
    expect(activeItem()).toHaveTextContent('Duplicate');

    await user.keyboard('{ArrowDown}');
    expect(activeItem()).toHaveTextContent('Remove game');
    expect(activeItem()).toHaveAttribute('data-focus');
    await user.keyboard('{ArrowUp}');
    expect(activeItem()).toHaveTextContent('Duplicate');
    await user.keyboard('{End}');
    expect(activeItem()).toHaveTextContent('Remove game');
    await user.keyboard('{Home}');
    expect(activeItem()).toHaveTextContent('Duplicate');
  });

  it('opens on the last item with ArrowUp', async () => {
    const { user, trigger } = renderMenu();
    trigger.focus();
    await user.keyboard('{ArrowUp}');
    expect(activeItem()).toHaveTextContent('Remove game');
  });

  it('selects the active item with Enter and returns focus to the trigger', async () => {
    const { user, trigger, duplicate, remove } = renderMenu();
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(activeItem()).toHaveTextContent('Duplicate');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(duplicate).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    // Headless UI restores focus to the trigger on the next frame.
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('selects an item with the pointer and ignores disabled items', async () => {
    const { user, trigger, duplicate, archive } = renderMenu();
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(archive).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes on Escape and on an outside click', async () => {
    const { user, trigger, duplicate } = renderMenu();
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(duplicate).not.toHaveBeenCalled();
  });
});
