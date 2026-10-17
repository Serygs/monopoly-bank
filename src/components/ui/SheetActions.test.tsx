import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SheetActions } from './SheetActions';

describe('SheetActions', () => {
  it('keeps the action order and the payment-inbox hook class', () => {
    render(
      <SheetActions>
        <button type="button">Back</button>
        <button type="button">Confirm</button>
      </SheetActions>,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Back', 'Confirm']);
    expect(buttons[0]?.parentElement?.className).toContain('dialog-actions');
  });

  it('fades the content out instead of painting a background strip on compact', () => {
    render(<SheetActions data-testid="bar" />);
    const className = screen.getByTestId('bar').className;
    expect(className).toContain('max-md:bg-linear-to-t');
    expect(className).not.toContain('max-md:bg-surface-elevated');
    expect(className).toContain('--mb-sheet-pad-bottom');
  });

  it('lays Back and the primary side by side on compact, the primary wider', () => {
    render(<SheetActions data-testid="bar" />);
    const className = screen.getByTestId('bar').className;
    expect(className).toContain('max-md:flex-row');
    expect(className).not.toContain('flex-col-reverse');
    expect(className).toContain('max-md:[&>:last-child:not(:only-child)]:flex-[1.4]');
  });

  it('merges a caller class', () => {
    render(<SheetActions data-testid="bar" className="extra" />);
    expect(screen.getByTestId('bar').className).toContain('extra');
  });
});
