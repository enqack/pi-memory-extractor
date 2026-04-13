import { 
  Container, 
  Text, 
  Markdown, 
  Spacer, 
  matchesKey, 
  Key,
} from "@mariozechner/pi-tui";
import { 
  getMarkdownTheme, 
  DynamicBorder 
} from "@mariozechner/pi-coding-agent";

export class SynthesisTabs {
  private activeTab = 0;
  private tabs = ["Summary", "Themes", "Relationships", "Takeaways"];
  private container = new Container();

  constructor(
    private data: any,
    private theme: any
  ) {
    this.rebuild();
  }

  private rebuild() {
    this.container.clear();
    const mdTheme = getMarkdownTheme();

    // 1. Tab Header
    const headerParts = this.tabs.map((tab, i) => {
      const label = ` [${tab}] `;
      return i === this.activeTab 
        ? this.theme.bg("selectedBg", this.theme.fg("accent", this.theme.bold(label)))
        : this.theme.fg("dim", label);
    });
    
    const headerContainer = new Container();
    let x = 1;
    for (const part of headerParts) {
        headerContainer.addChild(new Text(part, x, 0));
        x += (this.tabs[headerParts.indexOf(part)].length + 4);
    }
    this.container.addChild(headerContainer);
    this.container.addChild(new Spacer(1));
    this.container.addChild(new DynamicBorder((s: string) => this.theme.fg("accent", s)));

    // 2. Tab Content
    if (this.activeTab === 0) {
      this.container.addChild(new Text(this.theme.fg("accent", this.theme.bold(`Title: ${this.data.knowledge_title}`)), 1, 0));
      this.container.addChild(new Spacer(1));
      this.container.addChild(new Markdown(this.data.source_summary, 1, 0, mdTheme));
    } else if (this.activeTab === 1) {
      const themeMd = (this.data.themes || []).map((t: any) => `- **${t.theme}**: ${t.summary}`).join("\n");
      this.container.addChild(new Markdown(themeMd, 1, 0, mdTheme));
    } else if (this.activeTab === 2) {
      const relMd = (this.data.relationships || []).map((r: any) => `- **${r.entity_a}** → ${r.relationship_type} → **${r.entity_b}**\n  > ${r.evidence_quote}`).join("\n");
      this.container.addChild(new Markdown(relMd, 1, 0, mdTheme));
    } else {
      const takeMd = (this.data.actionable_takeaways || []).map((a: any) => `- [${a.priority}] ${a.action} (${a.owner})`).join("\n");
      this.container.addChild(new Markdown(takeMd, 1, 0, mdTheme));
    }
    
    if (this.data.deep_thoughts && this.data.deep_thoughts.length > 0 && this.activeTab === 0) {
        this.container.addChild(new Spacer(1));
        this.container.addChild(new Text(this.theme.fg("warn", `✨ Includes ${this.data.deep_thoughts.length} Deep Thought(s)`), 1, 0));
    }
  }

  public render(width: number): string[] {
    return this.container.render(width);
  }

  public handleInput(data: string, tui: any): boolean {
    if (matchesKey(data, Key.left) || matchesKey(data, "h")) {
      this.activeTab = (this.activeTab - 1 + this.tabs.length) % this.tabs.length;
      this.invalidate();
      tui.requestRender();
      return true;
    } else if (matchesKey(data, Key.right) || matchesKey(data, "l")) {
      this.activeTab = (this.activeTab + 1) % this.tabs.length;
      this.invalidate();
      tui.requestRender();
      return true;
    }
    return false;
  }

  public invalidate(): void {
    this.container.invalidate();
    this.rebuild();
  }
}
