import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Notice } from './Notice';

describe('Notice', () => {
  it('announces errors assertively', () => {
    render(<Notice tone="error">Unable to save.</Notice>);
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('Unable to save.');
    expect(notice.tagName).toBe('P');
    expect(notice.getAttribute('class')).toBe('notice notice-error');
  });

  it('announces success politely', () => {
    render(<Notice tone="success">Saved.</Notice>);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Saved.');
    expect(notice.getAttribute('class')).toBe('notice notice-success');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces info politely without inventing a tone class', () => {
    render(<Notice tone="info">Heads up.</Notice>);
    expect(screen.getByRole('status').getAttribute('class')).toBe('notice');
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
    expect(notice.getAttribute('class')).toBe('notice notice-success game-state-banner');
    expect(notice).toContainElement(screen.getByRole('button', { name: 'Start' }));
  });
});
