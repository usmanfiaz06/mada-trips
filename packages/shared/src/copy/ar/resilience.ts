import type { resilienceCopy } from '../resilience';
import type { ArSection } from './types';

export const arResilience: ArSection<typeof resilienceCopy> = {};
