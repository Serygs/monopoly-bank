/** Hash fragments do not leave the device in a Referer header. */
export function invitationFromLocation(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get('invite') ?? '';
}
