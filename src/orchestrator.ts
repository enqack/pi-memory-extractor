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
    if (this.state.step === "analysis") {
        this.state.step = "mapping";
    } else if (this.state.step === "mapping") {
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

    let instructions = "";
    // Note: In a real environment, we'd use renderTemplate or similar. 
    // Here we'll construct it based on the current step state.
    
    if (this.state.step === "analysis") {
        instructions = `### KNOWLEDGE EXTRACTION PHASE: ANALYSIS ###\n\n**TASK:** Complete **STEP 1 (THEMATIC CATEGORIZATION)** from the Knowledge Extraction Workflow. Identify 3 dominant themes from the context below and summarize each in one concise sentence. Report these in the chat.`;
    } else if (this.state.step === "mapping") {
        instructions = `### KNOWLEDGE EXTRACTION PHASE: RELATIONSHIP MAPPING ###\n\n**TASK:** Complete **STEP 2 (KEY RELATIONSHIP MAPPING)**. Identify at least 4 entities and their relationships using the format: **[Entity A]** → **[Relationship Type]** → **[Entity B]**. Report these in the chat.`;
    } else if (this.state.step === "synthesis") {
        instructions = `### KNOWLEDGE EXTRACTION PHASE: FINAL SYNTHESIS ###\n\n**TASK:** Complete **STEP 3 (FINAL STRUCTURED SYNTHESIS)**. Populate the final JSON and call the 'submit_knowledge_synthesis' tool with the resulting packet.`;
    }

    const prompt = `[ORCHESTRATOR DIRECTIVE]\n\n${instructions}\n\n**CONTEXT:**\n${this.state.transcript}`;

    ctx.ui.setStatus("memory-extractor", `🧠 MemEx: ${this.state.step}...`);

    // Note: Do NOT use ctx.waitForIdle() here as this is often called from 
    // turn_end, which would cause a deadlock.
    try {
        await this.pi.sendUserMessage(prompt, { deliverAs: "followUp" });
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
