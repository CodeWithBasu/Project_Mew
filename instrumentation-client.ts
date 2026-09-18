import { initBotId } from 'botid/client/core'

// Tell BotID which requests to attach a challenge to. Only the chat moderation
// route is protected: it is the path that calls the AI Gateway per request, so
// it is the one worth shielding from automated floods. Entry/name validation is
// deliberately left unprotected so a false positive can never lock a real
// player out of the game (see app/api/chat/moderate/route.ts).
initBotId({
  protect: [{ path: '/api/chat/moderate', method: 'POST' }],
})
