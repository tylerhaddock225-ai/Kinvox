// Server-only thin wrapper over the Anthropic SDK. The single point where the
// Kinvox app talks to Claude — every AI feature goes through here so the model
// string, token accounting, and API-key handling live in one place.
//
// Model is pinned to Haiku 4.5 (claude-haiku-4-5) per the locked AI pricing.
// Haiku 4.5 does not support adaptive thinking or the effort parameter, so we
// send a plain non-thinking, non-streaming request with a modest max_tokens —
// reply drafts are short, and non-streaming keeps this a single awaited call.

import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

// Locked model + a sensible cap for a single support/review reply draft.
const CLAUDE_MODEL = 'claude-haiku-4-5'
const MAX_TOKENS   = 1024

export type ClaudeReply = {
  text:      string
  tokensIn:  number
  tokensOut: number
  model:     string
}

/**
 * Send a one-shot system + user prompt to Claude and return the text plus the
 * input/output token counts (for ai_usage_log). Throws on an unset API key or
 * any SDK/transport error — callers decide how to surface a failure.
 */
export async function generateClaudeReply(
  systemPrompt: string,
  userContent:  string,
): Promise<ClaudeReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set in environment variables.')
  }

  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userContent }],
  })

  // response.content is a discriminated union — keep only the text blocks.
  const text = response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()

  return {
    text,
    tokensIn:  response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
    model:     response.model,
  }
}
