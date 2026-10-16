import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react';
import { useMemo } from 'react';
import type { Game } from '../../shared/types/monopoly';
import { Dialog } from '../components/Dialog';
import { cx } from '../components/ui/class-names';
import { buildRulesValues, rulesForGame, type RulesValues } from '../content/game-rules';
import { useLanguage } from '../i18n/language-context';

const listClass = 'mt-(--mb-space-4) grid gap-(--mb-space-2)';
const itemClass = 'rounded-control border border-border bg-surface-subtle';
const buttonClass = cx(
  'flex min-h-(--mb-control-height-md) w-full cursor-pointer items-center justify-between gap-(--mb-space-3)',
  'rounded-control border-0 bg-transparent px-(--mb-space-4) py-(--mb-space-2) text-start font-ui text-body font-semibold text-primary',
);
const chevronClass = 'flex-none text-secondary transition-transform group-data-open:rotate-180';
const panelClass =
  'grid gap-(--mb-space-3) px-(--mb-space-4) pb-(--mb-space-4) text-body text-secondary';
const bulletsClass = 'm-0 grid list-disc gap-(--mb-space-2) ps-(--mb-space-5)';

/** The values a game's own settings put into the rules text; older games derive them from the starting balance. */
function rulesValues(game: Game): RulesValues {
  return buildRulesValues(
    game.startingBalance,
    game.passGoReward,
    game.currency,
    game.settings ?? undefined,
  );
}

/** The rulebook for this game: static text from the bundle, so it also opens offline. */
export function RulesScreen({ game, onClose }: { game: Game; onClose: () => void }) {
  const { language, t } = useLanguage();
  const sections = useMemo(
    () => rulesForGame(language, game.rules, rulesValues(game)),
    [language, game],
  );
  return (
    <Dialog
      title={t('gameRules')}
      closeLabel={t('closeDialog', { title: t('gameRules') })}
      onClose={onClose}
    >
      <div className={listClass}>
        {sections.map((section) => (
          <Disclosure
            as="section"
            key={section.id}
            defaultOpen={section.id === 'basic'}
            className={itemClass}
          >
            <DisclosureButton className={cx(buttonClass, 'group')}>
              {section.title}
              <span aria-hidden="true" className={chevronClass}>
                ▾
              </span>
            </DisclosureButton>
            <DisclosurePanel className={panelClass}>
              {section.paragraphs.map((text) => (
                <p key={text} className="m-0">
                  {text}
                </p>
              ))}
              {section.bullets !== undefined && (
                <ul className={bulletsClass}>
                  {section.bullets.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )}
            </DisclosurePanel>
          </Disclosure>
        ))}
      </div>
    </Dialog>
  );
}
