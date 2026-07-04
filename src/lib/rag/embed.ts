/**
 * Generates a 1024-dim embedding using Cohere's embed-english-v3.0.
 */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) throw new Error("COHERE_API_KEY is not set");

  const url = "https://api.cohere.ai/v1/embed";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      texts: [text],
      model: "embed-english-v3.0",
      input_type: "search_query",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cohere embed failed (${res.status}): ${err}`);
  }

  const data = await res.json() as { embeddings: number[][] };
  return data.embeddings[0]; // 1024 dimensions to match corpus_chunks.embedding vector(1024)
}
