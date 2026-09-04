import { useId, useState, type ChangeEvent } from 'react';
import { AVATAR_OPTIONS, isUploadedAvatar } from '../utils/avatar';

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
    <div className="avatar-options" role="radiogroup" aria-label={label}>
      {AVATAR_OPTIONS.map((option) => <button key={option} className={`avatar-option${avatar === option ? ' selected' : ''}`} type="button" role="radio" aria-checked={avatar === option} onClick={() => { onChange(option); setUploadError(null); }}><Avatar avatar={option} label={option} /></button>)}
      {isUploadedAvatar(avatar) && <span className="avatar-option selected"><Avatar avatar={avatar} label={label} /></span>}
    </div>
    {allowUpload && <div className="avatar-upload"><input id={fileInputId} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectFile(event)} /><label className="button button-secondary" htmlFor={fileInputId}>{uploadLabel}</label><span className="field-hint">{uploadHint}</span></div>}
    {uploadError !== null && <p className="field-error" role="alert">{uploadError}</p>}
  </fieldset>;
}

async function cropAvatar(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Unsupported image');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (side === 0) throw new Error('Empty image');
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    canvas.getContext('2d')?.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    const result = canvas.toDataURL('image/jpeg', 0.86);
    if (result.length > 100_000) throw new Error('Image is too large');
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}
