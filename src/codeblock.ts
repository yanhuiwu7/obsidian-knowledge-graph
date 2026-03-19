import { MarkdownRenderer, Component, App, MarkdownPostProcessorContext, TFile } from "obsidian";
import { GraphConfig, GraphNode, GraphLink } from "./types";
import { parseCodeBlock, serializeToCodeBlock } from "./parser";

// Auto-assigned color palette
const AUTO_COLOR_PALETTE = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444",
  "#3b82f6", "#ec4899", "#14b8a6", "#f97316",
  "#8b5cf6", "#06b6d4", "#84cc16", "#a855f7",
];
const DEFAULT_FALLBACK_COLOR = "#64748b";

// ============================================
// Ensure D3 is loaded (global singleton)
// ============================================
let d3LoadPromise: Promise<any> | null = null;

export function ensureD3(): Promise<any> {
  if ((window as any).d3) return Promise.resolve((window as any).d3);
  if (d3LoadPromise) return d3LoadPromise;

  d3LoadPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://d3js.org/d3.v7.min.js";
    script.onload = () => {
      d3LoadPromise = null;
      resolve((window as any).d3);
    };
    script.onerror = () => {
      d3LoadPromise = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });

  return d3LoadPromise;
}

// ============================================
// Code block renderer
// Renders knowledgegraph code blocks as interactive D3 graphs
// in Obsidian reading/preview mode
// ============================================
export class CodeBlockRenderer {
  private app: App;
  private component: Component;

  constructor(app: App, component: Component) {
    this.app = app;
    this.component = component;
  }

  async render(source: string, container: HTMLElement, ctx?: MarkdownPostProcessorContext): Promise<void> {
    container.empty();
    container.addClass("kg-codeblock-wrap");

    // ── Parse source code ──
    const { config, errors } = parseCodeBlock(source);

    // Show parse errors (don't block rendering)
    if (errors.length > 0) {
      const errBox = container.createDiv({ cls: "kg-cb-errors" });
      errBox.createEl("strong", { text: "⚠ Syntax Hints" });
      errors.forEach((e) => errBox.createEl("div", { text: e, cls: "kg-cb-error-item" }));
    }

    if (config.triples.length === 0 && config.nodeTypes.length === 0) {
      container.createDiv({ cls: "kg-cb-empty", text: "No graph content, please add triples" });
      return;
    }

    // ── Height: read config.height first, otherwise default to 420 ──
    const DEFAULT_H = 420;
    const MIN_H = 200;
    const MAX_H = 1200;
    const clampH = (v: number) => Math.min(MAX_H, Math.max(MIN_H, v));
    const initH = clampH(config.height ?? DEFAULT_H);

    // Function to write height back to md file
    const saveHeight = async (h: number) => {
      if (!ctx) return;
      const filePath = ctx.sourcePath;
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) return;
      const content = await this.app.vault.read(file);
      // Find current code block and replace source (update height field)
      config.height = h;
      const newSource = serializeToCodeBlock(config);
      // Replace corresponding code block content in file
      const newContent = replaceCodeBlockSource(content, source, newSource);
      if (newContent !== content) {
        await this.app.vault.modify(file, newContent);
      }
    };

    // ── Layout skeleton ──
    const graphWrap = container.createDiv({ cls: "kg-cb-graph-wrap" });

    // Toolbar (title + buttons, no legend)
    const toolbar = graphWrap.createDiv({ cls: "kg-cb-toolbar" });
    toolbar.createEl("span", { cls: "kg-cb-title", text: config.name });
    const btnRow    = toolbar.createDiv({ cls: "kg-cb-btn-row" });
    const btnFit    = btnRow.createEl("button", { cls: "kg-cb-btn", text: "⊙ Fit" });
    const btnLabel  = btnRow.createEl("button", { cls: "kg-cb-btn", text: "⊘ Label" });
    const btnLayout = btnRow.createEl("button", { cls: "kg-cb-btn", text: "↺ Restart" });

    // Canvas area (adjustable height)
    const canvasWrap = graphWrap.createDiv({ cls: "kg-cb-canvas-wrap" });
    canvasWrap.style.height = initH + "px";

    // SVG
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "kg-cb-svg");
    canvasWrap.appendChild(svg);

    // Tooltip
    const tooltip = canvasWrap.createDiv({ cls: "kg-tooltip" });

    // ── Legend panel (bottom-left, collapsible) ──
    if (config.nodeTypes.length > 0) {
      this.renderLegendPanel(canvasWrap, config);
    }

    // ── Description panel (top-right, collapsible) ──
    if (config.description?.trim()) {
      this.renderDescPanel(canvasWrap, config);
    }

    // ── Stats bar (node/link count + right height input)──
    const stats = graphWrap.createDiv({ cls: "kg-cb-stats" });

    // ── Drag resize handle ──
    const resizeHandle = graphWrap.createDiv({ cls: "kg-cb-resize-handle" });
    resizeHandle.innerHTML = `<div class="kg-cb-resize-dots"></div>`;
    this.attachResizeHandle(resizeHandle, canvasWrap, svg, stats, MIN_H, MAX_H, saveHeight);

    // ── Load D3 ──
    const loadingEl = canvasWrap.createDiv({ cls: "kg-loading" });
    loadingEl.innerHTML = `<div class="kg-spinner"></div><span>Loading...</span>`;

    const d3 = await ensureD3();
    loadingEl.remove();

    if (!d3) {
      canvasWrap.createDiv({ cls: "kg-cb-error", text: "⚠ D3.js failed to load, please check network connection and refresh" });
      return;
    }

    // ── Render ──
    const renderer = new GraphRenderer(d3, svg, tooltip, config);
    renderer.render();

    const data = renderer.getData();
    stats.innerHTML = `
      <span class="kg-cb-stat"><strong>${data.nodes.length}</strong> Nodes</span>
      <span class="kg-cb-stat-sep">·</span>
      <span class="kg-cb-stat"><strong>${data.links.length}</strong> Edges</span>`;

    // Re-append height input to right side of stats bar (innerHTML clears previous, so use createEl)
    const heightGroup = stats.createDiv({ cls: "kg-cb-height-group" });
    heightGroup.createSpan({ cls: "kg-cb-height-label", text: "Height" });
    const heightInput = heightGroup.createEl("input", { cls: "kg-cb-height-input" }) as HTMLInputElement;
    heightGroup.createSpan({ cls: "kg-cb-height-unit", text: "px" });
    heightInput.type  = "number";
    heightInput.min   = String(MIN_H);
    heightInput.max   = String(MAX_H);
    heightInput.value = String(initH);
    heightInput.title = "Enter height (px) and press Enter to confirm";

    // Expose input apply logic to resize handle (via shared reference)
    const applyHeightFromInput = (h: number) => {
      const clamped = clampH(h);
      canvasWrap.style.height = clamped + "px";
      svg.setAttribute("height", String(clamped));
      heightInput.value = String(clamped);
      saveHeight(clamped);
    };

    heightInput.addEventListener("click",    (e) => e.stopPropagation());
    heightInput.addEventListener("mousedown",(e) => e.stopPropagation());
    heightGroup.addEventListener("mousedown",(e) => e.stopPropagation());
    heightInput.addEventListener("keydown",  (e) => {
      if (e.key === "Enter") {
        const val = parseInt(heightInput.value);
        if (!isNaN(val)) applyHeightFromInput(val);
        heightInput.blur();
      }
      if (e.key === "Escape") heightInput.blur();
    });
    heightInput.addEventListener("blur", () => {
      const val = parseInt(heightInput.value);
      if (!isNaN(val)) applyHeightFromInput(val);
    });

    // Notify resizeHandle to also sync heightInput
    (resizeHandle as any).__syncInput = (h: number) => { heightInput.value = String(h); };

    // Button events
    btnFit.addEventListener("click",    () => renderer.fitView());
    btnLayout.addEventListener("click", () => renderer.restart());

    let labelsVisible = true;
    btnLabel.addEventListener("click", () => {
      labelsVisible = !labelsVisible;
      renderer.setLabelsVisible(labelsVisible);
      btnLabel.textContent = labelsVisible ? "⊘ Label" : "◎ Label";
    });

    // Re-fit view on resize
    const ro = new ResizeObserver(() => renderer.onResize());
    ro.observe(canvasWrap);
    this.component.register(() => { ro.disconnect(); renderer.destroy(); });
  }

  // ── Legend panel (bottom-left)──
  private renderLegendPanel(canvas: HTMLElement, config: GraphConfig) {
    const panel = canvas.createDiv({ cls: "kg-cb-legend-panel" });

    const header = panel.createDiv({ cls: "kg-cb-legend-header" });
    header.innerHTML = `<span class="kg-cb-legend-title">Legend</span>
      <svg class="kg-desc-toggle" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="6 9 12 15 18 9"/>
      </svg>`;
    header.addEventListener("click", () => panel.classList.toggle("collapsed"));

    const body = panel.createDiv({ cls: "kg-cb-legend-body" });
    config.nodeTypes.forEach((t) => {
      const item = body.createDiv({ cls: "kg-cb-legend-item" });
      const dot  = item.createDiv({ cls: "kg-cb-legend-dot" });
      dot.style.background = t.color ?? DEFAULT_FALLBACK_COLOR;
      item.createSpan({ text: t.label });
    });
  }

  // ── Description panel (top-right)──
  private renderDescPanel(canvas: HTMLElement, config: GraphConfig) {
    const panel = canvas.createDiv({ cls: "kg-cb-desc" });

    const header = panel.createDiv({ cls: "kg-cb-desc-header" });
    header.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>Description</span>
      <svg class="kg-desc-toggle" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="6 9 12 15 18 9"/>
      </svg>`;
    header.addEventListener("click", () => panel.classList.toggle("expanded"));

    const body = panel.createDiv({ cls: "kg-cb-desc-body" });
    const content = body.createDiv({ cls: "kg-desc-content" });
    MarkdownRenderer.render(this.app, config.description ?? "", content, "", this.component);
  }

  // ── Drag resize logic ──
  private attachResizeHandle(
    handle: HTMLElement,
    canvas: HTMLElement,
    svg: SVGSVGElement,
    stats: HTMLElement,
    minH: number,
    maxH: number,
    saveHeight: (h: number) => Promise<void>,
  ) {
    const clamp = (v: number) => Math.min(maxH, Math.max(minH, v));

    let startY = 0;
    let startH = 0;

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startY = e.clientY;
      startH = canvas.offsetHeight;

      const onMove = (ev: MouseEvent) => {
        const clamped = clamp(startH + (ev.clientY - startY));
        canvas.style.height = clamped + "px";
        svg.setAttribute("height", String(clamped));
        // Real-time sync input
        const syncFn = (handle as any).__syncInput;
        if (syncFn) syncFn(clamped);
      };

      const onUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
        // Save final height to file on release
        const finalH = clamp(startH + (ev.clientY - startY));
        canvas.style.height = finalH + "px";
        svg.setAttribute("height", String(finalH));
        const syncFn = (handle as any).__syncInput;
        if (syncFn) syncFn(finalH);
        saveHeight(finalH);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    });
  }
}

// ============================================
// Utility function: replace code block source in md file
// ============================================
function replaceCodeBlockSource(fileContent: string, oldSource: string, newSource: string): string {
  // Match ```knowledgegraph ... ``` code block
  const fence = "```knowledgegraph";
  const closeFence = "```";
  let searchFrom = 0;

  while (searchFrom < fileContent.length) {
    const start = fileContent.indexOf(fence, searchFrom);
    if (start === -1) break;

    // Find content between newline after start and closing ```
    const contentStart = fileContent.indexOf("\n", start);
    if (contentStart === -1) break;

    const end = fileContent.indexOf("\n" + closeFence, contentStart);
    if (end === -1) break;

    const blockSource = fileContent.slice(contentStart + 1, end);

    if (blockSource.trimEnd() === oldSource.trimEnd()) {
      return (
        fileContent.slice(0, contentStart + 1) +
        newSource +
        fileContent.slice(end)
      );
    }

    searchFrom = end + 1;
  }

  return fileContent; // No match, no change
}

// ============================================
// Graph rendering core (independent class, no Obsidian API dependency)
// ============================================
class GraphRenderer {
  private d3: any;
  private svgEl: SVGSVGElement;
  private tooltipEl: HTMLElement;
  private config: GraphConfig;
  private g: any;
  private simulation: any;
  private zoomBehavior: any;
  private nodeElements: any;
  private linkElements: any;
  private linkLabelElements: any;
  private colorMap: Map<string, string> = new Map();
  private showLabels = true;
  private hoveredNode: GraphNode | null = null;
  private hoveredLink: GraphLink | null = null;
  private isDragging = false;
  // Full URL prefix to fix Obsidian app:// protocol relative url(#id) reference failure
  private arrowBaseUrl: string;
  private arrowUrl   = "";
  private arrowHlUrl = "";
  private data: { nodes: GraphNode[]; links: GraphLink[] };

  constructor(d3: any, svgEl: SVGSVGElement, tooltipEl: HTMLElement, config: GraphConfig) {
    this.d3 = d3;
    this.svgEl = svgEl;
    this.tooltipEl = tooltipEl;
    this.config = config;
    // Strip hash part, construct full marker reference URL to avoid Obsidian app:// relative url(#id) failure
    this.arrowBaseUrl = window.location.href.split("#")[0];
    this.assignColors();
    this.data = this.processData();
  }

  getData() { return this.data; }

  render() {
    this.initSVG();
    this.renderGraph();
    setTimeout(() => this.fitView(), 2200);
  }

  restart() {
    this.data = this.processData();
    this.render();
  }

  destroy() {
    this.simulation?.stop();
  }

  onResize() {
    const wrap = this.svgEl.parentElement;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    this.d3.select(this.svgEl).attr("width", w).attr("height", h);
    // Update center force
    this.simulation?.force("center", this.d3.forceCenter(w / 2, h / 2).strength(0.08));
    this.simulation?.alpha(0.1).restart();
  }

  setLabelsVisible(visible: boolean) {
    this.showLabels = visible;
    this.linkLabelElements?.style("opacity", visible ? 1 : 0);
  }

  // ── Color assignment ──
  private assignColors() {
    this.colorMap.clear();
    let idx = 0;
    this.config.nodeTypes.forEach((t) => {
      if (!t.color) t.color = AUTO_COLOR_PALETTE[idx % AUTO_COLOR_PALETTE.length];
      idx++;
      (t.nodes || []).forEach((n) => this.colorMap.set(n, t.color!));
    });
  }

  private getNodeColor(name: string): string {
    return this.colorMap.get(name) ?? this.config.defaultType?.color ?? DEFAULT_FALLBACK_COLOR;
  }

  private getNodeTypeLabel(name: string): string {
    for (const t of this.config.nodeTypes) {
      if (t.nodes?.includes(name)) return t.label;
    }
    return this.config.defaultType?.label ?? "Other";
  }

  private getNodeSize(node: GraphNode): number {
    const deg = this.data.links.filter(
      (l: any) =>
        (l.source?.id ?? l.source) === node.id ||
        (l.target?.id ?? l.target) === node.id
    ).length;
    return Math.min(38, Math.max(18, 22 + deg * 2.5));
  }

  // ── Data processing ──
  private processData() {
    const nodes = new Map<string, GraphNode>();
    const links: GraphLink[] = [];

    this.config.triples.forEach((t) => {
      if (!nodes.has(t.subject)) nodes.set(t.subject, { id: t.subject, name: t.subject });
      if (!nodes.has(t.object))  nodes.set(t.object,  { id: t.object,  name: t.object });
      links.push({ source: t.subject, target: t.object, relation: t.predicate });
    });

    const pairCount = new Map<string, number>();
    const pairIndex = new Map<string, number>();
    links.forEach((l) => {
      const key = [l.source, l.target].sort().join("||");
      pairCount.set(key, (pairCount.get(key) || 0) + 1);
    });
    links.forEach((l) => {
      const key = [l.source, l.target].sort().join("||");
      const total = pairCount.get(key)!;
      const idx   = pairIndex.get(key) || 0;
      pairIndex.set(key, idx + 1);
      l.totalLinks = total;
      l.linkIndex  = idx;
      const sorted = [l.source, l.target].sort();
      l.isForwardDir = (l.source === sorted[0]);
    });

    return { nodes: Array.from(nodes.values()), links };
  }

  // ── SVG initialization ──
  private initSVG() {
    const d3 = this.d3;
    const svg = d3.select(this.svgEl);
    svg.selectAll("*").remove();

    const wrap = this.svgEl.parentElement!;
    const w = wrap.clientWidth  || 700;
    const h = wrap.clientHeight || 420;
    svg.attr("width", w).attr("height", h);

    this.zoomBehavior = d3.zoom()
      .scaleExtent([0.08, 6])
      .on("zoom", (event: any) => this.g.attr("transform", event.transform));

    svg.call(this.zoomBehavior).on("dblclick.zoom", null);
    this.g = svg.append("g");

    const defs = svg.append("defs");
    // Use config.id as unique prefix to avoid marker id conflicts across multiple graphs
    const arrowId   = `kg-arrow-${this.config.id}`;
    const arrowHlId = `kg-arrow-hl-${this.config.id}`;
    this.appendArrow(defs, arrowId,   "#94a3b8", 7, 6);
    this.appendArrow(defs, arrowHlId, "#a5b4fc", 8, 6);
    this.arrowUrl   = `${this.arrowBaseUrl}#${arrowId}`;
    this.arrowHlUrl = `${this.arrowBaseUrl}#${arrowHlId}`;
  }

  private appendArrow(defs: any, id: string, fill: string, size: number, refX: number) {
    defs.append("marker")
      .attr("id", id)
      .attr("viewBox", "0 -4 8 8")
      .attr("refX", refX).attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", size).attr("markerHeight", size)
      .append("path")
      .attr("d", "M 0,-3.5 L 7,0 L 0,3.5 Z")
      .attr("fill", fill);
  }

  // ── Render graph ──
  private renderGraph() {
    const d3 = this.d3;
    const { nodes, links } = this.data;

    if (this.simulation) this.simulation.stop();

    const wrap = this.svgEl.parentElement!;
    const W = wrap.clientWidth  || 700;
    const H = wrap.clientHeight || 420;

    const nodeCount = nodes.length;
    const linkDist  = nodeCount > 30 ? 120 : nodeCount > 15 ? 140 : 160;
    const chargeStr = nodeCount > 30 ? -400 : nodeCount > 15 ? -500 : -600;

    this.simulation = d3.forceSimulation(nodes)
      .force("link",      d3.forceLink(links).id((d: any) => d.id).distance(linkDist).strength(0.7))
      .force("charge",    d3.forceManyBody().strength(chargeStr).distanceMax(400))
      .force("center",    d3.forceCenter(W / 2, H / 2).strength(0.08))
      .force("collision", d3.forceCollide().radius((d: any) => this.getNodeSize(d) + 12).strength(0.85))
      .alphaDecay(0.025)
      .velocityDecay(0.3);

    // Edges
    this.linkElements = this.g.append("g").attr("class", "kg-links-layer")
      .selectAll("path").data(links).enter().append("path")
      .attr("class", "kg-link")
      .attr("stroke",       (d: any) => this.isLoop(d) ? "#8b5cf6" : "#cbd5e1")
      .attr("stroke-width", (d: any) => this.isLoop(d) ? 2.5 : 1.8)
      .attr("fill", "none")
      .attr("marker-end", (d: any) => this.isLoop(d) ? "" : `url(${this.arrowUrl})`)
      .on("mouseover", (_: any, d: any) => { this.hoveredLink = d; this.hoveredNode = null; this.applyLinkHover(d); })
      .on("mouseout",  () => this.handleMouseOut());

    // Edge labels
    const llGroup = this.g.append("g").attr("class", "kg-link-labels-layer");
    const llGs = llGroup.selectAll("g").data(links).enter().append("g")
      .attr("class", "kg-link-label-g")
      .style("pointer-events", "none")
      .style("opacity", this.showLabels ? 1 : 0);
    llGs.append("rect").attr("class", "kg-link-label-bg")
      .attr("rx", 3).attr("ry", 3)
      .attr("fill", "rgba(245,247,250,0.92)").attr("stroke", "#e2e8f0").attr("stroke-width", 0.5);
    llGs.append("text").attr("class", "kg-link-label")
      .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
      .text((d: any) => d.relation);
    this.linkLabelElements = llGs;

    // Nodes
    this.nodeElements = this.g.append("g").attr("class", "kg-nodes-layer")
      .selectAll("g").data(nodes).enter().append("g")
      .attr("class", "kg-node")
      .call(
        d3.drag()
          .on("start", (_: any, d: any) => this.dragStart(_, d))
          .on("drag",  (e: any, d: any) => { d.fx = e.x; d.fy = e.y; })
          .on("end",   (e: any, d: any) => this.dragEnd(e, d))
      )
      .on("mouseover", (event: any, d: any) => this.handleNodeOver(event, d))
      .on("mouseout",  () => this.handleMouseOut())
      .on("click",     (event: any, d: any) => this.handleNodeClick(event, d));

    // Glow
    this.nodeElements.append("circle").attr("class", "kg-node-glow")
      .attr("r", (d: any) => this.getNodeSize(d) + 8)
      .attr("fill", (d: any) => this.getNodeColor(d.name))
      .attr("opacity", 0.12).attr("pointer-events", "none");

    // Main circle
    this.nodeElements.append("circle").attr("class", "kg-node-body")
      .attr("r",            (d: any) => this.getNodeSize(d))
      .attr("fill",         (d: any) => this.getNodeColor(d.name))
      .attr("stroke",       (d: any) => this.getNodeColor(d.name))
      .attr("stroke-width", 2.5).attr("stroke-opacity", 0.6);

    // Text stroke layer
    this.nodeElements.append("text").attr("class", "kg-node-text-stroke")
      .attr("text-anchor", "middle").attr("dy", "0.35em")
      .text((d: any) => d.name.length > 8 ? d.name.slice(0, 7) + "…" : d.name)
      .style("fill", "none")
      .style("stroke",         (d: any) => this.getNodeColor(d.name))
      .style("stroke-width",   "3px").style("stroke-opacity", "0.5")
      .style("font-size",      (d: any) => this.getNodeSize(d) > 30 ? "13px" : "12px")
      .style("pointer-events", "none");

    // Text body layer
    this.nodeElements.append("text").attr("class", "kg-node-text")
      .attr("text-anchor", "middle").attr("dy", "0.35em")
      .text((d: any) => d.name.length > 8 ? d.name.slice(0, 7) + "…" : d.name)
      .style("fill",           "#ffffff")
      .style("font-size",      (d: any) => this.getNodeSize(d) > 30 ? "13px" : "12px")
      .style("pointer-events", "none");

    this.simulation.on("tick", () => this.onTick());
  }

  // ── Tick ──
  private onTick() {
    this.linkElements?.each((d: any, _: number, nodes: any[]) => {
      this.d3.select(nodes[_]).attr("d", this.computePath(d));
    });

    this.linkLabelElements?.each((d: any, _: number, nodes: any[]) => {
      const mid = this.computeMidpoint(d);
      const labelG = this.d3.select(nodes[_]);
      labelG.attr("transform", `translate(${mid.x},${mid.y})`);
      const textEl = (nodes[_] as Element).querySelector("text");
      if (textEl) {
        try {
          const b = (textEl as SVGTextElement).getBBox();
          const px = 4, py = 2;
          labelG.select("rect")
            .attr("x", b.x - px).attr("y", b.y - py)
            .attr("width", b.width + px * 2).attr("height", b.height + py * 2);
        } catch (_) {}
      }
    });

    this.nodeElements?.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
  }

  // ── Path calculation ──
  private isLoop(d: any): boolean {
    return (d.source?.id ?? d.source) === (d.target?.id ?? d.target);
  }

  private computePath(d: any): string {
    if (this.isLoop(d)) {
      const r = this.getNodeSize(d.source);
      const lr = r + 25 + (d.linkIndex || 0) * 10;
      const x = d.source.x, y = d.source.y;
      const sa = -Math.PI / 12, ea = -Math.PI / 2;
      const x1 = x + Math.cos(sa) * r, y1 = y + Math.sin(sa) * r;
      const x2 = x + Math.cos(ea) * r, y2 = y + Math.sin(ea) * r;
      const cx = x + Math.cos(sa) * lr * 1.8, cy = y + Math.sin(sa) * lr * 1.8;
      return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
    }
    const sx = d.source.x, sy = d.source.y, tx = d.target.x, ty = d.target.y;
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return "";
    const sr = this.getNodeSize(d.source), tr = this.getNodeSize(d.target);
    const ux = dx / dist, uy = dy / dist;
    const x1 = sx + ux * (sr + 2), y1 = sy + uy * (sr + 2);
    const x2 = tx - ux * (tr + 7), y2 = ty - uy * (tr + 7);
    if (d.totalLinks === 1) return `M ${x1} ${y1} L ${x2} ${y2}`;
    const curv  = Math.min(60, Math.max(30, dist * 0.18));
    const offset = (d.linkIndex - (d.totalLinks - 1) / 2) * curv;
    const nx = -uy, ny = ux;
    const sign = d.isForwardDir ? 1 : -1;
    const mx = (x1 + x2) / 2 + nx * offset * sign;
    const my = (y1 + y2) / 2 + ny * offset * sign;
    return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
  }

  private computeMidpoint(d: any) {
    if (this.isLoop(d)) {
      const r  = this.getNodeSize(d.source);
      const lr = r + 25 + (d.linkIndex || 0) * 10;
      const sa = -Math.PI / 12, la = sa - Math.PI / 24;
      return { x: d.source.x + Math.cos(la) * lr * 1.5, y: d.source.y + Math.sin(la) * lr * 1.5 };
    }
    const sx = d.source.x, sy = d.source.y, tx = d.target.x, ty = d.target.y;
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return { x: sx, y: sy };
    if (d.totalLinks === 1) return { x: (sx + tx) / 2, y: (sy + ty) / 2 };
    const ux = dx / dist, uy = dy / dist;
    const sr = this.getNodeSize(d.source), tr = this.getNodeSize(d.target);
    const x1 = sx + ux * (sr + 2), y1 = sy + uy * (sr + 2);
    const x2 = tx - ux * (tr + 7), y2 = ty - uy * (tr + 7);
    const curv  = Math.min(60, Math.max(30, dist * 0.18));
    const offset = (d.linkIndex - (d.totalLinks - 1) / 2) * curv;
    const nx = -uy, ny = ux;
    const sign = d.isForwardDir ? 1 : -1;
    const cx = (x1 + x2) / 2 + nx * offset * sign;
    const cy = (y1 + y2) / 2 + ny * offset * sign;
    return { x: 0.25 * x1 + 0.5 * cx + 0.25 * x2, y: 0.25 * y1 + 0.5 * cy + 0.25 * y2 };
  }

  // ── Drag ──
  private dragStart(_: any, d: GraphNode) {
    this.isDragging = true;
    if (!_.active) this.simulation?.alphaTarget(0.25).restart();
    d.fx = d.x; d.fy = d.y;
  }

  private dragEnd(e: any, d: GraphNode) {
    d.pinned = true;
    if (!e.active) this.simulation?.alphaTarget(0);
    setTimeout(() => { this.isDragging = false; }, 100);
  }

  // ── Mouse events ──
  private handleNodeOver(event: any, d: GraphNode) {
    if (this.isDragging) return;
    this.hoveredNode = d; this.hoveredLink = null;

    const conns = this.data.links.filter(
      (l: any) => (l.source?.id ?? l.source) === d.id || (l.target?.id ?? l.target) === d.id
    ).length;

    this.tooltipEl.innerHTML = `<strong>${d.name}</strong><div class="kg-tt-type">${this.getNodeTypeLabel(d.name)} · ${conns} connections${d.pinned ? " · 📌 Pinned" : ""}</div>`;
    this.tooltipEl.style.left  = (event.pageX + 14) + "px";
    this.tooltipEl.style.top   = (event.pageY - 10) + "px";
    this.tooltipEl.classList.add("visible");
    this.applyNodeHover(d);
  }

  private handleMouseOut() {
    if (this.isDragging) return;
    this.hoveredNode = null; this.hoveredLink = null;
    this.tooltipEl.classList.remove("visible");

    this.linkElements
      ?.attr("stroke", (d: any) => this.isLoop(d) ? "#8b5cf6" : "#cbd5e1")
      .attr("stroke-opacity", 0.55)
      .attr("stroke-width",   (d: any) => this.isLoop(d) ? 2.5 : 1.8)
      .attr("marker-end",     (d: any) => this.isLoop(d) ? "" : `url(${this.arrowUrl})`);

    this.nodeElements?.style("opacity", 1).select(".kg-node-body").attr("stroke-width", 2.5);
    if (this.showLabels) this.linkLabelElements?.style("opacity", 1);
  }

  private handleNodeClick(event: any, d: GraphNode) {
    if (event.defaultPrevented) return;
    if (d.pinned) {
      d.pinned = false; d.fx = null; d.fy = null;
      this.d3.select(event.target.closest(".kg-node"))
        .classed("kg-pinned", false).select(".kg-node-body").attr("stroke-width", 2.5);
      this.simulation?.alpha(0.1).restart();
    } else {
      d.pinned = true; d.fx = d.x; d.fy = d.y;
      this.d3.select(event.target.closest(".kg-node"))
        .classed("kg-pinned", true).select(".kg-node-body").attr("stroke-width", 3.5);
    }
  }

  // ── Highlight ──
  private isConnected(link: any, node: GraphNode): boolean {
    return (link.source?.id ?? link.source) === node.id ||
           (link.target?.id ?? link.target) === node.id;
  }

  private isNeighbor(n: GraphNode, d: GraphNode): boolean {
    return !!this.data.links.some(
      (l: any) =>
        ((l.source?.id ?? l.source) === d.id && (l.target?.id ?? l.target) === n.id) ||
        ((l.target?.id ?? l.target) === d.id && (l.source?.id ?? l.source) === n.id)
    );
  }

  private applyNodeHover(d: GraphNode) {
    this.linkElements
      ?.attr("stroke", (l: any) => {
        if (this.isLoop(l)) return this.isConnected(l, d) ? "#8b5cf6" : "#7c3aed";
        return this.isConnected(l, d) ? "#6366f1" : "#cbd5e1";
      })
      .attr("stroke-opacity", (l: any) => this.isConnected(l, d) ? 0.8 : 0.2)
      .attr("stroke-width",   (l: any) => this.isConnected(l, d) ? 2.5 : 1.5)
      .attr("marker-end",     (l: any) => {
        if (this.isLoop(l)) return "";
        return this.isConnected(l, d) ? `url(${this.arrowHlUrl})` : `url(${this.arrowUrl})`;
      });

    this.nodeElements?.each((_: any, i: number, nodes: any[]) => {
      const n = _ as GraphNode;
      const related = n.id === d.id || this.isNeighbor(n, d);
      this.d3.select(nodes[i]).style("opacity", related ? 1 : 0.3)
        .select(".kg-node-body").attr("stroke-width", n.id === d.id ? 4 : 2.5);
    });

    this.linkLabelElements?.each((_: any, i: number, nodes: any[]) => {
      this.d3.select(nodes[i]).style("opacity",
        this.showLabels && this.isConnected(_, d) ? 1 : 0.15);
    });
  }

  private applyLinkHover(d: GraphLink) {
    this.linkElements
      ?.attr("stroke", (l: any) => {
        if (this.isLoop(l)) return l === d ? "#8b5cf6" : "#7c3aed";
        return l === d ? "#6366f1" : "#cbd5e1";
      })
      .attr("stroke-opacity", (l: any) => l === d ? 1 : 0.2)
      .attr("stroke-width",   (l: any) => l === d ? 2.8 : 1.5)
      .attr("marker-end",     (l: any) => {
        if (this.isLoop(l)) return "";
        return l === d ? `url(${this.arrowHlUrl})` : `url(${this.arrowUrl})`;
      });

    this.nodeElements?.each((_: any, i: number, nodes: any[]) => {
      const n = _ as GraphNode;
      const sid = (d.source as GraphNode)?.id ?? d.source;
      const tid = (d.target as GraphNode)?.id ?? d.target;
      const rel = n.id === sid || n.id === tid;
      this.d3.select(nodes[i]).style("opacity", rel ? 1 : 0.25)
        .select(".kg-node-body").attr("stroke-width", rel ? 4 : 2.5);
    });

    this.linkLabelElements?.each((_: any, i: number, nodes: any[]) => {
      this.d3.select(nodes[i]).style("opacity", this.showLabels && _ === d ? 1 : 0.1);
    });
  }

  // ── View control ──
  fitView() {
    if (!this.data.nodes.length || !this.d3 || !this.svgEl) return;
    const wrap = this.svgEl.parentElement!;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const pad = 60;
    const xs = this.data.nodes.map((n) => n.x!).filter((v) => v != null);
    const ys = this.data.nodes.map((n) => n.y!).filter((v) => v != null);
    if (!xs.length) return;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const scale = Math.min(W / (maxX - minX), H / (maxY - minY), 1.5);
    const tx = W / 2 - scale * (minX + maxX) / 2;
    const ty = H / 2 - scale * (minY + maxY) / 2;
    this.d3.select(this.svgEl).transition().duration(600).ease(this.d3.easeCubicOut)
      .call(this.zoomBehavior.transform, this.d3.zoomIdentity.translate(tx, ty).scale(scale));
  }
}
