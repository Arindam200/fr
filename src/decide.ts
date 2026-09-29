// The only file that knows how to talk to the decision model: TypeSafe's Jev.
// decide() = "smart if-else": pick one of N predefined answers, with a confidence.
// Spec: https://docs.typesafe.ai/api  (POST /v1/systemone, "choice" question)

export type Decision<A extends string> = {
  answer: A;
  confidence: number; // 0..1, Jev's probability for the chosen answer
  latencyMs: number;
  model: string; // dated snapshot Jev actually used, e.g. jev-1.13.0
  inputTokens: number;
};

export type DecideInput<A extends string> = {
  question: string;
  answers: readonly A[];
  // Jev requires a description for every option; missing ones fall back to the answer name.
  criteria?: Partial<Record<A, string>>;
  context: { text: string; imageUrl?: string };
};

export type JevConfig = { apiKey: string; url: string; model: string };

const QUESTION_ID = "decision";

// Reads config from the environment and fails fast if the key is missing.
export function jevConfig(): JevConfig {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set (get one at https://typesafe.ai, put it in .env)");
  return {
    apiKey,
    url: process.env.JEV_URL ?? "https://api.typesafe.ai/v1/systemone",
    model: process.env.JEV_MODEL ?? "jev-latest",
  };
}

export async function decide<A extends string>(
  input: DecideInput<A>,
  cfg: JevConfig,
  signal?: AbortSignal,
): Promise<Decision<A>> {
  const criteria = Object.fromEntries(input.answers.map((a) => [a, input.criteria?.[a] ?? a]));
  const state = input.context.imageUrl
    ? { text: input.context.text, image_url: input.context.imageUrl }
    : input.context.text;

  const start = performance.now();
  const res = await fetch(cfg.url, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      state,
      questions: {
        [QUESTION_ID]: { type: "choice", instructions: input.question, criteria },
      },
    }),
  });
  if (!res.ok) throw new Error(`Jev API ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  const latencyMs = Math.round(performance.now() - start);

  const typed = json.answers?.[QUESTION_ID];
  const answer = typed?.choice;
  if (!input.answers.includes(answer)) {
    throw new Error(`Unexpected Jev response: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return {
    answer,
    confidence: typed.probabilities?.[answer] ?? typed.confidence ?? 0,
    latencyMs,
    model: json.model ?? cfg.model,
    inputTokens: json.usage?.input_tokens ?? 0,
  };
}
