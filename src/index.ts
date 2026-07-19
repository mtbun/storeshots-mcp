#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ALL_TOOLS } from "./tools/definitions.js";

const server = new McpServer({ name: "storeshots", version: "0.1.0" });

for (const tool of ALL_TOOLS) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema },
    async (args: Record<string, unknown>) => {
      try {
        const result = await tool.handler(args ?? {});
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
