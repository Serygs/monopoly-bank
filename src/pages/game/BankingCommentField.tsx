import { Button, Field } from '../../components/ui';
import type { BankingForm } from './useBankingDialog';

export function CommentField({ form }: { form: BankingForm }) {
  const { t, fields, handlers } = form;
  if (fields.commentOpen || fields.comment !== '')
    return (
      <Field variant="dialog" label={t('comment')}>
        <input
          value={fields.comment}
          maxLength={500}
          onChange={(event) => handlers.changeComment(event.target.value)}
        />
      </Field>
    );
  return (
    <Button
      variant="quiet"
      className="justify-start! px-0!"
      onClick={() => handlers.patchField({ commentOpen: true })}
    >
      <span aria-hidden="true">+</span> {t('addComment')}
    </Button>
  );
}
