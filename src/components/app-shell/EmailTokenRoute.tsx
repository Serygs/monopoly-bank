import type { UserProfile } from '../../../shared/contracts/api';
import { PasswordResetPage, VerifyEmailPage } from '../../pages/EmailTokenPage';
import { EMAIL_FEATURES_ENABLED } from '../../utils/email-features';

interface EmailTokenRouteProps {
  path: string;
  onVerified: (profile: UserProfile) => void;
  onBack: () => void;
}

export function emailTokenRoute({ path, onVerified, onBack }: EmailTokenRouteProps) {
  if (!EMAIL_FEATURES_ENABLED) return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  if (path === '/verify-email')
    return <VerifyEmailPage token={token} onVerified={onVerified} onBack={onBack} />;
  if (path === '/reset-password') return <PasswordResetPage token={token} onBack={onBack} />;
  return null;
}
