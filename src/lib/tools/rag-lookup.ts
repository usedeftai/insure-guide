import { buildContext } from "../rag/build-context";
import { embedText } from "../rag/embed";
import { retrieveChunks } from "../rag/retrieve";

export interface RagLookupInput {
  query: string;
  matchCount?: number;
  state?: string;
}

export async function executeRagLookup(input: RagLookupInput) {
  const embedding = await embedText(input.query);
  const filterStates = input.state ? [input.state, "all"] : undefined;

  const chunks = await retrieveChunks(
    embedding,
    input.matchCount ?? 5,
    undefined,
    undefined,
    filterStates
  );

  return {
    context: buildContext(chunks),
    sources: chunks.map((chunk) => ({
      id: chunk.id,
      content: chunk.content,
      program: chunk.program,
      content_type: chunk.content_type,
      similarity: chunk.similarity,
    })),
  };
}
