import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field, FieldError, FieldHint } from './Field';

describe('Field', () => {
  it('labels its control', () => {
    render(
      <Field label="Nickname">
        <input />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Nickname' });
    const label = input.closest('label');
    expect(label).not.toBeNull();
    expect(label).toHaveAttribute('for', input.id);
    expect(label).not.toHaveAttribute('class');
  });

  it('describes the control with its hint', () => {
    render(
      <Field label="Password" hint="At least 4 characters.">
        <input type="password" />
      </Field>,
    );
    // Hints and errors live inside the label, so the label text starts with the field name.
    const input = screen.getByLabelText(/^Password/);
    const hint = screen.getByText('At least 4 characters.');
    expect(hint).toHaveClass('field-hint');
    expect(input).toHaveAttribute('aria-describedby', hint.id);
    expect(input).toHaveAccessibleDescription('At least 4 characters.');
    expect(input).not.toHaveAttribute('aria-errormessage');
  });

  it('links the error message and marks the control invalid', () => {
    render(
      <Field label="Game name" hint="Shown to players." error="Enter a game name.">
        <input />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: /^Game name/ });
    const error = screen.getByText('Enter a game name.');
    expect(error).toHaveClass('text-danger');
    expect(input).toHaveAttribute('aria-errormessage', error.id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleErrorMessage('Enter a game name.');
  });

  it('keeps an explicit aria-invalid and control id', () => {
    render(
      <Field label="Player" error="Enter a name.">
        <input id="player-name" aria-invalid={false} />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: /^Player/ });
    expect(input.id).toBe('player-name');
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('renders the dialog layout with a wrapped label, note and small hint', () => {
    render(
      <Field
        variant="dialog"
        wrapLabel
        label="Comment"
        note="optional"
        hint="Visible to everyone."
        hintElement="small"
      >
        <input />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: /Comment/ });
    const label = input.closest('label');
    expect(label).toHaveClass('dialog-field');
    expect(screen.getByText('optional')).toHaveClass('field-note');
    const hint = screen.getByText('Visible to everyone.');
    expect(hint.tagName).toBe('SMALL');
    expect(hint).not.toHaveAttribute('class');
    expect(input).toHaveAttribute('aria-describedby', hint.id);
  });

  it('gives each field its own ids', () => {
    render(
      <>
        <Field label="First" hint="One">
          <input />
        </Field>
        <Field label="Second" hint="Two">
          <input />
        </Field>
      </>,
    );
    const first = screen.getByRole('textbox', { name: /^First/ });
    const second = screen.getByRole('textbox', { name: /^Second/ });
    expect(first.id).not.toBe(second.id);
    expect(first.getAttribute('aria-describedby')).not.toBe(
      second.getAttribute('aria-describedby'),
    );
  });
});

describe('field messages', () => {
  it('announces a standalone error only when asked', () => {
    render(
      <>
        <FieldError>Quiet error</FieldError>
        <FieldError as="p" announce>
          Loud error
        </FieldError>
        <FieldHint as="p">Hint copy</FieldHint>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Loud error');
    expect(screen.getByText('Quiet error')).not.toHaveAttribute('role');
    expect(screen.getByText('Hint copy').tagName).toBe('P');
  });
});
