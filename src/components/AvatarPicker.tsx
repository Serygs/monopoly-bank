import { Radio, RadioGroup } from '@headlessui/react';
import { useId, useState, type ChangeEvent } from 'react';
import { AVATAR_OPTIONS, isUploadedAvatar } from '../utils/avatar';
import { cropAvatar } from '../utils/avatar-image';
import { FieldError, FieldHint } from './ui';
import { keepEnterInRadio } from './ui/radio-keys';

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
    <img className={`avatar ${className}`} src={avatar} alt={label} />
  ) : (
    <span className={`avatar avatar-icon ${className}`} role="img" aria-label={label}>
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
        className="avatar-options"
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
            className={`avatar-option${avatar === option ? ' selected' : ''}`}
            onKeyDown={keepEnterInRadio}
          >
            <Avatar avatar={option} label={option} />
          </Radio>
        ))}
        {uploadedAvatarSelected && (
          <Radio value={avatar} className="avatar-option selected" onKeyDown={keepEnterInRadio}>
            <Avatar avatar={avatar} label={label} />
          </Radio>
        )}
      </RadioGroup>
      {allowUpload && (
        <div className="avatar-upload">
          <input
            id={fileInputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => void selectFile(event)}
          />
          <label className="button button-secondary" htmlFor={fileInputId}>
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
