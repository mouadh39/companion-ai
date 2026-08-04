/**
 * `@nexa/memory` — what should be remembered, and why.
 *
 * Formation only. No database, no embeddings, no retrieval, no prompts, no
 * model calls. It answers one question about one proposal: does this earn a
 * place, and if so as what?
 *
 * ```ts
 * decide(request)              → FormationDecision   // store | reinforce | supersede | reject
 * forgetCheck(memory, at)      → ForgetDecision | null
 * ```
 *
 * Both are pure and total — no clock, no randomness, no throw. `at` is always
 * supplied and `existing` is always passed in, which is what makes a formation
 * history replayable: re-running a user's proposals reconstructs exactly the
 * store they have.
 *
 * ## Retrieval is somebody else's job
 *
 * `FormationRequest.existing` is supplied by the caller rather than looked up.
 * Deciding what to remember and finding what is already remembered are
 * different problems, and fusing them would make this engine impossible to test
 * without a store — and impossible to reason about when the store is slow.
 *
 * ## Two taxonomies, deliberately
 *
 * `MemoryType` (episodic, semantic, …) says how a memory is encoded and so how
 * it is *retrieved*. `MemorySubject` (identity, preference, milestone, …) says
 * what it is about and so how long it *lives*. They cross freely, and retention
 * policy attaches to the subject.
 *
 * ## Conservative under uncertainty
 *
 * Similarity here is lexical, because semantic comparison needs embeddings this
 * engine may not use. So the failure it is tuned toward is storing a duplicate
 * rather than discarding something true — retrieval will surface both and
 * reflection can merge them, whereas a wrongly-dropped memory is gone and
 * nobody notices.
 */

export type { FormationRequest } from './formation.js';
export { decide } from './formation.js';

export { forgetCheck, forgetPass, DECAY_FLOOR } from './forgetting.js';

export type { SubjectPolicy } from './subjects.js';
export { SUBJECT_POLICIES, policyFor } from './subjects.js';

export { classify } from './classify.js';

export {
  SOURCE_CONFIDENCE,
  confidenceFor,
  importanceFor,
  decayedImportance,
  retentionDays,
} from './scoring.js';

export type { Relatedness } from './similarity.js';
export {
  tokenize,
  similarity,
  negates,
  relatednessTo,
  DUPLICATE_THRESHOLD,
  RELATED_THRESHOLD,
} from './similarity.js';
