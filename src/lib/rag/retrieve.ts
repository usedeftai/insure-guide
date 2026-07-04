import { createAdminClient } from "../supabase";
import { createComponentLogger } from "../logger";

const log = createComponentLogger("retrieve");

export interface SearchResult {
  id: string;
  content: string;
  source_id: string;
  program: string[];
  status_tags: string[];
  content_type: string;
  urgency: number;
  similarity: number;
  /** Populated by a secondary query to corpus_sources */
  source_url: string | null;
  /** Populated by a secondary query to corpus_sources */
  source_title: string | null;
}

interface CorpusSource {
  id: string;
  source_url: string | null;
  title: string | null;
}

/**
 * Retrieves relevant context chunks from Supabase using vector similarity.
 * Filters by program and status tags (eligibility-based pre-filtering in SQL).
 * Enriches each result with source_url and source_title from corpus_sources.
 */
export async function retrieveChunks(
  embedding: number[],
  matchCount: number = 8,
  filterPrograms?: string[],
  filterStatuses?: string[],
  filterStates?: string[]
): Promise<SearchResult[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    match_count: matchCount,
    filter_programs: filterPrograms ?? null,
    filter_statuses: filterStatuses ?? null,
    filter_states: filterStates ?? null,
  });

  if (error) {
    log.error("match_chunks rpc failed", {
      error: error.message,
      matchCount,
      filterPrograms,
      filterStatuses,
      filterStates,
    });
    throw error;
  }

  const chunks = (data ?? []) as Omit<SearchResult, "source_url" | "source_title">[];

  if (chunks.length === 0) {
    return [];
  }

  // Enrich with source metadata (URL + title) via a secondary query
  const sourceIds = [...new Set(chunks.map((c) => c.source_id).filter(Boolean))];

  let sourceMap: Record<string, CorpusSource> = {};
  if (sourceIds.length > 0) {
    const { data: sources, error: srcError } = await supabase
      .from("corpus_sources")
      .select("id, source_url, title")
      .in("id", sourceIds);

    if (srcError) {
      log.warn("corpus source enrichment failed", {
        error: srcError.message,
        sourceIdCount: sourceIds.length,
      });
    } else if (sources) {
      sourceMap = Object.fromEntries((sources as CorpusSource[]).map((s) => [s.id, s]));
    }
  }

  return chunks.map((chunk) => ({
    ...chunk,
    source_url: sourceMap[chunk.source_id]?.source_url ?? null,
    source_title: sourceMap[chunk.source_id]?.title ?? null,
  }));
}
