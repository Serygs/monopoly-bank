import type { PropertyGroupId } from '../../shared/board';

/** `ALL`, `FREE` (no owner) or one player's id. */
export type OwnerFilter = 'ALL' | 'FREE' | (string & {});

export interface PropertyFilterState {
  owner: OwnerFilter;
  groups: readonly PropertyGroupId[];
}

export const noPropertyFilters: PropertyFilterState = { owner: 'ALL', groups: [] };

/** How many filters are active: the owner filter and every picked group. */
export function activeFilterCount(filters: PropertyFilterState): number {
  return (filters.owner === 'ALL' ? 0 : 1) + filters.groups.length;
}
