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

  it('keeps the uploaded avatar represented without removing emoji keyboard entry', () => {
    const { container } = render(
      <AvatarPicker {...commonProps} avatar="data:image/jpeg;base64,AA==" />,
    );
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it('selects emoji options from the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);
    const options = screen.getAllByRole('radio');

    await user.tab();
    expect(options[0]).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(options[1]).toHaveFocus();
    expect(options[1]).toHaveAttribute('aria-checked', 'true');
    expect(options[1]).toHaveAttribute('tabindex', '0');
    expect(options[0]).toHaveAttribute('aria-checked', 'false');
    expect(onChange).toHaveBeenLastCalledWith(AVATAR_OPTIONS[1]);

    await user.keyboard('{End}');
    expect(options[AVATAR_OPTIONS.length - 1]).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(AVATAR_OPTIONS[AVATAR_OPTIONS.length - 1]);

    await user.keyboard('{ArrowDown}');
    expect(options[0]).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(AVATAR_OPTIONS[0]);

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(AVATAR_OPTIONS[AVATAR_OPTIONS.length - 1]);

    await user.keyboard('{Home}');
    expect(options[0]).toHaveFocus();
    expect(screen.getAllByRole('radio', { checked: true })).toEqual([options[0]]);
  });
});
