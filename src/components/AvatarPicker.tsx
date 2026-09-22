import { useId, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { AVATAR_OPTIONS, isUploadedAvatar } from '../utils/avatar';
import { cropAvatar } from '../utils/avatar-image';

export function Avatar({ avatar, label, className = '' }: { avatar: string; label: string; className?: string }) {
  return isUploadedAvatar(avatar)
    ? <img className={`avatar ${className}`} src={avatar} alt={label} />
    : <span className={`avatar avatar-icon ${className}`} role="img" aria-label={label}>{avatar}</span>;
}

export function AvatarPicker({ avatar, onChange, label, uploadLabel, uploadHint, invalidImageMessage, allowUpload = false }: {
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
  const moveAvatarFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]'));
    if (options.length === 0) return;
    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (currentIndex + 1) % options.length : (currentIndex - 1 + options.length) % options.length;
    options[nextIndex]?.focus();
    options[nextIndex]?.click();
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

  return <fieldset className="avatar-picker">
    <legend>{label}</legend>
    <div className="avatar-options" role="radiogroup" aria-label={label} onKeyDown={moveAvatarFocus}>
      {AVATAR_OPTIONS.map((option, index) => <button key={option} className={`avatar-option${avatar === option ? ' selected' : ''}`} type="button" role="radio" aria-checked={avatar === option} tabIndex={avatar === option || (uploadedAvatarSelected && index === 0) ? 0 : -1} onClick={() => { onChange(option); setUploadError(null); }}><Avatar avatar={option} label={option} /></button>)}
      {uploadedAvatarSelected && <span className="avatar-option selected" role="radio" aria-checked="true"><Avatar avatar={avatar} label={label} /></span>}
    </div>
    {allowUpload && <div className="avatar-upload"><input id={fileInputId} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectFile(event)} /><label className="button button-secondary" htmlFor={fileInputId}>{uploadLabel}</label><span className="field-hint">{uploadHint}</span></div>}
    {uploadError !== null && <p className="field-error" role="alert">{uploadError}</p>}
  </fieldset>;
}
