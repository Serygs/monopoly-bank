import type { TranslationKey } from '../i18n/translations';
import { mountLiquidGlassEffects } from './liquid-glass-effects';

export type VisualStyleId = 'classic-bank' | 'liquid-glass';
export type StyleCapability = 'translucentSurfaces' | 'pointerReactiveEffects' | 'deviceTiltEffects' | 'richBackgroundEffects';

export interface VisualStyleEffectContext {
  readonly root: HTMLElement;
  readonly ownerDocument: Document;
  /** Lazily access motion preference only in styles that actually mount effects. */
  readonly getReducedMotionPreference: () => MediaQueryList;
}

export interface VisualStyleDefinition {
  readonly id: VisualStyleId;
  readonly labelKey: TranslationKey;
  readonly supportedCapabilities: readonly StyleCapability[];
  /** Attach opt-in presentation effects only; release every listener/frame in the returned cleanup. */
  readonly mountEffects: (context: VisualStyleEffectContext) => () => void;
}

export const DEFAULT_VISUAL_STYLE: VisualStyleId = 'classic-bank';

export const visualStyles: readonly VisualStyleDefinition[] = [
  {
    id: 'classic-bank',
    labelKey: 'visualStyleClassicBank',
    supportedCapabilities: [],
    mountEffects: () => () => {},
  },
  {
    id: 'liquid-glass',
    labelKey: 'visualStyleLiquidGlass',
    supportedCapabilities: ['translucentSurfaces', 'pointerReactiveEffects', 'richBackgroundEffects'],
    mountEffects: mountLiquidGlassEffects,
  },
];

export function isVisualStyleId(value: unknown): value is VisualStyleId {
  return visualStyles.some((style) => style.id === value);
}

export function getVisualStyle(id: VisualStyleId): VisualStyleDefinition {
  return visualStyles.find((style) => style.id === id) ?? visualStyles[0];
}
