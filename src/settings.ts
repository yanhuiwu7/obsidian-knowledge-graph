import { App, PluginSettingTab, Setting } from "obsidian";
import type KnowledgeGraphPlugin from "./main";

export class KnowledgeGraphSettingTab extends PluginSettingTab {
  plugin: KnowledgeGraphPlugin;

  constructor(app: App, plugin: KnowledgeGraphPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Graph viz")
      .setHeading();

    containerEl.createEl("p", {
      text: "Now supports defining and previewing knowledge graphs directly in Markdown files using ```knowledgegraph code blocks. Simply write triple relations with the specified syntax in the code block.",
      cls: "kg-settings-tip",
    });

    new Setting(containerEl)
      .setName("Show node labels")
      .setDesc("Display or hide node name labels in the graph")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showLabels)
          .onChange(async (value) => {
            this.plugin.settings.showLabels = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
