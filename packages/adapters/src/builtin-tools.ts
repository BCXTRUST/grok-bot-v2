import type { ConnectorTool } from "@rakazo/adapter-kit";

export const builtinAgentTools: ConnectorTool[] = [
  {
    name: "write_file",
    description: "Write a UTF-8 file into this bot's private home filesystem. The file shows up in Files.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "shell",
    description: "Run a command inside this bot's computer (the sandbox). cwd defaults to the bot home.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
      },
      required: ["command"],
    },
  },
  {
    name: "request_takeover",
    description: "Ask the user to take over the computer screen for login or human judgment. Protected input stays off the thread.",
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  {
    name: "remember",
    description: "Store a durable fact in this bot's explicit memory.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        path: { type: "string" },
      },
      required: ["content"],
    },
  },
];
