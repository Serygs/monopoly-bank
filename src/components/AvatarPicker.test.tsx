import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AVATAR_OPTIONS } from '../utils/avatar';
import { AvatarPicker } from './AvatarPicker';

const commonProps = {
  onChange: () => {},
  label: 'Avatar',
  uploadLabel: 'Upload photo',
  uploadHint: 'JPEG only',
  invalidImageMessage: 'Invalid image',
};

describe('avatar picker accessibility', () => {
  it('uses a roving radio group for emoji choices', () => {
    const markup = renderToStaticMarkup(<AvatarPicker {...commonProps} avatar={AVATAR_OPTIONS[0]} />);
    expect(markup).toContain('role="radiogroup"');
    expect(markup.match(/role="radio"/g)).toHaveLength(AVATAR_OPTIONS.length);
    expect(markup.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(AVATAR_OPTIONS.length - 1);
  });

  it('keeps the uploaded avatar represented without removing emoji keyboard entry', () => {
    const markup = renderToStaticMarkup(<AvatarPicker {...commonProps} avatar="data:image/jpeg;base64,AA==" />);
    expect(markup.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
  });
});
