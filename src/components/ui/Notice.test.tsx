import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Notice } from './Notice';

describe('Notice', () => {
  it('announces errors assertively', () => {
    render(<Notice tone="error">Unable to save.</Notice>);
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('Unable to save.');
    expect(notice.tagName).toBe('P');
    expect(notice).toHaveClass('border-danger-border', 'bg-danger-soft', 'text-danger');
  });

  it('announces success politely', () => {
    render(<Notice tone="success">Saved.</Notice>);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Saved.');
    expect(notice).toHaveClass('border-status-border', 'bg-status-surface', 'text-status-text');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces info politely on the neutral surface', () => {
    render(<Notice tone="info">Heads up.</Notice>);
    const notice = screen.getByRole('status');
    expect(notice).toHaveClass('border-border', 'bg-surface-elevated', 'text-primary');
    expect(notice).not.toHaveClass('text-status-text');
  });

  it('renders the requested element with copy, action and extra classes', () => {
    render(
      <Notice tone="success" as="section" className="game-state-banner">
        <p>Waiting for players</p>
        <button type="button">Start</button>
      </Notice>,
    );
    const notice = screen.getByRole('status');
    expect(notice.tagName).toBe('SECTION');
    expect(notice).toHaveClass('text-status-text', 'game-state-banner');
    expect(notice.getAttribute('class')).toMatch(/ game-state-banner$/);
    expect(notice).toContainElement(screen.getByRole('button', { name: 'Start' }));
  });
});
