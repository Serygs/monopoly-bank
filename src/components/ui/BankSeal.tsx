import { cx } from './class-names';

export type BankSealVariant = 'header' | 'offline' | 'auth' | 'card';

/* The header brand mark and the offline shell share one inverse-elevated plate in two sizes. */
const brandMarkClass = cx(
  'grid flex-none place-items-center rounded-md border border-[color:color-mix(in_srgb,var(--mb-color-highlight)_64%,transparent)]',
  'bg-surface-inverse-elevated text-meta font-bold tracking-meta text-on-inverse',
  'shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--mb-color-surface-inverse)_70%,transparent)]',
  'glass:border-[rgb(255_255_255/0.44)] glass:text-white glass:[background:linear-gradient(145deg,#6f91ba,#354d71)]',
  'glass:shadow-[inset_0_1px_0_rgb(255_255_255/0.36),0_6px_16px_rgb(50_70_100/0.14)]',
);

const sealClass: Record<BankSealVariant, string | undefined> = {
  header: cx(brandMarkClass, 'size-[42px]'),
  offline: cx(brandMarkClass, 'size-14'),
  /* The sign-in and join card heading. */
  auth: cx(
    'grid size-[42px] flex-none place-items-center rounded-md',
    'border border-[color:color-mix(in_srgb,var(--mb-color-highlight)_64%,transparent)]',
    'bg-surface-inverse text-meta font-bold tracking-meta text-highlight',
    'shadow-[inset_0_0_0_3px_var(--mb-color-surface-inverse-elevated)]',
  ),
  /* Saved-game card: Classic Bank shows the hero artwork, cropped differently on every 2nd and 3rd card. */
  card: cx(
    'grid h-[82px] w-[74px] flex-none place-items-center overflow-hidden rounded-[calc(var(--mb-radius-card)_-_4px)]',
    'border border-[color:color-mix(in_srgb,var(--mb-color-highlight)_64%,transparent)] bg-surface-inverse-elevated bg-cover bg-center',
    'text-meta font-bold tracking-meta text-on-inverse shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--mb-color-surface-inverse)_70%,transparent)]',
    'classic:border-[rgb(197_163_77/0.5)] classic:text-transparent classic:shadow-[inset_0_0_0_1px_rgb(255_249_234/0.22)]',
    'classic:bg-[image:linear-gradient(rgb(7_56_45/0.12),rgb(7_56_45/0.18)),url(/assets/themes/classic/hero-bank.webp)]',
    'classic:[.game-card:nth-child(2n):not(:nth-child(3n))_&]:bg-[position:75%_center] classic:[.game-card:nth-child(3n)_&]:bg-[position:88%_62%]',
  ),
};

/** The decorative `MB` bank seal: header brand, offline shell, auth-card heading, saved-game card. */
export function BankSeal({ variant }: { variant: BankSealVariant }) {
  return (
    <span className={sealClass[variant]} aria-hidden="true">
      MB
    </span>
  );
}
