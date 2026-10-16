import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StepperBar } from './StepperBar';

const base = {
  label: 'Steps',
  total: 3,
  indicator: 'Step 1 of 3',
  backLabel: 'Back',
  nextLabel: 'Next',
};

describe('StepperBar', () => {
  it('hides Back on the first step and shows the indicator', async () => {
    const onNext = vi.fn();
    render(<StepperBar {...base} step={0} onBack={() => {}} onNext={onNext} />);
    expect(screen.getByRole('status')).toHaveTextContent('Step 1 of 3');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalled();
  });

  it('offers Back after the first step and disables both while busy', async () => {
    const onBack = vi.fn();
    const { rerender } = render(
      <StepperBar {...base} step={2} nextLabel="Create lobby" onBack={onBack} onNext={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create lobby' })).toBeEnabled();
    rerender(
      <StepperBar
        {...base}
        step={2}
        nextLabel="Create lobby"
        busy
        onBack={onBack}
        onNext={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });
});
