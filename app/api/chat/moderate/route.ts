import { generateText, Output } from 'ai'
import { checkBotId } from 'botid/server'
import { z } from 'zod'

// Chat moderation endpoint. Every chat bubble passes through here before it
// is broadcast to the room: first a cheap in-memory rate limit, then a fast
// AI moderation pass. The client only publishes the message if this returns
// { ok: true }.

const MAX_LENGTH = 120

// ---- Rate limiting -------------------------------------------------------
// In-memory sliding windows keyed by IP. Note: on serverless this state is
// per-instance, so the effective global limit can be a bit looser under
// scale — still plenty to stop spam floods from a single client.
const BURST_WINDOW_MS = 3_000 // short window...
const BURST_MAX = 2 // ...allows at most 2 messages per 3s
const SUSTAINED_WINDOW_MS = 60_000 // long window...
const SUSTAINED_MAX = 15 // ...and 15 messages per minute

const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const stamps = (hits.get(ip) ?? []).filter((t) => now - t < SUSTAINED_WINDOW_MS)
  const burst = stamps.filter((t) => now - t < BURST_WINDOW_MS)
  const limited = burst.length >= BURST_MAX || stamps.length >= SUSTAINED_MAX
  if (!limited) {
    stamps.push(now)
    hits.set(ip, stamps)
  }
  // Opportunistic cleanup so the map can't grow unbounded.
  if (hits.size > 5_000) {
    for (const [key, value] of hits) {
      if (value.every((t) => now - t >= SUSTAINED_WINDOW_MS)) hits.delete(key)
    }
  }
  return limited
}

// ---- AI moderation -------------------------------------------------------
const moderationSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().nullable(),
})

const CHAT_SYSTEM = `You are a chat moderator for a cozy multiplayer shopping game played by all ages.
Players send short messages that appear as speech bubbles over their avatars.

Block messages containing: slurs or hate speech, sexual content, harassment or bullying,
threats or violence, self-harm content, doxxing or personal information (phone numbers,
addresses, emails), spam/scam links, or attempts to impersonate system messages.

Allow: casual conversation, mild exclamations, jokes, game talk, shopping talk,
greetings in any language, and harmless slang. Mild profanity used non-aggressively
(e.g. "this is damn cool") is fine. Be permissive with borderline cases — only block
clear violations. Judge messages in ANY language.`

const NAME_SYSTEM = `You are moderating player display names for a cozy multiplayer
shopping game played by all ages. The name floats over the player's avatar and is
visible to everyone.

Block names containing: slurs or hate speech (including leetspeak/obfuscated spellings),
sexual or crude content, harassment, references to violence or self-harm, personal
information, impersonation of staff/system (e.g. "Admin", "Moderator", "System"),
or URLs/promotions.

Allow: normal names and nicknames, game-style handles, words in any language,
numbers, and playful names. Be permissive — only block clear violations.`

async function moderate(text: string, kind: 'chat' | 'name'): Promise<{ allowed: boolean }> {
  try {
    const { output } = await generateText({
      model: 'google/gemini-3.1-flash-lite',
      system: kind === 'name' ? NAME_SYSTEM : CHAT_SYSTEM,
      prompt: kind === 'name' ? `Player name: "${text}"` : `Message: "${text}"`,
      output: Output.object({ schema: moderationSchema }),
      maxOutputTokens: 100,
      temperature: 0,
      abortSignal: AbortSignal.timeout(4_000),
    })
    return { allowed: output.allowed }
  } catch {
    // Fail-open: if the model is slow or down, don't kill the chat. The rate
    // limit above still bounds abuse volume.
    return { allowed: true }
  }
}

// ---- Route ----------------------------------------------------------------
export async function POST(req: Request) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'

  if (rateLimited(ip)) {
    return Response.json(
      { ok: false, reason: 'rate_limited' },
      { status: 429 },
    )
  }

  let text: unknown
  let kindRaw: unknown
  try {
    ;({ text, kind: kindRaw } = await req.json())
  } catch {
    return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 })
  }

  if (typeof text !== 'string') {
    return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 })
  }

  const kind: 'chat' | 'name' = kindRaw === 'name' ? 'name' : 'chat'

  // Block bots from the chat path only. Chat is the high-volume, AI-billed
  // surface, so a flood here is what runs up the model bill. Name validation
  // (the entry gate) is intentionally exempt: a false positive there would
  // lock a real player out of the game entirely, which is never worth it.
  if (kind === 'chat') {
    const verification = await checkBotId()
    if (verification.isBot) {
      return Response.json({ ok: false, reason: 'blocked' }, { status: 200 })
    }
  }

  let clean: string
  if (kind === 'name') {
    // Names get stricter sanitization: strip control/invisible chars that
    // could be used to render blank or spoofed name tags, collapse
    // whitespace, and cap at the same 18-char limit the input enforces.
    clean = text
      .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 18)
  } else {
    clean = text.trim().slice(0, MAX_LENGTH)
  }
  if (!clean) {
    return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 })
  }

  const { allowed } = await moderate(clean, kind)
  if (!allowed) {
    return Response.json({ ok: false, reason: 'blocked' }, { status: 200 })
  }

  return Response.json({ ok: true, text: clean })
}
