/**
 * `@nexa/providers` — model provider adapters behind one interface.
 *
 * Every provider implements `LanguageModelPort` from `@nexa/core`. Nothing
 * outside this package names a provider SDK, which is what keeps the companion
 * itself independent of which model is answering.
 */
export type { AnthropicProviderOptions } from './anthropic.js';
export { AnthropicLanguageModel } from './anthropic.js';

export type { GroqProviderOptions, FetchLike } from './groq.js';
export { GroqLanguageModel } from './groq.js';

export { ScriptedLanguageModel, HeuristicTokenEstimator } from './scripted.js';

export type { OpenAiEmbeddingOptions } from './openai-embeddings.js';
export { OpenAiEmbeddingProvider } from './openai-embeddings.js';

export { ScriptedEmbeddingProvider } from './scripted-embeddings.js';
