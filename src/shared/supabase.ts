import { createClient } from "@supabase/supabase-js";
import type {
  PullResponse,
  PushResponse,
  TranslateResponse,
  ValidateResponse,
} from "./types.js";

const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";

type Action = "validate" | "push" | "pull" | "translate";

type ActionResponseMap = {
  validate: ValidateResponse;
  push: PushResponse;
  pull: PullResponse;
  translate: TranslateResponse;
};

export async function callCliSync<T extends Action>(
  action: T,
  params: Record<string, unknown>,
  apiKey: string,
): Promise<ActionResponseMap[T]> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data, error } = await client.functions.invoke("cli-sync", {
    body: { action, params },
    headers: { "x-i1n-key": apiKey },
  });

  if (error) {
    throw new Error(error.message ?? `Request failed: ${action}`);
  }

  return data as ActionResponseMap[T];
}
