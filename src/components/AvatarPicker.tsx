import { Radio, RadioGroup } from '@headlessui/react';
import { useId, useState, type ChangeEvent } from 'react';
import { AVATAR_OPTIONS, isUploadedAvatar } from '../utils/avatar';
import { cropAvatar } from '../utils/avatar-image';
import { FieldError, FieldHint } from './ui';
import { buttonClass, cx } from './ui/class-names';
import { keepEnterInRadio } from './ui/radio-keys';

/* `avatar` / `avatar-icon` stay as hooks: callers size the avatar through their own class. */
const avatarClass = 'grid size-10 place-items-center rounded-full object-cover';
const avatarOptionClass = cx(
  'inline-grid size-[52px] flex-none cursor-pointer place-items-center rounded-full border border-border-strong bg-surface-elevated',
  'transition-[border-color,box-shadow,transform] duration-(--mb-duration-fast) ease-standard motion-reduce:transition-none',
  'data-checked:border-accent data-checked:shadow-[0_0_0_3px_var(--mb-color-surface-elevated),0_0_0_5px_var(--mb-color-accent)]',
  'focus-visible:outline-offset-4 fine-pointer:hover:border-accent',
);

export function Avatar({
  avatar,
  label,
  className = '',
}: {
  avatar: string;
  label: string;
  className?: string;
}) {
  return isUploadedAvatar(avatar) ? (
    <img className={cx('avatar', avatarClass, className)} src={avatar} alt={label} />
  ) : (
    <span
      className={cx('avatar avatar-icon', avatarClass, className)}
      role="img"
      aria-label={label}
    >
      {avatar}
    </span>
  );
}

export function AvatarPicker({
  avatar,
  onChange,
  label,
  uploadLabel,
  uploadHint,
  invalidImageMessage,
  allowUpload = false,
}: {
  avatar: string;
  onChange: (avatar: string) => void;
  label: string;
  uploadLabel: string;
  uploadHint: string;
  invalidImageMessage: string;
  allowUpload?: boolean;
}) {
  const fileInputId = useId();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadedAvatarSelected = isUploadedAvatar(avatar);
  const selectAvatar = (next: string) => {
    onChange(next);
    setUploadError(null);
  };
  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (file === undefined) return;
    try {
      onChange(await cropAvatar(file));
      setUploadError(null);
    } catch {
      setUploadError(invalidImageMessage);
    }
  };

  return (
    <fieldset className="avatar-picker">
      <legend>{label}</legend>
      <RadioGroup
        className="flex flex-wrap gap-(--mb-space-3)"
        aria-label={label}
        value={avatar}
        onChange={selectAvatar}
      >
        {AVATAR_OPTIONS.map((option) => (
          <Radio
            as="button"
            type="button"
            key={option}
            value={option}
            className={avatarOptionClass}
            onKeyDown={keepEnterInRadio}
          >
            <Avatar avatar={option} label={option} />
          </Radio>
        ))}
        {uploadedAvatarSelected && (
          <Radio value={avatar} className={avatarOptionClass} onKeyDown={keepEnterInRadio}>
            <Avatar avatar={avatar} label={label} />
          </Radio>
        )}
      </RadioGroup>
      {allowUpload && (
        // `avatar-upload` keeps the visually hidden file input above the shared `.game-form input` rule.
        <div className="avatar-upload mt-(--mb-space-4) flex flex-wrap items-center gap-(--mb-space-3) max-md:[&_.field-hint]:w-full">
          <input
            id={fileInputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => void selectFile(event)}
          />
          <label className={cx(buttonClass('secondary'), 'max-md:w-full')} htmlFor={fileInputId}>
            {uploadLabel}
          </label>
          <FieldHint>{uploadHint}</FieldHint>
        </div>
      )}
      {uploadError !== null && (
        <FieldError as="p" announce>
          {uploadError}
        </FieldError>
      )}
    </fieldset>
  );
}
