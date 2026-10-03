import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, type ButtonVariant } from './Button';
import { buttonClass } from './class-names';

describe('Button', () => {
  it.each<[ButtonVariant, string]>([
    ['primary', 'button-primary'],
    ['secondary', 'button-secondary'],
    ['quiet', 'button-quiet'],
    ['danger', 'button-danger'],
  ])('renders the %s variant with the shared button classes', (variant, variantClass) => {
    render(<Button variant={variant}>Pay</Button>);
    const button = screen.getByRole('button', { name: 'Pay' });
    expect(button).toHaveClass('button', variantClass, 'rounded-control');
    expect(button).not.toHaveClass('icon-button');
    expect(button.getAttribute('class')).toBe(buttonClass(variant));
  });

  it('defaults to type="button" so it never submits a form by accident', () => {
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <Button variant="primary">Save</Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    button.click();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps an explicit submit type', () => {
    render(
      <Button variant="primary" type="submit">
        Save
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit');
  });

  it('adds the icon treatment and caller classes after the variant', () => {
    render(
      <Button variant="quiet" iconOnly className="dialog-close" aria-label="Close">
        ×
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).toHaveClass('button', 'button-quiet', 'icon-button', 'p-0', 'dialog-close');
    expect(button).not.toHaveClass('rounded-control');
    expect(button.getAttribute('class')).toBe(`${buttonClass('quiet', true)} dialog-close`);
  });

  it('renders only the core without a variant', () => {
    render(<Button className="wallet-action-button">Pay bank</Button>);
    const button = screen.getByRole('button', { name: 'Pay bank' });
    expect(button).toHaveClass('button', 'wallet-action-button');
    expect(button.className).not.toMatch(/\bbutton-(primary|secondary|quiet|danger)\b/);
    expect(button).not.toHaveClass('rounded-control');
    expect(button.className.endsWith(' wallet-action-button')).toBe(true);
  });

  it('forwards native props and responds to the keyboard', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="secondary" aria-pressed onClick={onClick}>
        Filter
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Filter', pressed: true });
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('does not fire when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="danger" disabled onClick={onClick}>
        Remove
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
