export function text(message: string) {
  return { content: [{ type: "text" as const, text: message }] };
}

export function error(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true as const };
}
