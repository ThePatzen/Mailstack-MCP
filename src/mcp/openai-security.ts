import type { McpServer } from '@modelcontextprotocol/server';

type ListedTool = { _meta?: Record<string, unknown>; [key: string]: unknown };
type ToolListResult = { tools?: ListedTool[]; [key: string]: unknown };
type RequestHandler = (...args: unknown[]) => unknown;

/** Adds OpenAI's per-tool OAuth declaration to the SDK's serialized tool list. */
export function exposeOpenAiToolSecuritySchemes(server: McpServer): void {
  // SDK 2.3.1 serializes tool _meta but has no public hook for this OpenAI extension.
  const protocol = server.server as unknown as {
    _requestHandlers?: Map<string, RequestHandler>;
  };
  const handlers = protocol._requestHandlers;
  const original = handlers?.get('tools/list');
  if (!handlers || !original) throw new Error('The MCP SDK tools/list handler is unavailable.');

  handlers.set('tools/list', async (...args) => {
    const result = await original(...args);
    if (!result || typeof result !== 'object' || !Array.isArray((result as ToolListResult).tools)) return result;
    const toolList = result as ToolListResult;
    return {
      ...toolList,
      tools: toolList.tools!.map((tool) => {
        const schemes = tool._meta?.securitySchemes;
        return Array.isArray(schemes) ? { ...tool, securitySchemes: schemes } : tool;
      }),
    };
  });
}
