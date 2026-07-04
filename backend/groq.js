const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";

function localSummary(conflict) {
  const { containerId, computeWasteMs, fractionalCapacityMissedPercent } = conflict;
  return (
    `Two coordinators reached ${containerId || "the same container"} within milliseconds of each other. ` +
    `The slower request was rejected after ~${Number(computeWasteMs || 0).toFixed(3)}ms of wasted server ` +
    `compute, missing out on ${fractionalCapacityMissedPercent || "?"}% of that container's capacity.`
  );
}

async function explainConflict(conflict) {
  if (!process.env.GROQ_API_KEY) {
    return { insight: localSummary(conflict), source: "local" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.3,
        max_tokens: 90,
        messages: [
          {
            role: "system",
            content:
              "You are a terse dispatch-ops assistant. In one short sentence, explain a " +
              "shipment/container state conflict to a warehouse coordinator. Be concrete, " +
              "no fluff, no apology.",
          },
          { role: "user", content: JSON.stringify(conflict) },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { insight: localSummary(conflict), source: "local-fallback" };
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return { insight: text || localSummary(conflict), source: "groq" };
  } catch (err) {
    return { insight: localSummary(conflict), source: "local-fallback" };
  }
}

module.exports = { explainConflict, localSummary };
