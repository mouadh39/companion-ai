/**
 * Structural contracts, and nothing that performs work.
 *
 * No repositories, no services, no ports. Ports are declared by `@nexa/core`
 * because the layer that *orchestrates* must own the interfaces it calls —
 * putting them here would make the vocabulary a hub that changes whenever a
 * capability changes. What lives here is shape: what it means to be an entity,
 * to be owned by a user, to be paginated.
 */
export type { Entity, Created, Updated, UserOwned, Versioned, Uncertain } from './entity.js';

export type { Page, PageRequest, PageDirection } from './page.js';
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, firstPage } from './page.js';
