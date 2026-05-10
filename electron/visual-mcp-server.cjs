const tools = [
  {
    name: "compose_visual_response",
    description:
      "Turn a local assistant response into a visual-first HermHerm artifact.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        response: { type: "string" },
        mode: { type: "string", enum: ["ask", "build", "analyze"] },
        model: { type: "string" },
        runtimeReady: { type: "boolean" },
        durationMs: { type: "number" },
      },
      required: ["prompt", "response"],
    },
  },
  {
    name: "create_status_panel",
    description: "Create a compact runtime status panel for the app HUD.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_plan_board",
    description: "Create a visual task board from text.",
    inputSchema: {
      type: "object",
      properties: { response: { type: "string" } },
      required: ["response"],
    },
  },
  {
    name: "create_timeline",
    description: "Create a timeline from steps or sequential text.",
    inputSchema: {
      type: "object",
      properties: { response: { type: "string" } },
      required: ["response"],
    },
  },
  {
    name: "create_comparison_grid",
    description: "Create a compact comparison grid from answer text.",
    inputSchema: {
      type: "object",
      properties: { response: { type: "string" } },
      required: ["response"],
    },
  },
];

const modeLabels = {
  ask: "Ask",
  build: "Build",
  analyze: "Analyze",
};

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function compactLine(line) {
  return line
    .replace(/^[-*•]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^#+\s*/, "")
    .trim();
}

function pickLines(text, limit = 6) {
  const lines = normalizeText(text)
    .split("\n")
    .map(compactLine)
    .filter((line) => line.length > 0 && !line.startsWith("```"));

  if (lines.length > 0) {
    return lines.slice(0, limit);
  }

  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function clampText(text, max = 190) {
  const value = normalizeText(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}...`;
}

function titleFromPrompt(prompt) {
  const cleaned = compactLine(prompt)
    .replace(/\?+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "Local Response";
  if (cleaned.length <= 54) return cleaned;
  return `${cleaned.slice(0, 51).trim()}...`;
}

function scoreForText(text) {
  const length = normalizeText(text).length;
  if (length < 300) return 58;
  if (length < 900) return 74;
  if (length < 1600) return 86;
  return 94;
}

function createTimeline(response, mode = "ask") {
  const lines = pickLines(response, 5);
  const fallback = {
    ask: [
      "Request received",
      "Local model response composed",
      "Visual artifact generated",
    ],
    build: [
      "Scope identified",
      "Implementation path formed",
      "Next actions prepared",
    ],
    analyze: [
      "Signal collected",
      "Risk pass completed",
      "Readable summary prepared",
    ],
  };

  const source = lines.length >= 3 ? lines : (fallback[mode] ?? fallback.ask);
  return source.slice(0, 5).map((line, index) => ({
    id: `step-${index + 1}`,
    label:
      index === 0
        ? "Input"
        : index === source.length - 1
          ? "Output"
          : "Process",
    title: clampText(line, 72),
    detail:
      index === source.length - 1 ? "Ready for review" : "Local Gemma runtime",
    state: index === source.length - 1 ? "ready" : "complete",
  }));
}

function createCards({ prompt, response, mode = "ask", durationMs }) {
  const lines = pickLines(response, 8);
  const primary = lines[0] ?? "The local model returned a response.";
  const secondary = lines.slice(1, 4);
  const actionLines = lines.slice(4, 8);

  const cards = [
    {
      id: "primary",
      kind: "summary",
      eyebrow: `${modeLabels[mode] ?? "Ask"} synthesis`,
      title: "Main readout",
      body: clampText(primary, 240),
      items:
        secondary.length > 0
          ? secondary.map((line) => clampText(line, 110))
          : [],
      intensity: scoreForText(response),
    },
    {
      id: "runtime",
      kind: "status",
      eyebrow: "Local system",
      title: "Private runtime",
      body: "Generated locally through the isolated hermherm profile.",
      items: [
        "Gemma local model",
        "Hermes profile stays separate",
        durationMs
          ? `${Math.round(durationMs / 1000)}s response window`
          : "Visual MCP pass",
      ],
      intensity: 82,
    },
  ];

  if (mode === "build" || actionLines.length > 0) {
    cards.push({
      id: "actions",
      kind: "plan",
      eyebrow: "Action map",
      title: mode === "build" ? "Build path" : "Next moves",
      body: actionLines[0]
        ? clampText(actionLines[0], 180)
        : "Use this response as a starting point, then refine the result.",
      items:
        actionLines.length > 1
          ? actionLines.slice(1).map((line) => clampText(line, 100))
          : ["Review", "Adjust", "Run again"],
      intensity: 76,
    });
  }

  if (mode === "analyze") {
    cards.push({
      id: "signals",
      kind: "scan",
      eyebrow: "Scan",
      title: "Signals to watch",
      body: "The analysis mode is tuned to surface useful risk, confidence, and follow-up signals.",
      items: ["Assumptions", "Tradeoffs", "Open questions"],
      intensity: 69,
    });
  }

  if (normalizeText(response).length < 40) {
    cards.push({
      id: "thin-output",
      kind: "warning",
      eyebrow: "Low detail",
      title: "Short response",
      body: "The model returned a very small answer, so the visual layer has less to work with.",
      items: ["Ask for a plan", "Ask for a comparison", "Ask for a breakdown"],
      intensity: 44,
    });
  }

  return cards;
}

function createVisualPayload(args = {}) {
  const prompt = normalizeText(args.prompt);
  const response = normalizeText(args.response);
  const mode = ["ask", "build", "analyze"].includes(args.mode)
    ? args.mode
    : "ask";
  const durationMs = Number(args.durationMs || 0) || undefined;
  const cards = createCards({ prompt, response, mode, durationMs });
  const timeline = createTimeline(response, mode);

  return {
    version: 1,
    source: "hermherm-visual-mcp",
    mode,
    headline: titleFromPrompt(prompt),
    subtitle:
      mode === "build"
        ? "Build-focused visual response"
        : mode === "analyze"
          ? "Analysis-focused visual response"
          : "Visual response from the local assistant",
    intent:
      mode === "build" ? "construct" : mode === "analyze" ? "scan" : "query",
    cards,
    timeline,
    metrics: [
      {
        label: "Model",
        value: args.model || "local",
        tone: "warm",
      },
      {
        label: "Visual MCP",
        value: "active",
        tone: "green",
      },
      {
        label: "Runtime",
        value: args.runtimeReady === false ? "starting" : "local",
        tone: args.runtimeReady === false ? "amber" : "green",
      },
      {
        label: "Latency",
        value: durationMs
          ? `${Math.max(1, Math.round(durationMs / 1000))}s`
          : "ready",
        tone: "warm",
      },
    ],
    rawText: response,
  };
}

function toolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
    structuredContent: payload,
  };
}

function callVisualTool(name, args = {}) {
  if (name === "compose_visual_response") {
    return createVisualPayload(args);
  }

  if (name === "create_timeline") {
    return { timeline: createTimeline(args.response, args.mode) };
  }

  if (name === "create_plan_board") {
    return {
      cards: createCards({
        prompt: "Plan board",
        response: args.response,
        mode: "build",
      }),
    };
  }

  if (name === "create_comparison_grid") {
    return {
      cards: createCards({
        prompt: "Comparison",
        response: args.response,
        mode: "analyze",
      }),
    };
  }

  if (name === "create_status_panel") {
    return {
      metrics: [
        { label: "Visual MCP", value: "active", tone: "green" },
        { label: "Interface", value: "visual-first", tone: "warm" },
      ],
    };
  }

  throw new Error(`Unknown visual MCP tool: ${name}`);
}

function handleRequest(request) {
  const { id, method, params = {} } = request;

  if (method === "initialize") {
    return {
      id,
      jsonrpc: "2.0",
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "hermherm-visuals", version: "0.1.0" },
        capabilities: { tools: {} },
      },
    };
  }

  if (method === "tools/list") {
    return { id, jsonrpc: "2.0", result: { tools } };
  }

  if (method === "tools/call") {
    const payload = callVisualTool(params.name, params.arguments ?? {});
    return { id, jsonrpc: "2.0", result: toolResult(payload) };
  }

  return {
    id,
    jsonrpc: "2.0",
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

function runStdioServer() {
  let buffer = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const request = JSON.parse(line);
        const response = handleRequest(request);
        process.stdout.write(`${JSON.stringify(response)}\n`);
      } catch (error) {
        process.stdout.write(
          `${JSON.stringify({
            id: null,
            jsonrpc: "2.0",
            error: {
              code: -32700,
              message: error instanceof Error ? error.message : String(error),
            },
          })}\n`,
        );
      }
    }
  });
}

if (require.main === module) {
  runStdioServer();
}

module.exports = {
  callVisualTool,
  createVisualPayload,
  handleRequest,
  tools,
};
