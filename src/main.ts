import { Plugin, MarkdownPostProcessorContext, Component } from "obsidian";
import { PluginSettings, DEFAULT_SETTINGS } from "./types";
import { KnowledgeGraphSettingTab } from "./settings";
import { CodeBlockRenderer } from "./codeblock";

export const CODEBLOCK_LANG = "knowledgegraph";

export default class KnowledgeGraphPlugin extends Plugin {
  settings: PluginSettings;

  async onload() {
    await this.loadSettings();

    // Register knowledgegraph code block processor (render graph in preview mode)
    this.registerMarkdownCodeBlockProcessor(
      CODEBLOCK_LANG,
      async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        const component = new Component();
        component.load();
        ctx.addChild(component);
        const renderer = new CodeBlockRenderer(this.app, component);
        await renderer.render(source, el, ctx);
      }
    );

    // Settings tab
    this.addSettingTab(new KnowledgeGraphSettingTab(this.app, this));
  }

  onunload() {
    // Nothing to clean up
  }

  // ============================================
  // Settings
  // ============================================
  async loadSettings() {
    const saved = await this.loadData() as Partial<PluginSettings>;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
