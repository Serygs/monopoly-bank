import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '../Dialog';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { FeedbackProvider } from './ToastRegion';
import { TOAST_DURATION_MS, TOAST_LIMIT, useFeedback, type FeedbackMessage } from './useFeedback';

function Trigger({ feedback, label = 'Notify' }: { feedback: FeedbackMessage; label?: string }) {
  const notify = useFeedback();
  return (
    <button type="button" onClick={() => notify(feedback)}>
      {label}
    </button>
  );
}

function renderWithRegion(ui: ReactNode) {
  return render(
    <LanguageProvider>
      <FeedbackProvider>{ui}</FeedbackProvider>
    </LanguageProvider>,
  );
}

function liveStack(level: 'polite' | 'assertive'): HTMLElement {
  const region = screen.getByRole('region', { name: 'Notifications' });
  const stack = region.querySelector<HTMLElement>(`[aria-live="${level}"]`);
  if (stack === null) throw new Error(`No ${level} live stack.`);
  return stack;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FeedbackProvider', () => {
  it('mounts one labelled region in <body> with a polite and an assertive stack', () => {
    const { container } = renderWithRegion(<p>Page</p>);
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region.parentElement).toBe(document.body);
    expect(container).not.toContainElement(region);
    expect(liveStack('polite')).toBeEmptyDOMElement();
    expect(liveStack('assertive')).toBeEmptyDOMElement();
  });

  it('announces success politely and errors assertively, each exactly once', async () => {
    const user = userEvent.setup();
    renderWithRegion(
      <>
        <Trigger label="Save" feedback={{ tone: 'success', message: 'Profile updated.' }} />
        <Trigger label="Fail" feedback={{ tone: 'error', message: 'Unable to save.' }} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Fail' }));

    expect(within(liveStack('polite')).getByText('Profile updated.')).toBeInTheDocument();
    expect(within(liveStack('assertive')).getByText('Unable to save.')).toBeInTheDocument();
    expect(screen.getAllByText('Profile updated.')).toHaveLength(1);
    // Toasts carry no role of their own, so no nested live region announces them again.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('dismisses from the localized close button', async () => {
    const user = userEvent.setup();
    renderWithRegion(<Trigger feedback={{ tone: 'success', message: 'Invite link copied.' }} />);
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Invite link copied.')).not.toBeInTheDocument();
  });

  it('removes success toasts after the delay but keeps errors until dismissed', () => {
    vi.useFakeTimers();
    renderWithRegion(
      <>
        <Trigger label="Save" feedback={{ tone: 'success', message: 'Saved.' }} />
        <Trigger label="Fail" feedback={{ tone: 'error', message: 'Failed.' }} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fail' }));
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(screen.getByText('Saved.')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 10);
    });
    expect(screen.getByText('Failed.')).toBeInTheDocument();
  });

  it('holds the countdown while the pointer rests on a toast and resumes with the time left', () => {
    vi.useFakeTimers();
    renderWithRegion(<Trigger feedback={{ tone: 'success', message: 'Saved.' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
    const toast = screen.getByText('Saved.').parentElement as HTMLElement;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.pointerEnter(toast);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 5);
    });
    expect(screen.getByText('Saved.')).toBeInTheDocument();

    fireEvent.pointerLeave(toast);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1000 - 1);
    });
    expect(screen.getByText('Saved.')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
  });

  it('holds the countdown while focus is inside a toast, even after the pointer leaves', () => {
    vi.useFakeTimers();
    renderWithRegion(<Trigger feedback={{ tone: 'info', message: 'Link ready.' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
    const toast = screen.getByText('Link ready.').parentElement as HTMLElement;
    const close = screen.getByRole('button', { name: 'Dismiss notification' });

    act(() => close.focus());
    fireEvent.pointerEnter(toast);
    fireEvent.pointerLeave(toast);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 5);
    });
    expect(screen.getByText('Link ready.')).toBeInTheDocument();

    act(() => close.blur());
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(screen.getByText('Link ready.')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Link ready.')).not.toBeInTheDocument();
  });

  it('replaces a repeated message and caps the stack', async () => {
    const user = userEvent.setup();
    function Burst() {
      const notify = useFeedback();
      const [count, setCount] = useState(0);
      return (
        <button
          type="button"
          onClick={() => {
            notify({ tone: 'success', message: `Message ${count}` });
            setCount(count + 1);
          }}
        >
          Next
        </button>
      );
    }
    renderWithRegion(
      <>
        <Trigger label="Repeat" feedback={{ tone: 'success', message: 'Copied.' }} />
        <Burst />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Repeat' }));
    await user.click(screen.getByRole('button', { name: 'Repeat' }));
    expect(screen.getAllByText('Copied.')).toHaveLength(1);

    for (let index = 0; index < TOAST_LIMIT + 1; index += 1)
      await user.click(screen.getByRole('button', { name: 'Next' }));
    const toasts = within(liveStack('polite')).getAllByRole('button', {
      name: 'Dismiss notification',
    });
    expect(toasts).toHaveLength(TOAST_LIMIT);
    expect(screen.queryByText('Copied.')).not.toBeInTheDocument();
    expect(screen.queryByText('Message 0')).not.toBeInTheDocument();
    expect(screen.getByText(`Message ${TOAST_LIMIT}`)).toBeInTheDocument();
  });

  it('stays live and clickable above an open modal without closing it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithRegion(
      <Dialog title="Invite players" closeLabel="Close Invite players" onClose={onClose}>
        <Trigger feedback={{ tone: 'success', message: 'Invite link copied.' }} />
      </Dialog>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Invite players' });
    await user.click(within(dialog).getByRole('button', { name: 'Notify' }));

    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region.closest('[inert]')).toBeNull();
    expect(region.closest('[aria-hidden="true"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Invite link copied.')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  it('refuses to queue feedback outside the provider', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger feedback={{ tone: 'info', message: 'Lost.' }} />)).toThrow(
      'useFeedback must be used inside FeedbackProvider.',
    );
    error.mockRestore();
  });
});
