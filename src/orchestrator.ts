import * as path from "node:path";
import * as fs from "node:fs";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
  withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";
import { PiMemoryConfig } from "./config.js";
import { renderTemplate } from "./templates.js";
import { TODAY } from "./utils.js";
import { loadPromptRaw } from "./templates.js";

export type WorkflowStep = "analysis" | "mapping" | "synthesis" | "idle";

export interface WorkflowState {
  step: WorkflowStep;
  trigger: string;
  transcript: string;
  isDeep: boolean;
  collectedData: {
    themes?: any[];
    relationships?: any[];
    synthesis?: any;
    deepThoughts?: { topic: string; content?: string }[];
  };
  lastUpdated: number;
}

const STATE_ENTRY_TYPE = "memory-orchestrator-state";

export class MemoryOrchestrator {
  private state: WorkflowState = {
    step: "idle",
    trigger: "",
    transcript: "",
    isDeep: false,
    collectedData: {},
    lastUpdated: 0,
  };

  private vaultRoot: string = "";
  private config: PiMemoryConfig | null = null;

  constructor(private pi: ExtensionAPI) {}

  public setContext(vaultRoot: string, config: PiMemoryConfig) {
    this.vaultRoot = vaultRoot;
    this.config = config;
  }

  public getState(): WorkflowState {
    return { ...this.state };
  }

  /**
   * Restores state from session entries.
   */
  public async restoreState(ctx: ExtensionContext) {
    const entries = ctx.sessionManager.getEntries();
    // Find the last state entry
    const lastEntry = entries
      .filter((e) => e.type === "custom" && (e as any).customType === STATE_ENTRY_TYPE)
      .pop();

    if (lastEntry) {
      this.state = (lastEntry as any).data as WorkflowState;
      console.log(`[MemoryOrchestrator] Restored state: ${this.state.step} (Triggered by: ${this.state.trigger})`);
    }
  }

  /**
   * Persists state to the session.
   */
  private persistState() {
    this.state.lastUpdated = Date.now();
    this.pi.appendEntry(STATE_ENTRY_TYPE, this.state);
  }

  /**
   * Initiates a new extraction workflow.
   */
  public async startExtraction(
    ctx: ExtensionContext,
    trigger: string,
    transcript: string,
    isDeep: boolean = false
  ) {
    if (this.state.step !== "idle") {
      ctx.ui.notify(`[MemoryOrchestrator] An extraction workflow is already in progress (${this.state.step}).`, "warn");
      return;
    }

    this.state = {
      step: "analysis",
      trigger,
      transcript,
      isDeep,
      collectedData: {},
      lastUpdated: Date.now(),
    };

    this.persistState();
    await this.triggerNextStep(ctx);
  }

  /**
   * Advances the workflow to the next step.
   * Called by the index when a turn ends (for chat-based steps).
   */
  public async advanceWorkflow(ctx: ExtensionContext) {
    const branch = ctx.sessionManager.getBranch();
    const lastAssistantMsg = [...branch].reverse().find(e => e.type === "message" && e.message.role === "assistant");
    
    if (!lastAssistantMsg) return;
    
    const content = typeof lastAssistantMsg.message.content === "string" 
      ? lastAssistantMsg.message.content 
      : JSON.stringify(lastAssistantMsg.message.content);

    if (this.state.step === "analysis") {
      // Basic check: did it identify themes or deep thoughts?
      // If it looks like a question or it's too short, don't advance.
      if (content.length < 50 || content.includes("?") && !content.includes("[[")) {
          console.log("[MemoryOrchestrator] Step 'analysis' seems incomplete. Not advancing.");
          return;
      }

      // Extract deep thoughts
      const markers = content.match(/\[\[deep_thought:\s*(.*?)\]\]/g);
      if (markers) {
        this.state.collectedData.deepThoughts = markers.map(m => {
          const topic = m.match(/\[\[deep_thought:\s*(.*?)\]\]/)?.[1] || "Untitled Thought";
          return { topic };
        });
      }

      this.state.step = "mapping";
    } else if (this.state.step === "mapping") {
        // Basic check: did it identify relationships? (Looking for arrows)
        if (!content.includes("→") && !content.includes("->")) {
            console.log("[MemoryOrchestrator] Step 'mapping' seems incomplete. Not advancing.");
            return;
        }
        this.state.step = "synthesis";
    } else {
        return; // Already in synthesis or idle
    }

    this.persistState();
    await this.triggerNextStep(ctx);
  }

  /**
   * Advances the workflow to the next step or finalizes it based on tool results.
   */
  public async processStepResult(ctx: ExtensionContext, result: any) {
    if (this.state.step === "idle") return;

    // In this orchestrated model, Step 3 is the only one that uses the tool for now,
    // as Step 1 & 2 are internal LLM reasoning steps.
    // However, if we wanted to enforce tool calls at each step, we'd handle them here.

    if (this.state.step === "analysis") {
        this.state.collectedData.themes = result.themes;
        this.state.step = "mapping";
    } else if (this.state.step === "mapping") {
        this.state.collectedData.relationships = result.relationships;
        this.state.step = "synthesis";
    } else if (this.state.step === "synthesis") {
        this.state.collectedData.synthesis = result;
        await this.finalizeWorkflow(ctx);
        return;
    }

    this.persistState();
    await this.triggerNextStep(ctx);
  }

  /**
   * Triggers the agent with instructions for the current step.
   */
  private async triggerNextStep(ctx: ExtensionContext) {
    if (!this.config) return;

    let prompt = "";
    
    if (this.state.step === "analysis") {
      const criteria = loadPromptRaw("deep-thoughts-criteria");
      prompt = renderTemplate("orch-step1", {
        criteria,
        transcript: this.state.transcript
      });
    } else if (this.state.step === "mapping") {
      prompt = renderTemplate("orch-step2", {
        transcript: this.state.transcript
      });
    } else if (this.state.step === "synthesis") {
      prompt = renderTemplate("orch-step3", {
        deepThoughts: this.state.collectedData.deepThoughts,
        transcript: this.state.transcript
      });
    }

    if (!prompt) return;

    ctx.ui.setStatus("memory-extractor", `🧠 MemEx: ${this.state.step}...`);

    try {
        await this.pi.sendUserMessage(`[ORCHESTRATOR DIRECTIVE]\n\n${prompt}`, { deliverAs: "followUp" });
    } catch (err) {
        console.error(`[MemoryOrchestrator] Failed to trigger agent: ${err}`);
    }
  }

  /**
   * Writes the final synthesized knowledge to the vault.
   */
  private async finalizeWorkflow(ctx: ExtensionContext) {
    if (!this.config || !this.vaultRoot) return;

    const data = this.state.collectedData.synthesis;
    if (!data) return;

    const today = TODAY();
    const dailyLogPath = path.join(this.vaultRoot, this.config.DAILY, `${today}.md`);

    const exists = fs.existsSync(dailyLogPath);
    const isEmpty = exists ? fs.readFileSync(dailyLogPath, "utf-8").trim().length === 0 : true;
    
    let content = "";
    if (isEmpty) {
      content += "---\n";
      content += `title: "Session Knowledge — ${today}"\n`;
      content += `date: ${today}\n`;
      content += `tags:\n  - daily-log\n  - pi-memory\n`;
      content += "---\n\n";
      content += `# Session Knowledge — ${today}\n`;
    }

    // Formatting the daily log entry
    content += `\n### 🧠 Automated Extraction (${this.state.trigger}) — ${new Date().toLocaleTimeString()}\n`;
    content += `**Title:** ${data.knowledge_title}\n\n`;
    content += `#### Summary\n${data.source_summary}\n\n`;
    
    content += `#### Themes\n`;
    for (const t of data.themes || []) {
        content += `- **${t.theme}**: ${t.summary}\n`;
    }

    content += `\n#### Relationships\n`;
    for (const r of data.relationships || []) {
        content += `- **${r.entity_a}** → ${r.relationship_type} → **${r.entity_b}**\n  > ${r.evidence_quote}\n`;
    }

    content += `\n#### Actionable Takeaways\n`;
    for (const a of data.actionable_takeaways || []) {
        content += `- [${a.priority}] ${a.action} (${a.owner})\n`;
    }

    try {
      await withFileMutationQueue(dailyLogPath, async () => {
        await fs.promises.appendFile(dailyLogPath, content);
      });

      // Write Deep Thoughts
      if (data.deep_thoughts && data.deep_thoughts.length > 0) {
        for (const dt of data.deep_thoughts) {
          const slug = dt.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
          const timeSuffix = new Date().toISOString().split("T")[1].replace(/:/g, "-").substring(0, 5);
          const dtFilename = `${today}-${timeSuffix}-${slug}.md`;
          const dtPath = path.join(this.vaultRoot, this.config.DEEP_THOUGHTS, dtFilename);

          const dtContent = `---
title: "${dt.topic}"
date: ${today}
type: deep-thought
---

# Deep Thought: ${dt.topic}

${dt.content}

---
*Extracted from session: ${this.state.trigger}*
`;
          await fs.promises.writeFile(dtPath, dtContent);
        }
      }

      ctx.ui.notify(`[MemoryOrchestrator] Successfully saved knowledge to ${path.basename(dailyLogPath)}`, "success");
    } catch (err) {
        ctx.ui.notify(`[MemoryOrchestrator] Failed to save knowledge: ${(err as Error).message}`, "error");
    }

    // Reset state
    this.state = {
      step: "idle",
      trigger: "",
      transcript: "",
      isDeep: false,
      collectedData: {},
      lastUpdated: Date.now(),
    };
    this.persistState();
    ctx.ui.setStatus("memory-extractor", "🧠 MemEx: idle");
  }
}
