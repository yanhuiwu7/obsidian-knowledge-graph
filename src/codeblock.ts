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
// D3 type definitions (subset used by this plugin)
// ============================================
type D3Selection = {
  attr: (name: string, value?: unknown) => D3Selection;
  style: (name: string, value?: unknown) => D3Selection;
  append: (tag: string) => D3Selection;
  select: (selector: string) => D3Selection;
  selectAll: (selector: string) => D3Selection;
  data: (data: unknown[]) => D3Selection;
  enter: () => D3Selection;
  text: (t: string | ((d: GraphNode) => string)) => D3Selection;
  call: (fn: unknown, ...args: unknown[]) => D3Selection;
  on: (event: string, handler: unknown) => D3Selection;
  remove: () => void;
  classed: (cls: string, val: boolean) => D3Selection;
  each: (fn: (d: GraphNode, i: number, nodes: Element[]) => void) => D3Selection;
  transition: () => D3Selection;
  duration: (ms: number) => D3Selection;
  ease: (fn: unknown) => D3Selection;
};

type D3Simulation = {
  force: (name: string, force?: unknown) => D3Simulation;
  on: (event: string, handler: () => void) => D3Simulation;
  stop: () => void;
  alpha: (v: number) => D3Simulation;
  alphaTarget: (v: number) => D3Simulation;
  alphaDecay: (v: number) => D3Simulation;
  velocityDecay: (v: number) => D3Simulation;
  restart: () => D3Simulation;
};

type D3ZoomBehavior = {
  scaleExtent: (extent: [number, number]) => D3ZoomBehavior;
  on: (event: string, handler: (event: D3ZoomEvent) => void) => D3ZoomBehavior;
  transform: unknown;
};

type D3ZoomEvent = {
  transform: { k: number; x: number; y: number };
};

type D3DragEvent = {
  x: number;
  y: number;
  active: number;
};

type D3ForceChainable = {
  id: (fn: (d: GraphNode) => string) => D3ForceChainable;
  distance: (v: number) => D3ForceChainable;
  strength: (v: number) => D3ForceChainable;
  distanceMax: (v: number) => D3ForceChainable;
  radius: (fn: (d: GraphNode) => number) => D3ForceChainable;
};

type D3DragBehavior = {
  on: (event: "start" | "drag" | "end", handler: (event: D3DragEvent, d: GraphNode) => void) => D3DragBehavior;
};

type D3Instance = {
  select: (el: Element) => D3Selection;
  zoom: () => D3ZoomBehavior;
  zoomIdentity: { translate: (x: number, y: number) => { scale: (k: number) => unknown } };
  drag: () => D3DragBehavior;
  forceSimulation: (nodes: GraphNode[]) => D3Simulation;
  forceLink: (links: GraphLink[]) => D3ForceChainable;
  forceManyBody: () => D3ForceChainable;
  forceCenter: (x: number, y: number) => D3ForceChainable;
  forceCollide: () => D3ForceChainable;
  easeCubicOut: unknown;
};

// ============================================
// Ensure D3 is loaded (global singleton)
// ============================================
let d3LoadPromise: Promise<D3Instance | null> | null = null;

export function ensureD3(): Promise<D3Instance | null> {
  const win = window as unknown as Record<string, unknown>;
  if (win["d3"]) return Promise.resolve(win["d3"] as D3Instance);
  if (d3LoadPromise) return d3LoadPromise;

  d3LoadPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://d3js.org/d3.v7.min.js";
    script.onload = () => {
      d3LoadPromise = null;
      resolve((window as unknown as Record<string, unknown>)["d3"] as D3Instance);
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
    errBox.createEl("strong", { text: "⚠ Syntax hints" }); // eslint-disable-line obsidianmd/ui/sentence-case
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
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    const btnFit    = btnRow.createEl("button", { cls: "kg-cb-btn", text: "⊙ Fit" });
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    const btnLabel  = btnRow.createEl("button", { cls: "kg-cb-btn", text: "⊘ Label" });
    // eslint-disable-next-line obsidianmd/ui/sentence-case
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
    resizeHandle.createDiv({ cls: "kg-cb-resize-dots" });
    this.attachResizeHandle(resizeHandle, canvasWrap, svg, MIN_H, MAX_H, saveHeight);

    // ── Load D3 ──
    const loadingEl = canvasWrap.createDiv({ cls: "kg-loading" });
    const spinnerEl = loadingEl.createDiv({ cls: "kg-spinner" });
    spinnerEl.setAttribute("aria-hidden", "true");
    loadingEl.createSpan({ text: "Loading..." });

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

    // Build stats bar using DOM API
    stats.empty();
    const statNode = stats.createSpan({ cls: "kg-cb-stat" });
    statNode.createEl("strong", { text: String(data.nodes.length) });
    statNode.appendText(" nodes");
    stats.createSpan({ cls: "kg-cb-stat-sep", text: "·" });
    const statEdge = stats.createSpan({ cls: "kg-cb-stat" });
    statEdge.createEl("strong", { text: String(data.links.length) });
    statEdge.appendText(" edges");

    // Re-append height input to right side of stats bar
    const heightGroup = stats.createDiv({ cls: "kg-cb-height-group" });
    heightGroup.createSpan({ cls: "kg-cb-height-label", text: "Height" });
    const heightInput = heightGroup.createEl("input", { cls: "kg-cb-height-input" });
    heightGroup.createSpan({ cls: "kg-cb-height-unit", text: "px" });
    heightInput.type  = "number";
    heightInput.min   = String(MIN_H);
    heightInput.max   = String(MAX_H);
    heightInput.value = String(initH);
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    heightInput.title = "Enter height (px) and press Enter to confirm";

    // Expose input apply logic to resize handle (via shared reference)
    const applyHeightFromInput = (h: number) => {
      const clamped = clampH(h);
      canvasWrap.style.height = clamped + "px";
      svg.setAttribute("height", String(clamped));
      heightInput.value = String(clamped);
      void saveHeight(clamped);
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
    (resizeHandle as HTMLElement & { __syncInput?: (h: number) => void }).__syncInput = (h: number) => { heightInput.value = String(h); };

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
    header.createSpan({ cls: "kg-cb-legend-title", text: "Legend" });

    const toggleSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    toggleSvg.setAttribute("class", "kg-desc-toggle");
    toggleSvg.setAttribute("width", "12");
    toggleSvg.setAttribute("height", "12");
    toggleSvg.setAttribute("viewBox", "0 0 24 24");
    toggleSvg.setAttribute("fill", "none");
    toggleSvg.setAttribute("stroke", "currentColor");
    toggleSvg.setAttribute("stroke-width", "2.5");
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", "6 9 12 15 18 9");
    toggleSvg.appendChild(polyline);
    header.appendChild(toggleSvg);

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

    // Info icon SVG
    const infoSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    infoSvg.setAttribute("width", "13");
    infoSvg.setAttribute("height", "13");
    infoSvg.setAttribute("viewBox", "0 0 24 24");
    infoSvg.setAttribute("fill", "none");
    infoSvg.setAttribute("stroke", "currentColor");
    infoSvg.setAttribute("stroke-width", "2.5");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", "10");
    const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line1.setAttribute("x1", "12"); line1.setAttribute("y1", "8"); line1.setAttribute("x2", "12"); line1.setAttribute("y2", "12");
    const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line2.setAttribute("x1", "12"); line2.setAttribute("y1", "16"); line2.setAttribute("x2", "12.01"); line2.setAttribute("y2", "16");
    infoSvg.appendChild(circle); infoSvg.appendChild(line1); infoSvg.appendChild(line2);
    header.appendChild(infoSvg);

    header.createSpan({ text: "Description" });

    // Toggle chevron SVG
    const chevronSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chevronSvg.setAttribute("class", "kg-desc-toggle");
    chevronSvg.setAttribute("width", "13"); chevronSvg.setAttribute("height", "13");
    chevronSvg.setAttribute("viewBox", "0 0 24 24");
    chevronSvg.setAttribute("fill", "none");
    chevronSvg.setAttribute("stroke", "currentColor");
    chevronSvg.setAttribute("stroke-width", "2.5");
    const chevron = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    chevron.setAttribute("points", "6 9 12 15 18 9");
    chevronSvg.appendChild(chevron);
    header.appendChild(chevronSvg);

    header.addEventListener("click", () => panel.classList.toggle("expanded"));

    const body = panel.createDiv({ cls: "kg-cb-desc-body" });
    const content = body.createDiv({ cls: "kg-desc-content" });
    void MarkdownRenderer.render(this.app, config.description ?? "", content, "", this.component);
  }

  // ── Drag resize logic ──
  private attachResizeHandle(
    handle: HTMLElement,
    canvas: HTMLElement,
    svg: SVGSVGElement,
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
        const syncFn = (handle as HTMLElement & { __syncInput?: (h: number) => void }).__syncInput;
        if (syncFn) syncFn(clamped);
      };

      const onUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
        // Save final height to file on release
        const finalH = clamp(startH + (ev.clientY - startY));
        canvas.style.height = finalH + "px";
        svg.setAttribute("height", String(finalH));
        const syncFn = (handle as HTMLElement & { __syncInput?: (h: number) => void }).__syncInput;
        if (syncFn) syncFn(finalH);
        void saveHeight(finalH);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    });
  }
}

// ============================================
// Utility: extract string ID from a D3-resolved node/string union
// After simulation runs, D3 replaces string IDs with node objects;
// this helper safely extracts the id regardless of which form it is.
// ============================================
function nodeId(ref: GraphNode | string): string {
  return typeof ref === "string" ? ref : ref.id;
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
  private d3: D3Instance;
  private svgEl: SVGSVGElement;
  private tooltipEl: HTMLElement;
  private config: GraphConfig;
  private g: D3Selection | null = null;
  private simulation: D3Simulation | null = null;
  private zoomBehavior: D3ZoomBehavior | null = null;
  private nodeElements: D3Selection | null = null;
  private linkElements: D3Selection | null = null;
  private linkLabelElements: D3Selection | null = null;
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

  constructor(d3: D3Instance, svgEl: SVGSVGElement, tooltipEl: HTMLElement, config: GraphConfig) {
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
    const deg = this.data.links.filter((l) => {
      const sid = nodeId(l.source);
      const tid = nodeId(l.target);
      return sid === node.id || tid === node.id;
    }).length;
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
      const sid = nodeId(l.source);
      const tid = nodeId(l.target);
      const key = [sid, tid].sort().join("||");
      pairCount.set(key, (pairCount.get(key) || 0) + 1);
    });
    links.forEach((l) => {
      const sid = nodeId(l.source);
      const tid = nodeId(l.target);
      const key = [sid, tid].sort().join("||");
      const total = pairCount.get(key)!;
      const idx   = pairIndex.get(key) || 0;
      pairIndex.set(key, idx + 1);
      l.totalLinks = total;
      l.linkIndex  = idx;
      const sorted = [sid, tid].sort();
      l.isForwardDir = (sid === sorted[0]);
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
      .on("zoom", (event: D3ZoomEvent) => this.g?.attr("transform", event.transform));

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

  private appendArrow(defs: D3Selection, id: string, fill: string, size: number, refX: number) {
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

    // D3 force simulation — method chaining returns typed D3ForceChainable,
    // which is then passed as opaque unknown to simulation.force()
    this.simulation = d3.forceSimulation(nodes)
      .force("link",      d3.forceLink(links).id((d: GraphNode) => d.id).distance(linkDist).strength(0.7))
      .force("charge",    d3.forceManyBody().strength(chargeStr).distanceMax(400))
      .force("center",    d3.forceCenter(W / 2, H / 2).strength(0.08))
      .force("collision", d3.forceCollide().radius((d: GraphNode) => this.getNodeSize(d) + 12).strength(0.85))
      .alphaDecay(0.025)
      .velocityDecay(0.3);

    // Edges
    this.linkElements = this.g!.append("g").attr("class", "kg-links-layer")
      .selectAll("path").data(links).enter().append("path")
      .attr("class", "kg-link")
      .attr("stroke",       (d: GraphLink) => this.isLoop(d) ? "#8b5cf6" : "#cbd5e1")
      .attr("stroke-width", (d: GraphLink) => this.isLoop(d) ? 2.5 : 1.8)
      .attr("fill", "none")
      .attr("marker-end", (d: GraphLink) => this.isLoop(d) ? "" : `url(${this.arrowUrl})`)
      .on("mouseover", (event: MouseEvent, d: GraphLink) => { this.hoveredLink = d; this.hoveredNode = null; this.applyLinkHover(d); void event; })
      .on("mouseout",  () => this.handleMouseOut());

    // Edge labels
    const llGroup = this.g!.append("g").attr("class", "kg-link-labels-layer");
    const llGs = llGroup.selectAll("g").data(links).enter().append("g")
      .attr("class", "kg-link-label-g")
      .style("pointer-events", "none")
      .style("opacity", this.showLabels ? 1 : 0);
    llGs.append("rect").attr("class", "kg-link-label-bg")
      .attr("rx", 3).attr("ry", 3)
      .attr("fill", "rgba(245,247,250,0.92)").attr("stroke", "#e2e8f0").attr("stroke-width", 0.5);
    llGs.append("text").attr("class", "kg-link-label")
      .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
      .text((d: GraphLink) => d.relation);
    this.linkLabelElements = llGs;

    // Nodes
    const dragBehavior: D3DragBehavior = d3.drag()
      .on("start", (event: D3DragEvent, d: GraphNode) => this.dragStart(event, d))
      .on("drag",  (e: D3DragEvent, d: GraphNode) => { d.fx = e.x; d.fy = e.y; })
      .on("end",   (e: D3DragEvent, d: GraphNode) => this.dragEnd(e, d));

    this.nodeElements = this.g!.append("g").attr("class", "kg-nodes-layer")
      .selectAll("g").data(nodes).enter().append("g")
      .attr("class", "kg-node")
      .call(dragBehavior)
      .on("mouseover", (event: MouseEvent, d: GraphNode) => this.handleNodeOver(event, d))
      .on("mouseout",  () => this.handleMouseOut())
      .on("click",     (event: MouseEvent, d: GraphNode) => this.handleNodeClick(event, d));

    // Glow
    this.nodeElements.append("circle").attr("class", "kg-node-glow")
      .attr("r", (d: GraphNode) => this.getNodeSize(d) + 8)
      .attr("fill", (d: GraphNode) => this.getNodeColor(d.name))
      .attr("opacity", 0.12).attr("pointer-events", "none");

    // Main circle
    this.nodeElements.append("circle").attr("class", "kg-node-body")
      .attr("r",            (d: GraphNode) => this.getNodeSize(d))
      .attr("fill",         (d: GraphNode) => this.getNodeColor(d.name))
      .attr("stroke",       (d: GraphNode) => this.getNodeColor(d.name))
      .attr("stroke-width", 2.5).attr("stroke-opacity", 0.6);

    // Text stroke layer
    this.nodeElements.append("text").attr("class", "kg-node-text-stroke")
      .attr("text-anchor", "middle").attr("dy", "0.35em")
      .text((d: GraphNode) => d.name.length > 8 ? d.name.slice(0, 7) + "…" : d.name)
      .style("fill", "none")
      .style("stroke",         (d: GraphNode) => this.getNodeColor(d.name))
      .style("stroke-width",   "3px").style("stroke-opacity", "0.5")
      .style("font-size",      (d: GraphNode) => this.getNodeSize(d) > 30 ? "13px" : "12px")
      .style("pointer-events", "none");

    // Text body layer
    this.nodeElements.append("text").attr("class", "kg-node-text")
      .attr("text-anchor", "middle").attr("dy", "0.35em")
      .text((d: GraphNode) => d.name.length > 8 ? d.name.slice(0, 7) + "…" : d.name)
      .style("fill",           "#ffffff")
      .style("font-size",      (d: GraphNode) => this.getNodeSize(d) > 30 ? "13px" : "12px")
      .style("pointer-events", "none");

    this.simulation.on("tick", () => this.onTick());
  }

  // ── Tick ──
  private onTick() {
    this.linkElements?.each((d: GraphNode, i: number, nodes: Element[]) => {
      this.d3.select(nodes[i]).attr("d", this.computePath(d as unknown as GraphLink));
    });

    this.linkLabelElements?.each((d: GraphNode, i: number, nodes: Element[]) => {
      const mid = this.computeMidpoint(d as unknown as GraphLink);
      const labelG = this.d3.select(nodes[i]);
      labelG.attr("transform", `translate(${mid.x},${mid.y})`);
      const textEl = nodes[i].querySelector("text");
      if (textEl) {
        try {
          const b = textEl.getBBox();
          const px = 4, py = 2;
          labelG.select("rect")
            .attr("x", b.x - px).attr("y", b.y - py)
            .attr("width", b.width + px * 2).attr("height", b.height + py * 2);
        } catch (err) {
          // getBBox may fail in some rendering contexts; safe to ignore
          void err;
        }
      }
    });

    this.nodeElements?.attr("transform", (d: GraphNode) => `translate(${d.x},${d.y})`);
  }

  // ── Path calculation ──
  private isLoop(d: GraphLink): boolean {
    return nodeId(d.source) === nodeId(d.target);
  }

  private computePath(d: GraphLink): string {
    if (this.isLoop(d)) {
      const r = this.getNodeSize(d.source as GraphNode);
      const lr = r + 25 + (d.linkIndex || 0) * 10;
      const x = (d.source as GraphNode).x!, y = (d.source as GraphNode).y!;
      const sa = -Math.PI / 12, ea = -Math.PI / 2;
      const x1 = x + Math.cos(sa) * r, y1 = y + Math.sin(sa) * r;
      const x2 = x + Math.cos(ea) * r, y2 = y + Math.sin(ea) * r;
      const cx = x + Math.cos(sa) * lr * 1.8, cy = y + Math.sin(sa) * lr * 1.8;
      return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
    }
    const src = d.source as GraphNode, tgt = d.target as GraphNode;
    const sx = src.x!, sy = src.y!, tx = tgt.x!, ty = tgt.y!;
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return "";
    const sr = this.getNodeSize(src), tr = this.getNodeSize(tgt);
    const ux = dx / dist, uy = dy / dist;
    const x1 = sx + ux * (sr + 2), y1 = sy + uy * (sr + 2);
    const x2 = tx - ux * (tr + 7), y2 = ty - uy * (tr + 7);
    if (d.totalLinks === 1) return `M ${x1} ${y1} L ${x2} ${y2}`;
    const curv  = Math.min(60, Math.max(30, dist * 0.18));
    const offset = (d.linkIndex! - (d.totalLinks! - 1) / 2) * curv;
    const nx = -uy, ny = ux;
    const sign = d.isForwardDir ? 1 : -1;
    const mx = (x1 + x2) / 2 + nx * offset * sign;
    const my = (y1 + y2) / 2 + ny * offset * sign;
    return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
  }

  private computeMidpoint(d: GraphLink) {
    if (this.isLoop(d)) {
      const r  = this.getNodeSize(d.source as GraphNode);
      const lr = r + 25 + (d.linkIndex || 0) * 10;
      const sa = -Math.PI / 12, la = sa - Math.PI / 24;
      const src = d.source as GraphNode;
      return { x: src.x! + Math.cos(la) * lr * 1.5, y: src.y! + Math.sin(la) * lr * 1.5 };
    }
    const src = d.source as GraphNode, tgt = d.target as GraphNode;
    const sx = src.x!, sy = src.y!, tx = tgt.x!, ty = tgt.y!;
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return { x: sx, y: sy };
    if (d.totalLinks === 1) return { x: (sx + tx) / 2, y: (sy + ty) / 2 };
    const ux = dx / dist, uy = dy / dist;
    const sr = this.getNodeSize(src), tr = this.getNodeSize(tgt);
    const x1 = sx + ux * (sr + 2), y1 = sy + uy * (sr + 2);
    const x2 = tx - ux * (tr + 7), y2 = ty - uy * (tr + 7);
    const curv  = Math.min(60, Math.max(30, dist * 0.18));
    const offset = (d.linkIndex! - (d.totalLinks! - 1) / 2) * curv;
    const nx = -uy, ny = ux;
    const sign = d.isForwardDir ? 1 : -1;
    const cx = (x1 + x2) / 2 + nx * offset * sign;
    const cy = (y1 + y2) / 2 + ny * offset * sign;
    return { x: 0.25 * x1 + 0.5 * cx + 0.25 * x2, y: 0.25 * y1 + 0.5 * cy + 0.25 * y2 };
  }

  // ── Drag ──
  private dragStart(event: D3DragEvent, d: GraphNode) {
    this.isDragging = true;
    if (!event.active) this.simulation?.alphaTarget(0.25).restart();
    d.fx = d.x; d.fy = d.y;
  }

  private dragEnd(e: D3DragEvent, d: GraphNode) {
    d.pinned = true;
    if (!e.active) this.simulation?.alphaTarget(0);
    setTimeout(() => { this.isDragging = false; }, 100);
  }

  // ── Mouse events ──
  private handleNodeOver(event: MouseEvent, d: GraphNode) {
    if (this.isDragging) return;
    this.hoveredNode = d; this.hoveredLink = null;

    const conns = this.data.links.filter((l) => {
      const sid = nodeId(l.source);
      const tid = nodeId(l.target);
      return sid === d.id || tid === d.id;
    }).length;

    this.tooltipEl.empty();
    this.tooltipEl.createEl("strong", { text: d.name });
    this.tooltipEl.createDiv({
      cls: "kg-tt-type",
      text: `${this.getNodeTypeLabel(d.name)} · ${conns} connections${d.pinned ? " · 📌 Pinned" : ""}`,
    });

    // Position tooltip relative to canvasWrap (its offsetParent),
    // using clientX/Y so scroll offset doesn't interfere.
    const container = this.tooltipEl.offsetParent as HTMLElement ?? this.tooltipEl.parentElement!;
    const containerRect = container.getBoundingClientRect();
    const GAP = 14; // offset from cursor

    // First place to the right and slightly above the cursor
    let left = event.clientX - containerRect.left + GAP;
    let top  = event.clientY - containerRect.top  - 10;

    // Add "measuring" class to place tooltip in DOM invisibly so we can read its size
    this.tooltipEl.style.left = left + "px";
    this.tooltipEl.style.top  = top  + "px";
    this.tooltipEl.classList.add("measuring");

    const ttW = this.tooltipEl.offsetWidth;
    const ttH = this.tooltipEl.offsetHeight;
    const cW  = container.clientWidth;
    const cH  = container.clientHeight;

    // Flip to the left if overflowing right edge
    if (left + ttW > cW - 8) {
      left = event.clientX - containerRect.left - ttW - GAP;
    }
    // Flip upward if overflowing bottom edge
    if (top + ttH > cH - 8) {
      top = event.clientY - containerRect.top - ttH - GAP;
    }
    // Clamp to stay within container bounds
    left = Math.max(4, Math.min(left, cW - ttW - 4));
    top  = Math.max(4, Math.min(top,  cH - ttH - 4));

    this.tooltipEl.style.left = left + "px";
    this.tooltipEl.style.top  = top  + "px";
    this.tooltipEl.classList.remove("measuring");
    this.tooltipEl.classList.add("visible");

    this.applyNodeHover(d);
  }

  private handleMouseOut() {
    if (this.isDragging) return;
    this.hoveredNode = null; this.hoveredLink = null;
    this.tooltipEl.classList.remove("visible");

    this.linkElements
      ?.attr("stroke", (d: GraphLink) => this.isLoop(d) ? "#8b5cf6" : "#cbd5e1")
      .attr("stroke-opacity", 0.55)
      .attr("stroke-width",   (d: GraphLink) => this.isLoop(d) ? 2.5 : 1.8)
      .attr("marker-end",     (d: GraphLink) => this.isLoop(d) ? "" : `url(${this.arrowUrl})`);

    this.nodeElements?.style("opacity", 1).select(".kg-node-body").attr("stroke-width", 2.5);
    if (this.showLabels) this.linkLabelElements?.style("opacity", 1);
  }

  private handleNodeClick(event: MouseEvent, d: GraphNode) {
    if (event.defaultPrevented) return;
    if (d.pinned) {
      d.pinned = false; d.fx = null; d.fy = null;
      this.d3.select((event.target as Element).closest(".kg-node")!)
        .classed("kg-pinned", false).select(".kg-node-body").attr("stroke-width", 2.5);
      this.simulation?.alpha(0.1).restart();
    } else {
      d.pinned = true; d.fx = d.x; d.fy = d.y;
      this.d3.select((event.target as Element).closest(".kg-node")!)
        .classed("kg-pinned", true).select(".kg-node-body").attr("stroke-width", 3.5);
    }
  }

  // ── Highlight ──
  private isConnected(link: GraphLink, node: GraphNode): boolean {
    return nodeId(link.source) === node.id || nodeId(link.target) === node.id;
  }

  private isNeighbor(n: GraphNode, d: GraphNode): boolean {
    return !!this.data.links.some((l) => {
      const sid = nodeId(l.source);
      const tid = nodeId(l.target);
      return (sid === d.id && tid === n.id) || (tid === d.id && sid === n.id);
    });
  }

  private applyNodeHover(d: GraphNode) {
    this.linkElements
      ?.attr("stroke", (l: GraphLink) => {
        if (this.isLoop(l)) return this.isConnected(l, d) ? "#8b5cf6" : "#7c3aed";
        return this.isConnected(l, d) ? "#6366f1" : "#cbd5e1";
      })
      .attr("stroke-opacity", (l: GraphLink) => this.isConnected(l, d) ? 0.8 : 0.2)
      .attr("stroke-width",   (l: GraphLink) => this.isConnected(l, d) ? 2.5 : 1.5)
      .attr("marker-end",     (l: GraphLink) => {
        if (this.isLoop(l)) return "";
        return this.isConnected(l, d) ? `url(${this.arrowHlUrl})` : `url(${this.arrowUrl})`;
      });

    this.nodeElements?.each((n: GraphNode, i: number, nodes: Element[]) => {
      const related = n.id === d.id || this.isNeighbor(n, d);
      this.d3.select(nodes[i]).style("opacity", related ? 1 : 0.3)
        .select(".kg-node-body").attr("stroke-width", n.id === d.id ? 4 : 2.5);
    });

    this.linkLabelElements?.each((l: GraphLink, i: number, nodes: Element[]) => {
      this.d3.select(nodes[i]).style("opacity",
        this.showLabels && this.isConnected(l, d) ? 1 : 0.15);
    });
  }

  private applyLinkHover(d: GraphLink) {
    this.linkElements
      ?.attr("stroke", (l: GraphLink) => {
        if (this.isLoop(l)) return l === d ? "#8b5cf6" : "#7c3aed";
        return l === d ? "#6366f1" : "#cbd5e1";
      })
      .attr("stroke-opacity", (l: GraphLink) => l === d ? 1 : 0.2)
      .attr("stroke-width",   (l: GraphLink) => l === d ? 2.8 : 1.5)
      .attr("marker-end",     (l: GraphLink) => {
        if (this.isLoop(l)) return "";
        return l === d ? `url(${this.arrowHlUrl})` : `url(${this.arrowUrl})`;
      });

    this.nodeElements?.each((n: GraphNode, i: number, nodes: Element[]) => {
      const sid = nodeId(d.source);
      const tid = nodeId(d.target);
      const rel = n.id === sid || n.id === tid;
      this.d3.select(nodes[i]).style("opacity", rel ? 1 : 0.25)
        .select(".kg-node-body").attr("stroke-width", rel ? 4 : 2.5);
    });

    this.linkLabelElements?.each((l: GraphLink, i: number, nodes: Element[]) => {
      this.d3.select(nodes[i]).style("opacity", this.showLabels && l === d ? 1 : 0.1);
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
      .call(this.zoomBehavior!.transform, this.d3.zoomIdentity.translate(tx, ty).scale(scale));
  }
}
