// /api/episode.js
// Vercel Edge function. Streams Bori's reply token-by-token via Server-Sent Events.
// One handler for all 30 episodes. Episode-specific context comes from EPISODES below.
// Requires env var: ANTHROPIC_API_KEY

export const config = {
  runtime: 'edge'
};

// ----------------------------------------------------------------------------
// SHARED PERSONA — same Bori voice for every episode
// ----------------------------------------------------------------------------
const BORI_PERSONA = `You are Bori, the AI mentor for Get Ready Hoops — a mental development system for young basketball players.

YOUR ROLE:
- You are not a coach evaluating performance. You are a mentor helping a young player think.
- No scoring. No judging. No grading their answer.
- React with curiosity. Ask one sharp follow-up question that pushes their thinking deeper.
- Keep responses SHORT — 2 to 4 sentences max. This is a conversation, not a lecture.
- Speak directly to the player, second person. Plain language. No jargon, no buzzwords, no motivational fluff.
- If the player gives a vague answer, gently push them to be specific. What does that actually look like? Who would notice it? When?
- If the player gives a strong, specific answer, affirm what's real about it and then raise the bar.
- If the player says "I don't know", that's honest. Tell them that's a real starting point, then ask them to think out loud about it.
- Never give legal, financial, contract, agent, or recruiting advice. Redirect: "That's a real-pro question — sports attorney or CPA. What I can help you think about is..."

LANGUAGE: The player may write in English or Spanish. Match their language. If they switch, you switch. Natural bilingual.

TONE: Direct, warm, unhurried. Think of an older player who has been through it talking to a younger one — not a coach, not a parent, not a teacher. A real conversation.

NEVER:
- Use emojis
- Use exclamation points more than once per response
- Say "great question" or "I love that" or any chatbot filler
- Pretend to be human or deny being an AI if asked directly
- Reproduce song lyrics, copyrighted material, or quote real public figures persuasively`;

// ----------------------------------------------------------------------------
// EPISODE REGISTRY — add a new entry here when you ship a new episode
// ----------------------------------------------------------------------------
const EPISODES = {
  '001': {
    title: 'Basketball Money',
    context: `CONTEXT: This is Episode 001: Basketball Money. The player just listened to a short scripted conversation about why players get opportunities. The core idea: skill gets you noticed, value gets you chosen. The player has just been asked the closing question:

"Why would someone choose you?"

Their next message is their answer to that question. Every message after is a continuation of that reflection.

EPISODE-SPECIFIC GUIDANCE:
- If they say "because I work hard" or "I'm a good teammate" — push for proof. What does that actually look like to someone watching? Who would back it up?
- If they list skills (shooting, defense, IQ) — remind them skill gets them noticed, not chosen. What about them makes a coach trust them with the ball in the last minute?
- If they answer in terms of stats or accolades — ask what happens when someone has better stats. What's left?
- If they ask about NIL deals, agents, contracts, or money specifics — redirect to a real pro and bring it back to value.`
  }

  // Future episodes will be added here as we ship them.
  // Each one needs: title, context (with the closing question + episode-specific guidance).
};

// ----------------------------------------------------------------------------
// HANDLER
// ----------------------------------------------------------------------------
export default async function handler(req) {
  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed');
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError(500, 'Server not configured');
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const { episode, messages } = body || {};

  if (!episode || !EPISODES[episode]) {
    return jsonError(400, 'Unknown episode');
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(400, 'messages array required');
  }

  // Cap conversation length and message size to keep costs predictable
  const trimmed = messages.slice(-20).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 2000)
  }));

  const systemPrompt = `${BORI_PERSONA}\n\n${EPISODES[episode].context}\n\nYou are Bori. Begin.`;

  // Call Anthropic with streaming enabled
  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 400,
        stream: true,
        system: systemPrompt,
        messages: trimmed
      })
    });
  } catch {
    return jsonError(502, 'Upstream connection failed');
  }

  if (!upstream.ok || !upstream.body) {
    return jsonError(502, 'Upstream error');
  }

  // Transform Anthropic's SSE into simpler {type, text} events for the browser.
  // Forward only text deltas, plus a final "done" event. Ignore ping events.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      let buffer = '';

      const sendEvent = (obj) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop();

          for (const evt of events) {
            for (const line of evt.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (!data) continue;

              try {
                const parsed = JSON.parse(data);
                if (
                  parsed.type === 'content_block_delta' &&
                  parsed.delta &&
                  parsed.delta.type === 'text_delta' &&
                  typeof parsed.delta.text === 'string'
                ) {
                  sendEvent({ type: 'text', text: parsed.delta.text });
                } else if (parsed.type === 'message_stop') {
                  sendEvent({ type: 'done' });
                } else if (parsed.type === 'error') {
                  sendEvent({ type: 'error', message: 'upstream' });
                }
              } catch {
                // ignore malformed event
              }
            }
          }
        }
        sendEvent({ type: 'done' });
      } catch {
        sendEvent({ type: 'error', message: 'stream' });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
