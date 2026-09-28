import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AVATAR_OPTIONS } from '../utils/avatar';
import { AvatarPicker } from './AvatarPicker';

const commonProps = {
  onChange: () => {},
  label: 'Avatar',
  uploadLabel: 'Upload photo',
  uploadHint: 'JPEG only',
  invalidImageMessage: 'Invalid image',
};

function ControlledPicker({ onChange }: { onChange: (avatar: string) => void }) {
  const [avatar, setAvatar] = useState<string>(AVATAR_OPTIONS[0]);
  return (
    <AvatarPicker
      {...commonProps}
      avatar={avatar}
      onChange={(next) => {
        setAvatar(next);
        onChange(next);
      }}
    />
  );
}

describe('avatar picker accessibility', () => {
  it('uses a roving radio group for emoji choices', () => {
    const { container } = render(<AvatarPicker {...commonProps} avatar={AVATAR_OPTIONS[0]} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(AVATAR_OPTIONS.length);
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(container.querySelectorAll('[tabindex="-1"]')).toHaveLength(AVATAR_OPTIONS.length - 1);
  });

  it('keeps the uploaded avatar represented without removing emoji keyboard entry', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <AvatarPicker {...commonProps} onChange={onChange} avatar="data:image/jpeg;base64,AA==" />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(AVATAR_OPTIONS.length + 1);
    expect(screen.getAllByRole('radio', { checked: true })).toEqual([radios.at(-1)]);
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);

    // The uploaded photo is the group's tab stop; the arrow keys lead back into the emoji set.
    await user.tab();
    expect(radios.at(-1)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(radios[0]).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(AVATAR_OPTIONS[0]);
  });

  it('selects emoji options from the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);
    const options = screen.getAllByRole('radio');
    const last = AVATAR_OPTIONS.length - 1;

    await user.tab();
    expect(options[0]).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(options[1]).toHaveFocus();
    expect(options[1]).toHaveAttribute('aria-checked', 'true');
    expect(options[1]).toHaveAttribute('tabindex', '0');
    expect(options[0]).toHaveAttribute('aria-checked', 'false');
    expect(options[0]).toHaveAttribute('tabindex', '-1');
    expect(onChange).toHaveBeenLastCalledWith(AVATAR_OPTIONS[1]);

    await user.keyboard('{ArrowUp}');
    expect(options[0]).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(AVATAR_OPTIONS[0]);

    await user.keyboard('{ArrowLeft}');
    expect(options[last]).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(AVATAR_OPTIONS[last]);

    await user.keyboard('{ArrowDown}');
    expect(options[0]).toHaveFocus();
    expect(screen.getAllByRole('radio', { checked: true })).toEqual([options[0]]);
  });

  it('does not submit the surrounding form when Enter is pressed on an option', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const onChange = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <ControlledPicker onChange={onChange} />
        <button type="submit">Save</button>
      </form>,
    );
    const options = screen.getAllByRole('radio');

    await user.tab();
    expect(options[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    // Enter still activates a different option, as the native button did before.
    options[2].focus();
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(AVATAR_OPTIONS[2]);
    expect(options[2]).toHaveAttribute('aria-checked', 'true');
  });

  it('does not submit the surrounding form when Enter is pressed on the uploaded avatar', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <AvatarPicker {...commonProps} avatar="data:image/jpeg;base64,AA==" />
        <button type="submit">Save</button>
      </form>,
    );
    await user.tab();
    expect(screen.getAllByRole('radio').at(-1)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('selects an emoji option with the pointer', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);
    const options = screen.getAllByRole('radio');
    await user.click(options[2]);
    expect(onChange).toHaveBeenLastCalledWith(AVATAR_OPTIONS[2]);
    expect(options[2]).toHaveAttribute('aria-checked', 'true');
    expect(options[2]).toHaveFocus();
  });
});
